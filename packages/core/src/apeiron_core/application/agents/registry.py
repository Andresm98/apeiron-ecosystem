"""Registro de fábricas de agentes de aplicación."""

from collections.abc import Mapping

from apeiron_core.application.agents.factories import AgentFactory
from apeiron_core.application.ports.outbound.agents import SpecialistAgent
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.application.ports.outbound.tools import ToolPort


class AgentRegistry:
    """Añadir un especialista consiste en registrar su fábrica."""

    def __init__(self) -> None:
        self._factories: dict[str, AgentFactory] = {}

    def register(self, factory: AgentFactory) -> None:
        self._factories[factory.name] = factory

    def describe(self) -> list[dict[str, object]]:
        return [
            {"name": f.name, "role": f.role, "tools": list(f.tools)}
            for f in self._factories.values()
        ]

    def build_all(
        self,
        llm: LLMPort,
        tools: Mapping[str, ToolPort] | None = None,
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
    ) -> dict[str, SpecialistAgent]:
        return {
            name: factory.create(llm, tools or {}, max_steps, tool_timeout_s)
            for name, factory in self._factories.items()
        }
