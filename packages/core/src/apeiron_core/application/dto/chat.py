"""Eventos del caso de uso de chat."""

from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class ChatEvent:
    type: Literal["trace", "turn", "node", "step", "guard", "answer"]
    data: dict[str, Any]
