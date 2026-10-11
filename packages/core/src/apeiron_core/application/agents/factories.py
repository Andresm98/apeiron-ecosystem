"""Fábricas de workers: los locales salen de su manifiesto (ADR-013); los remotos, de la configuración A2A."""

from collections.abc import Mapping
from typing import Protocol

from apeiron_core.application.agents.react import ReActAgent
from apeiron_core.application.ports.outbound.agents import SpecialistAgent
from apeiron_core.application.ports.outbound.guardrails import GuardrailPort
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.application.ports.outbound.tools import ToolPort
from apeiron_core.domain.entities.agent_spec import AgentSpec


class AgentFactory(Protocol):
    name: str
    role: str
    tools: tuple[str, ...]

    def create(
        self,
        llm: LLMPort,
        tools: Mapping[str, ToolPort],
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
        require_evidence: bool = False,
        guardrails: GuardrailPort | None = None,
    ) -> SpecialistAgent: ...


def _build(
    name: str,
    persona: str,
    wanted: tuple[str, ...],
    llm: LLMPort,
    tools: Mapping[str, ToolPort],
    max_steps: int,
    tool_timeout_s: float,
    require_evidence: bool = False,
    guardrails: GuardrailPort | None = None,
) -> SpecialistAgent:
    selected = [tools[tool_name] for tool_name in wanted if tool_name in tools]
    return ReActAgent(
        name, persona, llm, selected, max_steps, tool_timeout_s, require_evidence, guardrails
    )


class SpecAgentFactory:
    """Worker ReAct local construido desde su manifiesto (ADR-013): ningún agente tiene clase propia.

    Las tools del manifiesto son su lista de acceso: el agente solo ve esas, aunque el sistema tenga más.
    """

    kind = "local"

    def __init__(self, spec: AgentSpec) -> None:
        self.spec = spec
        self.name = spec.name
        self.role = spec.role
        self.tools = spec.tools

    def create(
        self,
        llm: LLMPort,
        tools: Mapping[str, ToolPort],
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
        require_evidence: bool = False,
        guardrails: GuardrailPort | None = None,
    ) -> SpecialistAgent:
        steps = min(self.spec.max_steps, max_steps) if self.spec.max_steps else max_steps
        return _build(
            self.name, self.spec.persona, self.tools, llm, tools, steps, tool_timeout_s, require_evidence, guardrails
        )


REMOTE_STAND_IN_TOOLS = ("vector_memory_retriever",)


class RemoteAgentFactory:
    """Agente externo (A2A, ADR-011): el composition root lo construye con su adaptador.

    Sin `agent` (modo simulación) crea un sustituto ReAct local con el mismo nombre: la
    simulación recorre el grafo completo sin salir nunca a la red.
    """

    kind = "remote"
    tools: tuple[str, ...] = ()

    def __init__(
        self, name: str, role: str, agent: SpecialistAgent | None = None, endpoint: str = ""
    ) -> None:
        self.name, self.role, self.endpoint = name, role, endpoint
        self._agent = agent

    def create(
        self,
        llm: LLMPort,
        tools: Mapping[str, ToolPort],
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
        require_evidence: bool = False,
        guardrails: GuardrailPort | None = None,
    ) -> SpecialistAgent:
        if self._agent is not None:
            return self._agent
        persona = f"Eres {self.name}, agente remoto (simulado). {self.role} Responde en el idioma del usuario."
        return _build(
            self.name,
            persona,
            REMOTE_STAND_IN_TOOLS,
            llm,
            tools,
            max_steps,
            tool_timeout_s,
            require_evidence,
            guardrails,
        )
