from collections.abc import Mapping

from apeiron_core.domain.agents.factories import AgentFactory
from apeiron_core.domain.ports import LLMPort, SpecialistAgent, ToolPort


class AgentRegistry:
    """Añadir un agente = registrar una fábrica; el grafo no cambia."""

    def __init__(self) -> None:
        self._factories: dict[str, AgentFactory] = {}

    def register(self, factory: AgentFactory) -> None:
        self._factories[factory.name] = factory

    def build_all(
        self, llm: LLMPort, tools: Mapping[str, ToolPort] | None = None
    ) -> dict[str, SpecialistAgent]:
        return {n: f.create(llm, tools or {}) for n, f in self._factories.items()}
