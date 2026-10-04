"""Posición publicada por un agente durante una ronda."""

from typing import NotRequired, TypedDict


class AgentTurn(TypedDict):
    agent: str
    round: int
    text: str
    degraded: bool
    # Interlocutor al que responde este turno (última posición de otro agente), si lo hay.
    responds_to: NotRequired[str | None]
