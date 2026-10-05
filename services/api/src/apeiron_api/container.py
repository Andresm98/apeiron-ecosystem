"""Composition root: único lugar que conoce implementaciones concretas."""

import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from apeiron_api.a2a.tasks import A2ATaskStore
from apeiron_api.settings import RemoteAgentConfig, Settings
from apeiron_core.application.agents.factories import (
    AnaximandroFactory,
    HeraclitoFactory,
    RemoteAgentFactory,
)
from apeiron_core.application.agents.registry import AgentRegistry
from apeiron_core.application.guardrails import RuleGuardrails
from apeiron_core.application.metrics import RuntimeMetrics
from apeiron_core.application.orchestration.graph import build_graph
from apeiron_core.application.ports.inbound.chat import ChatUseCasePort
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.application.ports.outbound.memory import VectorStorePort
from apeiron_core.application.ports.outbound.runs import RunRepositoryPort
from apeiron_core.application.ports.outbound.tools import ToolPort
from apeiron_core.application.use_cases.chat import ApeironFacade
from apeiron_infra.a2a.client import A2AClient, A2ARemoteAgent
from apeiron_infra.llm.fake import FakeLLM
from apeiron_infra.llm.langchain_llm import LangChainLLM
from apeiron_infra.llm.resilient import ResilientLLM
from apeiron_infra.memory.vector import (
    ChromaVectorStore,
    InMemoryVectorStore,
    seed_global,
)
from apeiron_infra.observability.langsmith import configure_langsmith
from apeiron_infra.observability.logging import configure_logging
from apeiron_infra.persistence.supabase_runs import SupabaseRunRepository
from apeiron_infra.resilience import CircuitBreaker
from apeiron_infra.security.rate_limit import SlidingWindowLimiter
from apeiron_infra.security.supabase import SupabaseTokenVerifier
from apeiron_infra.security.tokens import TokenService
from apeiron_infra.security.users import InMemoryUserRepository, SqliteUserRepository, UserRepository
from apeiron_infra.tools.formal_logic import FormalLogicCalculator
from apeiron_infra.tools.public_api import ArxivClient, McpPublicApiTool, McpSdkGateway
from apeiron_infra.tools.scholarly import ScholarlySearchTool
from apeiron_infra.tools.vector_memory import VectorMemoryRetriever


class TokenVerifier(Protocol):
    def decode(self, token: str) -> str: ...


@dataclass
class Container:
    settings: Settings
    facade: ChatUseCasePort
    topology: dict[str, Any]
    tokens: TokenVerifier
    users: UserRepository
    memory: VectorStorePort
    limiter: SlidingWindowLimiter
    http: httpx.AsyncClient
    runs: RunRepositoryPort | None = None
    # Observabilidad del sistema (panel /v1/system): actividad, breakers, sondas y tareas A2A.
    metrics: RuntimeMetrics = field(default_factory=RuntimeMetrics)
    breakers: dict[str, CircuitBreaker] = field(default_factory=dict)
    remotes: dict[str, A2ARemoteAgent] = field(default_factory=dict)
    probes: dict[str, Callable[[], Awaitable[Any]]] = field(default_factory=dict)
    a2a_tasks: A2ATaskStore = field(default_factory=A2ATaskStore)
    started_at: float = field(default_factory=time.time)


def _build_llm(s: Settings, simulate: bool = False, breaker: CircuitBreaker | None = None) -> LLMPort:
    if simulate or s.llm_provider == "fake":
        return FakeLLM(pace_s=s.simulation_pace_s if simulate else 0.0)

    def chat_model(model: str) -> LangChainLLM:
        return LangChainLLM(
            model,
            s.llm_provider,
            max_tokens=s.llm_max_tokens,
            reasoning_effort=s.llm_reasoning_effort,
        )

    primary = chat_model(s.llm_model)
    fallback = chat_model(s.llm_fallback_model) if s.llm_fallback_model else None
    return ResilientLLM(
        primary,
        fallback,
        breaker or CircuitBreaker(s.breaker_failures, s.breaker_recovery_s),
        s.llm_retries,
        timeout_s=s.llm_timeout_s,
    )


def _build_store(s: Settings) -> VectorStorePort:
    if s.vector_backend == "chroma":
        return ChromaVectorStore(
            s.chroma_host,
            s.chroma_port,
            max_docs_per_user=s.memory_max_docs_per_user,
            semantic_weight=s.memory_semantic_weight,
            lexical_weight=s.memory_lexical_weight,
        )
    return InMemoryVectorStore(
        max_docs_per_user=s.memory_max_docs_per_user,
        semantic_weight=s.memory_semantic_weight,
        lexical_weight=s.memory_lexical_weight,
    )


def _build_tokens(s: Settings) -> TokenVerifier:
    if s.auth_provider == "supabase":
        return SupabaseTokenVerifier(s.supabase_url, s.supabase_jwt_secret)
    return TokenService(s.jwt_secret, s.jwt_ttl_minutes, previous_secret=s.jwt_secret_previous)


def _build_runs(s: Settings, http: httpx.AsyncClient) -> RunRepositoryPort | None:
    if s.auth_provider == "supabase" and s.persist_runs:
        return SupabaseRunRepository(s.supabase_url, s.supabase_publishable_key, http)
    return None


