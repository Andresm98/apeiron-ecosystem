"""Registro de fábricas de agentes de aplicación."""

from collections.abc import Mapping
from typing import Any

from apeiron_core.application.agents.factories import AgentFactory
from apeiron_core.application.ports.outbound.agents import SpecialistAgent
from apeiron_core.application.ports.outbound.guardrails import GuardrailPort
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.application.ports.outbound.tools import ToolPort
from apeiron_core.domain.entities.agent_spec import AgentSpec


def _spec(factory: AgentFactory) -> AgentSpec | None:
    spec = getattr(factory, "spec", None)
    return spec if isinstance(spec, AgentSpec) else None


class AgentRegistry:
    """Añadir un especialista consiste en registrar su fábrica (los locales salen de su manifiesto)."""

    def __init__(self) -> None:
        self._factories: dict[str, AgentFactory] = {}

    def register(self, factory: AgentFactory) -> None:
        if factory.name in self._factories:
            raise ValueError(f"agente duplicado: {factory.name!r}")
        self._factories[factory.name] = factory

    @property
    def names(self) -> list[str]:
        return list(self._factories)

    def describe(self) -> list[dict[str, Any]]:
        """Topología pública: lo que la web y la Agent Card necesitan saber de cada agente."""
        described: list[dict[str, Any]] = []
        for f in self._factories.values():
            item: dict[str, Any] = {
                "name": f.name,
                "role": f.role,
                "tools": list(f.tools),
                "kind": getattr(f, "kind", "local"),  # local (ReAct en proceso) | remote (A2A)
            }
            if endpoint := getattr(f, "endpoint", ""):
                item["endpoint"] = endpoint
            if spec := _spec(f):
                residence = spec.residence
                item |= {
                    "display_name": spec.display_name,
                    "version": spec.version,
                    "debate": spec.debate,
                    "a2a": spec.a2a,
                    "residence": {
                        "title": residence.title,
                        "subtitle": residence.subtitle,
                        "landmark": residence.landmark,
                        "color": residence.color,
                        "epithet": residence.epithet,
                        "figure": residence.figure,
                    },
                }
            described.append(item)
        return described

    def specs(self) -> list[AgentSpec]:
        return [spec for f in self._factories.values() if (spec := _spec(f))]

    def hints(self) -> dict[str, tuple[str, ...]]:
        """Pistas de enrutado de cada agente, en orden del catálogo."""
        return {f.name: spec.routing_hints if (spec := _spec(f)) else (f.name,) for f in self._factories.values()}

    def debate_defaults(self) -> list[str]:
        return [spec.name for spec in self.specs() if spec.debate]

    def build_all(
        self,
        llm: LLMPort,
        tools: Mapping[str, ToolPort] | None = None,
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
        require_evidence: bool = False,
        guardrails: GuardrailPort | None = None,
    ) -> dict[str, SpecialistAgent]:
        return {
            name: factory.create(
                llm, tools or {}, max_steps, tool_timeout_s, require_evidence, guardrails
            )
            for name, factory in self._factories.items()
        }
