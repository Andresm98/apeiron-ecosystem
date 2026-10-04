"""Eventos del caso de uso de chat."""

from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class ChatEvent:
    type: Literal["trace", "turn", "answer"]
    data: dict[str, Any]
