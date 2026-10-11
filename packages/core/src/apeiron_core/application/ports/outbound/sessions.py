"""Puerto de salida: diario durable de las sesiones deliberativas (ADR-013, fase 5).

El estado del grafo vive en el checkpointer de LangGraph; el diario guarda lo que el checkpointer no sabe: de quién
es la sesión, su configuración, su estado público y la cronología numerada de eventos (para reengancharse con
`after=N` aunque la API se haya reiniciado). Nunca guarda el token del usuario.
"""

from collections.abc import Sequence
from typing import Any, NamedTuple, Protocol, TypedDict


class SessionRecord(TypedDict):
    id: str
    owner: str
    trace_id: str
    config: dict[str, Any]  # SessionConfig completo, incluida la pregunta
    status: str
    reason: str | None
    created_at: float  # epoch
    updated_at: float  # epoch
    deadline: float | None  # epoch: presupuesto de tiempo elegido por el usuario
    hard_deadline: float | None  # epoch: tope duro de duración
    usage: dict[str, Any]  # TokenUsage serializado (total y por agente) en el último cambio de estado


class StoredEvent(NamedTuple):
    seq: int
    t: int  # ms desde el inicio de la sesión (cronología del replay)
    type: str
    data: dict[str, Any]


class SessionJournalPort(Protocol):
    async def save(self, record: SessionRecord) -> None: ...

    async def append(self, session_id: str, events: Sequence[StoredEvent]) -> None: ...

    async def load(self, session_id: str) -> tuple[SessionRecord, list[StoredEvent]] | None: ...

    async def list_open(self, owner: str) -> list[SessionRecord]: ...

    async def prune(self, updated_before: float) -> list[str]: ...
