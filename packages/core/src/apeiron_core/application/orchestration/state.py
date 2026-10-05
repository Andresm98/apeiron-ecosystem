"""Estado compartido del grafo de aplicación Ápeiron."""

import operator
from typing import Annotated, TypedDict

from apeiron_core.domain.entities.agent_turn import AgentTurn
from apeiron_core.domain.value_objects.guardrail import GuardrailRecord
from apeiron_core.domain.value_objects.mode import Mode


class ApeironInput(TypedDict, total=False):
    """Entrada pública del grafo (formulario de LangGraph Studio y facade)."""

    question: str
    mode: Mode
    max_rounds: int


class ApeironState(ApeironInput, total=False):
    participants: list[str]
    round: int
    speaker: int  # índice del worker activo dentro de `participants`
    turns: Annotated[list[AgentTurn], operator.add]
    trace: Annotated[list[str], operator.add]
    answer: str
    blocked: bool  # el guardrail de entrada rechazó la pregunta: no actúa ningún worker
    evidence: Annotated[list[str], operator.add]  # observaciones reales para verificar citas
    guardrails: Annotated[list[GuardrailRecord], operator.add]
