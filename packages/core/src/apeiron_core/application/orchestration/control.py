"""Control de una deliberación en curso (ADR-013, fase 2): lo que el usuario decide mientras el grafo corre.

El servicio de sesiones fija el control en un ContextVar antes de ejecutar el grafo; las tareas de LangGraph
copian el contexto, así que el supervisor lee el mismo objeto que el usuario modifica (cerrar, invitar).
Fuera de una sesión no hay control y el grafo se comporta como siempre.
"""

import time
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Literal

from apeiron_core.application.usage import usage_meter

HUMAN = "human"  # el participante humano: el usuario autenticado (ssanax es su nombre visible)
MAX_PARTICIPANTS = 6  # cinco workers más el humano (regla 8 de AGENTS.md, cambiada por ADR-013)
OPEN_ENDED_ROUNDS = 99  # sin fin fijo: cierran el usuario, el presupuesto de tiempo o los topes duros

Pace = Literal["auto", "step"]
CloseReason = Literal["closed_by_user", "time_budget", "max_duration", "max_calls"]


@dataclass
class DeliberationControl:
    pace: Pace = "auto"
    turn_delay_s: float = 0.0
    deadline: float | None = None  # monotonic: presupuesto de tiempo elegido por el usuario
    hard_deadline: float | None = None  # monotonic: tope duro de seguridad
    max_calls: int | None = None  # tope duro de llamadas LLM
    close_requested: bool = False
    invited: list[str] = field(default_factory=list)  # se acumula; el supervisor lo fusiona sin borrarlo

    def close_reason(self) -> CloseReason | None:
        now = time.monotonic()
        if self.close_requested:
            return "closed_by_user"
        if self.deadline is not None and now >= self.deadline:
            return "time_budget"
        if self.hard_deadline is not None and now >= self.hard_deadline:
            return "max_duration"
        meter = usage_meter.get()
        if self.max_calls is not None and meter is not None and meter.calls >= self.max_calls:
            return "max_calls"
        return None

    def next_deadline(self) -> float | None:
        """El límite de tiempo más cercano que obliga a cerrar."""
        limits = [d for d in (self.deadline, self.hard_deadline) if d is not None]
        return min(limits) if limits else None


deliberation: ContextVar[DeliberationControl | None] = ContextVar("deliberation", default=None)