def _build_users(s: Settings) -> UserRepository:
    if s.users_db_path:
        return SqliteUserRepository(s.users_db_path)
    return InMemoryUserRepository()


def build_remotes(s: Settings, http: httpx.AsyncClient) -> dict[str, A2ARemoteAgent]:
    """Workers A2A remotos; cada uno con su credencial (nunca el JWT del usuario)."""
    remotes: dict[str, A2ARemoteAgent] = {}
    for cfg in s.a2a_remote_agents:
        token = os.environ.get(cfg.token_env) if cfg.token_env else None
        client = A2AClient(cfg.url, http, s.a2a_allowed_hosts, token=token, timeout_s=s.node_timeout_s)
        remotes[cfg.name] = A2ARemoteAgent(cfg.name, client, max_hops=s.a2a_max_hops)
    return remotes


def _registry(s: Settings, remotes: dict[str, A2ARemoteAgent] | None = None) -> AgentRegistry:
    """`remotes=None` registra sustitutos locales de los agentes A2A (simulación sin red)."""
    registry = AgentRegistry()
    registry.register(AnaximandroFactory())
    registry.register(HeraclitoFactory())
    local = {item["name"] for item in registry.describe()}
    for cfg in s.a2a_remote_agents:
        if cfg.name in local:
            raise ValueError(f"el agente remoto {cfg.name!r} colisiona con un worker local")
        agent = remotes.get(cfg.name) if remotes is not None else None
        registry.register(RemoteAgentFactory(cfg.name, cfg.role, agent, endpoint=_host(cfg)))
    return registry


def _host(cfg: RemoteAgentConfig) -> str:
    return httpx.URL(cfg.url).host


def _build_tools(
    s: Settings,
    http: httpx.AsyncClient,
    store: VectorStorePort,
    breakers: dict[str, CircuitBreaker] | None = None,
) -> dict[str, ToolPort]:
    breakers = breakers if breakers is not None else {}
    mcp = McpSdkGateway(s.mcp_server_url) if s.mcp_server_url else None
    tools: list[ToolPort] = [
        FormalLogicCalculator(),
        McpPublicApiTool(ArxivClient(http), breakers.setdefault("external_sources", CircuitBreaker()), mcp),
        VectorMemoryRetriever(store),
    ]
    if s.scholar_mcp_url:  # servidor MCP apeiron-scholar (OpenAlex): citas con DOI verificable
        breaker = breakers.setdefault("scholarly_sources", CircuitBreaker())
        tools.append(ScholarlySearchTool(McpSdkGateway(s.scholar_mcp_url), breaker))
    return {t.name: t for t in tools}


def build_apeiron_graph(
    s: Settings,
    tools: dict[str, ToolPort],
    simulate: bool = False,
    *,
    llm_breaker: CircuitBreaker | None = None,
    remotes: dict[str, A2ARemoteAgent] | None = None,
) -> Any:
    """Grafo orquestador Ápeiron; `simulate` usa el LLM determinista y sustitutos locales (0 tokens)."""
    llm = _build_llm(s, simulate, llm_breaker)
    guardrails = RuleGuardrails() if s.guardrails_enabled else None
    workers = _registry(s, None if simulate else remotes).build_all(
        llm, tools, s.max_react_steps, s.tool_timeout_s, s.require_evidence, guardrails
    )
    return build_graph(
        workers,
        llm,
        s.default_rounds,
        s.node_timeout_s,
        debate_participants=s.debate_participants,
        guardrails=guardrails,
    )


def _topology(s: Settings) -> dict[str, Any]:
    return {
        "orchestrator": "apeiron",
        "agents": _registry(s).describe(),
        "debate_participants": s.debate_participants,
        "modes": ["single", "debate"],
        "llm": {"provider": s.llm_provider, "model": s.llm_model},
        "limits": {"default_rounds": s.default_rounds, "max_rounds": 4},
    }


async def build_container(s: Settings) -> Container:
    configure_logging(s.log_level)
    configure_langsmith(s.langsmith_enabled, s.langsmith_api_key, s.langsmith_project)
    http = httpx.AsyncClient(
        timeout=15.0, headers={"User-Agent": "apeiron-ecosystem/0.3"}
    )
    store = _build_store(s)
    await seed_global(store)
    breakers = {"llm": CircuitBreaker(s.breaker_failures, s.breaker_recovery_s)}
    tools = _build_tools(s, http, store, breakers)
    remotes = build_remotes(s, http)
    graph = build_apeiron_graph(s, tools, llm_breaker=breakers["llm"], remotes=remotes)
    simulation = graph if s.llm_provider == "fake" and not remotes else build_apeiron_graph(s, tools, True)
    runs = _build_runs(s, http)
    metrics = RuntimeMetrics()
    facade = ApeironFacade(
        graph,
        store,
        simulation_graph=simulation,
        runs=runs,
        model_label=f"{s.llm_provider}:{s.llm_model}",
        metrics=metrics,
    )
    size = getattr(store, "size", None)
    return Container(
        s,
        facade,
        _topology(s),
        _build_tokens(s),
        _build_users(s),
        store,
        SlidingWindowLimiter(),
        http,
        runs,
        metrics=metrics,
        breakers=breakers,
        remotes=remotes,
        probes={"memory": size} if size else {},
    )
