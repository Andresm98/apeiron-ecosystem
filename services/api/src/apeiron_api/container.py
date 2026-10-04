"""Composition root: único lugar que conoce implementaciones concretas."""

from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from apeiron_api.settings import Settings
from apeiron_core.application.agents.factories import (
    AnaximandroFactory,
    HeraclitoFactory,
)
from apeiron_core.application.agents.registry import AgentRegistry
from apeiron_core.application.orchestration.graph import build_graph
from apeiron_core.application.ports.inbound.chat import ChatUseCasePort
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.application.ports.outbound.memory import VectorStorePort
from apeiron_core.application.ports.outbound.runs import RunRepositoryPort
from apeiron_core.application.ports.outbound.tools import ToolPort
from apeiron_core.application.use_cases.chat import ApeironFacade
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


def _build_llm(s: Settings, simulate: bool = False) -> LLMPort:
    if simulate or s.llm_provider == "fake":
        return FakeLLM(pace_s=s.simulation_pace_s if simulate else 0.0)

    def breaker() -> CircuitBreaker:
        return CircuitBreaker(s.breaker_failures, s.breaker_recovery_s)

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
        primary, fallback, breaker(), s.llm_retries, timeout_s=s.llm_timeout_s
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


def _registry() -> AgentRegistry:
    registry = AgentRegistry()
    registry.register(AnaximandroFactory())
    registry.register(HeraclitoFactory())
    return registry


def _build_tools(
    s: Settings, http: httpx.AsyncClient, store: VectorStorePort
) -> dict[str, ToolPort]:
    mcp = McpSdkGateway(s.mcp_server_url) if s.mcp_server_url else None
    return {
        t.name: t
        for t in (
            FormalLogicCalculator(),
            McpPublicApiTool(ArxivClient(http), CircuitBreaker(), mcp),
            VectorMemoryRetriever(store),
        )
    }


def build_apeiron_graph(
    s: Settings, tools: dict[str, ToolPort], simulate: bool = False
) -> Any:
    """Grafo orquestador Ápeiron; `simulate` usa el LLM determinista (0 tokens)."""
    llm = _build_llm(s, simulate)
    workers = _registry().build_all(llm, tools, s.max_react_steps, s.tool_timeout_s)
    return build_graph(
        workers,
        llm,
        s.default_rounds,
        s.node_timeout_s,
        debate_participants=s.debate_participants,
    )


def _topology(s: Settings) -> dict[str, Any]:
    return {
        "orchestrator": "apeiron",
        "agents": _registry().describe(),
        "debate_participants": s.debate_participants,
        "modes": ["single", "debate"],
        "llm": {"provider": s.llm_provider, "model": s.llm_model},
        "limits": {"default_rounds": s.default_rounds, "max_rounds": 4},
    }


async def build_container(s: Settings) -> Container:
    configure_logging(s.log_level)
    configure_langsmith(s.langsmith_enabled, s.langsmith_api_key, s.langsmith_project)
    http = httpx.AsyncClient(
        timeout=15.0, headers={"User-Agent": "apeiron-ecosystem/0.2"}
    )
    store = _build_store(s)
    await seed_global(store)
    tools = _build_tools(s, http, store)
    graph = build_apeiron_graph(s, tools)
    simulation = graph if s.llm_provider == "fake" else build_apeiron_graph(s, tools, True)
    runs = _build_runs(s, http)
    facade = ApeironFacade(
        graph,
        store,
        simulation_graph=simulation,
        runs=runs,
        model_label=f"{s.llm_provider}:{s.llm_model}",
    )
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
    )
