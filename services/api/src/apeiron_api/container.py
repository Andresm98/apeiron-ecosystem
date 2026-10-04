"""Composition root: único lugar que conoce implementaciones concretas."""

from dataclasses import dataclass

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
from apeiron_infra.resilience import CircuitBreaker
from apeiron_infra.security.tokens import TokenService
from apeiron_infra.security.users import InMemoryUserRepository, UserRepository
from apeiron_infra.tools.formal_logic import FormalLogicCalculator
from apeiron_infra.tools.public_api import ArxivClient, McpPublicApiTool, McpSdkGateway
from apeiron_infra.tools.vector_memory import VectorMemoryRetriever


@dataclass
class Container:
    settings: Settings
    facade: ChatUseCasePort
    tokens: TokenService
    users: UserRepository
    http: httpx.AsyncClient


def _build_llm(s: Settings) -> LLMPort:
    if s.llm_provider == "fake":
        return FakeLLM()

    def breaker() -> CircuitBreaker:
        return CircuitBreaker(s.breaker_failures, s.breaker_recovery_s)

    primary = LangChainLLM(s.llm_model, s.llm_provider)
    fallback = (
        LangChainLLM(s.llm_fallback_model, s.llm_provider)
        if s.llm_fallback_model
        else None
    )
    return ResilientLLM(
        primary, fallback, breaker(), s.llm_retries, timeout_s=s.llm_timeout_s
    )


def _build_store(s: Settings) -> VectorStorePort:
    if s.vector_backend == "chroma":
        return ChromaVectorStore(s.chroma_host, s.chroma_port)
    return InMemoryVectorStore()


async def build_container(s: Settings) -> Container:
    configure_logging(s.log_level)
    configure_langsmith(s.langsmith_enabled, s.langsmith_api_key, s.langsmith_project)
    http = httpx.AsyncClient(
        timeout=15.0, headers={"User-Agent": "apeiron-ecosystem/0.2"}
    )
    store = _build_store(s)
    await seed_global(store)

    mcp = McpSdkGateway(s.mcp_server_url) if s.mcp_server_url else None
    tools: dict[str, ToolPort] = {
        t.name: t
        for t in (
            FormalLogicCalculator(),
            McpPublicApiTool(ArxivClient(http), CircuitBreaker(), mcp),
            VectorMemoryRetriever(store),
        )
    }
    llm = _build_llm(s)
    registry = AgentRegistry()
    registry.register(AnaximandroFactory())
    registry.register(HeraclitoFactory())  # Sócrates/Anaxágoras: una línea más aquí
    specialists = registry.build_all(llm, tools, s.max_react_steps, s.tool_timeout_s)
    graph = build_graph(
        specialists,
        llm,
        s.default_rounds,
        s.node_timeout_s,
        debate_participants=s.debate_participants,
    )
    return Container(
        s,
        ApeironFacade(graph, store),
        TokenService(s.jwt_secret, s.jwt_ttl_minutes),
        InMemoryUserRepository(),
        http,
    )
