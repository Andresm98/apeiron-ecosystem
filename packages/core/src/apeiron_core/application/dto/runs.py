"""Registro persistente de una ejecución del grafo Ápeiron."""

from typing import Any, Literal, TypedDict

RunStatus = Literal["completed", "error"]


class AgentRun(TypedDict):
    user_id: str
    trace_id: str
    question: str
    mode: str
    simulate: bool
    status: RunStatus
    answer: str
    turns: list[dict[str, Any]]
    trace: list[str]
    usage: dict[str, int]
    model: str
    duration_ms: int
    error: str | None
