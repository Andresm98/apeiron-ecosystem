"""Abstract Factory: una fábrica por agente; cada una elige sus propias tools."""
from collections.abc import Mapping
from typing import Protocol

from apeiron_core.domain.agents.base import PhilosopherAgent
from apeiron_core.domain.agents.react import ReActAgent
from apeiron_core.domain.ports import LLMPort, SpecialistAgent, ToolPort

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

    def create(self, llm: LLMPort, tools: Mapping[str, ToolPort]) -> SpecialistAgent: ...


def _build(
    name: str, persona: str, wanted: tuple[str, ...], llm: LLMPort, tools: Mapping[str, ToolPort]
) -> SpecialistAgent:
    selected = [tools[n] for n in wanted if n in tools]
    if not selected:
        return PhilosopherAgent(name, persona, llm)
    return ReActAgent(name, persona, llm, selected)


class AnaximandroFactory:
    name = "anaximandro"
    tools = ("formal_logic_calculator", "mcp_public_api_tool", "vector_memory_retriever")

    def create(self, llm: LLMPort, tools: Mapping[str, ToolPort]) -> SpecialistAgent:
        return _build(self.name, ANAXIMANDRO_PERSONA, self.tools, llm, tools)


class HeraclitoFactory:
    name = "heraclito"
    tools = ("vector_memory_retriever", "mcp_public_api_tool")

    def create(self, llm: LLMPort, tools: Mapping[str, ToolPort]) -> SpecialistAgent:
        return _build(self.name, HERACLITO_PERSONA, self.tools, llm, tools)
