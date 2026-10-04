"""Contador de llamadas/tokens LLM por ejecución, propagado por contexto."""

from contextvars import ContextVar
from dataclasses import dataclass


@dataclass
class TokenUsage:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0

    def record(self, input_tokens: int = 0, output_tokens: int = 0) -> None:
        self.calls += 1
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens

    def as_dict(self) -> dict[str, int]:
        return {
            "calls": self.calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
        }


usage_meter: ContextVar[TokenUsage | None] = ContextVar("usage_meter", default=None)


def record_usage(input_tokens: int = 0, output_tokens: int = 0) -> None:
    meter = usage_meter.get()
    if meter is not None:
        meter.record(input_tokens, output_tokens)
