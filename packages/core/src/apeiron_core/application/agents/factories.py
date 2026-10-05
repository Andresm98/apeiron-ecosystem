"""Fábricas de workers: cada agente declara persona, rol y tools permitidas."""

from collections.abc import Mapping
from typing import Protocol

from apeiron_core.application.agents.react import ReActAgent
from apeiron_core.application.ports.outbound.agents import SpecialistAgent
from apeiron_core.application.ports.outbound.guardrails import GuardrailPort
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.application.ports.outbound.tools import ToolPort

ANAXIMANDRO_PERSONA = (
    "Eres Anaximandro. Razonas desde el ápeiron: lo indeterminado e ilimitado, "
    "fuente de la que surgen y a la que regresan los opuestos. Sé dialéctico y formal. "
    "Responde en el idioma del usuario."
)
HERACLITO_PERSONA = (
    "Eres Heráclito de Éfeso. Razonas desde el devenir y el logos: todo fluye, la realidad "
    "es tensión y unidad de opuestos. Eres el contrapunto de Anaximandro: donde él ve un "
    "fondo indeterminado y estable, tú ves conflicto y cambio regidos por una medida. "
    "Sé aforístico, directo y polémico; responde en pocas frases y en el idioma del usuario."
)


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


class AnaximandroFactory:
    name = "anaximandro"
    role = "Worker principal: tesis desde el ápeiron, lógica formal y evidencia."
    tools: tuple[str, ...] = (
        "formal_logic_calculator",
        "scholarly_search",
        "mcp_public_api_tool",
        "vector_memory_retriever",
    )

    def create(
        self,
        llm: LLMPort,
        tools: Mapping[str, ToolPort],
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
        require_evidence: bool = False,
        guardrails: GuardrailPort | None = None,
    ) -> SpecialistAgent:
        return _build(
            self.name,
            ANAXIMANDRO_PERSONA,
            self.tools,
            llm,
            tools,
            max_steps,
            tool_timeout_s,
            require_evidence,
            guardrails,
        )


class HeraclitoFactory:
    name = "heraclito"
    role = "Worker dialéctico: replica a Anaximandro desde el devenir y el logos."
    tools: tuple[str, ...] = ("vector_memory_retriever", "scholarly_search", "mcp_public_api_tool")

    def create(
        self,
        llm: LLMPort,
        tools: Mapping[str, ToolPort],
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
        require_evidence: bool = False,
        guardrails: GuardrailPort | None = None,
    ) -> SpecialistAgent:
        return _build(
            self.name,
            HERACLITO_PERSONA,
            self.tools,
            llm,
            tools,
            max_steps,
            tool_timeout_s,
            require_evidence,
            guardrails,
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
