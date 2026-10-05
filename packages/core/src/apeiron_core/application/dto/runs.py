"""Registro persistente de una ejecución del grafo Ápeiron."""

from typing import Any, Literal, TypedDict

RunStatus = Literal["completed", "blocked", "error"]


class AgentExecution(TypedDict):
    """Qué hizo un agente (orquestador o worker) dentro de una ejecución."""

    agent_id: str
    invocations: int
    reasoning_steps: int
    tool_calls: int
    tools_used: list[str]
    degraded: bool
    duration_ms: int


class AgentRun(TypedDict):
    user_id: str
    trace_id: str
    channel: str  # web | a2a
    a2a_task_id: str | None
    question: str
    mode: str
    simulate: bool
    status: RunStatus
    answer: str
    turns: list[dict[str, Any]]
    trace: list[str]
    steps: list[dict[str, Any]]  # evidencia ReAct pública (tool, entrada, observación)
    guardrails: list[dict[str, Any]]  # veredictos no triviales (etapa, acción, reglas); sin texto
    agents: list[AgentExecution]
    usage: dict[str, int]
    model: str
    duration_ms: int
    error: str | None
