"""Posición publicada por un agente durante una ronda."""

from typing import TypedDict


class AgentTurn(TypedDict):
    agent: str
    round: int
    text: str
    degraded: bool
