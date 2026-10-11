"""Contador de llamadas/tokens LLM por ejecución, propagado por contexto, con desglose por agente."""

from contextvars import ContextVar
from dataclasses import asdict, dataclass, field
from typing import Any

ORCHESTRATOR = "apeiron"


@dataclass
class AgentUsage:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class TokenUsage:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    by_agent: dict[str, AgentUsage] = field(default_factory=dict)

    def record(self, input_tokens: int = 0, output_tokens: int = 0, agent: str = ORCHESTRATOR) -> None:
        self.calls += 1
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        own = self.by_agent.setdefault(agent, AgentUsage())
        own.calls += 1
        own.input_tokens += input_tokens
        own.output_tokens += output_tokens

    def as_dict(self) -> dict[str, int]:
        return {
            "calls": self.calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
        }

    def snapshot(self) -> dict[str, Any]:
        """Serializable (diario de sesiones): totales y desglose por agente."""
        return {**self.as_dict(), "by_agent": {name: asdict(usage) for name, usage in self.by_agent.items()}}

    @classmethod
    def restore(cls, data: dict[str, Any]) -> "TokenUsage":
        usage = cls(int(data.get("calls", 0)), int(data.get("input_tokens", 0)), int(data.get("output_tokens", 0)))
        for name, own in (data.get("by_agent") or {}).items():
            fields = ("calls", "input_tokens", "output_tokens")
            usage.by_agent[name] = AgentUsage(**{k: int(own.get(k, 0)) for k in fields})
        return usage


usage_meter: ContextVar[TokenUsage | None] = ContextVar("usage_meter", default=None)
# Agente que está hablando: cada nodo worker lo fija en su propia tarea (ADR-013, fase 4).
current_agent: ContextVar[str] = ContextVar("current_agent", default=ORCHESTRATOR)


def record_usage(input_tokens: int = 0, output_tokens: int = 0) -> None:
    meter = usage_meter.get()
    if meter is not None:
        meter.record(input_tokens, output_tokens, current_agent.get())
