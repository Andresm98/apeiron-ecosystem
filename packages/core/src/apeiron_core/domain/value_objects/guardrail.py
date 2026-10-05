"""Veredicto de un guardrail y su registro público (sin el texto evaluado)."""

from dataclasses import dataclass
from typing import Literal, TypedDict

Stage = Literal["input", "observation", "turn", "output"]
Action = Literal["allow", "redact", "block"]


@dataclass(frozen=True)
class GuardrailVerdict:
    stage: Stage
    action: Action
    text: str  # texto resultante: el original (allow), el saneado (redact) o "" (block)
    rules: tuple[str, ...] = ()


class GuardrailRecord(TypedDict):
    """Lo que se registra y persiste: dónde, qué decisión y qué reglas. Nunca el texto."""

    stage: Stage
    action: Action
    rules: list[str]
    agent: str
    round: int
