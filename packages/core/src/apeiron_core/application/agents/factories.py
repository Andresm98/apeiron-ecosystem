"""Fábricas de aplicación: cada agente declara persona y tools permitidas."""

from collections.abc import Mapping
from typing import Protocol

from apeiron_core.application.agents.base import PhilosopherAgent
from apeiron_core.application.agents.react import ReActAgent
from apeiron_core.application.ports.outbound.agents import SpecialistAgent
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.application.ports.outbound.tools import ToolPort

ANAXIMANDRO_PERSONA = (
    "Eres Anaximandro. Razonas desde el ápeiron: lo indeterminado e ilimitado, "
    "fuente de la que surgen y a la que regresan los opuestos. Sé dialéctico y formal. "
    "Responde en el idioma del usuario."
)
HERACLITO_PERSONA = (
    "Eres Heráclito. Razonas desde el devenir y el logos: todo fluye, la realidad es "
    "tensión y unidad de opuestos. Sé aforístico, directo y polémico. "
    "Responde en el idioma del usuario."
)


class AgentFactory(Protocol):
    name: str

    def create(
        self,
        llm: LLMPort,
        tools: Mapping[str, ToolPort],
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
    ) -> SpecialistAgent: ...


def _build(
    name: str,
    persona: str,
    wanted: tuple[str, ...],
    llm: LLMPort,
    tools: Mapping[str, ToolPort],
    max_steps: int,
    tool_timeout_s: float,
) -> SpecialistAgent:
    selected = [tools[tool_name] for tool_name in wanted if tool_name in tools]
    if not selected:
        return PhilosopherAgent(name, persona, llm)
    return ReActAgent(name, persona, llm, selected, max_steps, tool_timeout_s)


class AnaximandroFactory:
    name = "anaximandro"
    tools = (
        "formal_logic_calculator",
        "mcp_public_api_tool",
        "vector_memory_retriever",
    )

    def create(
        self,
        llm: LLMPort,
        tools: Mapping[str, ToolPort],
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
    ) -> SpecialistAgent:
        return _build(
            self.name,
            ANAXIMANDRO_PERSONA,
            self.tools,
            llm,
            tools,
            max_steps,
            tool_timeout_s,
        )


class HeraclitoFactory:
    name = "heraclito"
    tools = ("vector_memory_retriever", "mcp_public_api_tool")

    def create(
        self,
        llm: LLMPort,
        tools: Mapping[str, ToolPort],
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
    ) -> SpecialistAgent:
        return _build(
            self.name,
            HERACLITO_PERSONA,
            self.tools,
            llm,
            tools,
            max_steps,
            tool_timeout_s,
        )
