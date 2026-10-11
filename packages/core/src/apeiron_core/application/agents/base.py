"""Piezas compartidas por los workers: diálogo entre agentes y emisión de eventos."""

from typing import Any

from langgraph.config import get_stream_writer

from apeiron_core.application.ports.outbound.events import Emit
from apeiron_core.domain.entities.agent_turn import AgentTurn


def interlocutor(name: str, history: list[AgentTurn]) -> str | None:
    """A quién responde `name`: el último orador no degradado distinto de él (el `responds_to` del turno)."""
    return next((t["agent"] for t in reversed(history) if t["agent"] != name and not t["degraded"]), None)


def _position(turn: AgentTurn) -> str:
    return f"- {turn['agent']} (ronda {turn['round'] + 1}): {turn['text']}"


def dialogue_block(name: str, history: list[AgentTurn]) -> str:
    """Solo la última posición de cada interlocutor: diálogo directo y prompts cortos.

    El interlocutor va solo y primero (el mismo que el grafo registra en `responds_to`); el resto de la mesa,
    del más reciente al más antiguo, queda como contexto. Si se mezclaran, el agente respondería a otro.
    """
    latest: dict[str, AgentTurn] = {}
    for turn in history:
        if turn["agent"] != name and not turn["degraded"]:
            latest.pop(turn["agent"], None)  # reinsertar: el orden del dict es el de la última intervención
            latest[turn["agent"]] = turn
    if not latest:
        return ""
    *others, current = latest.values()
    block = f"\n\nTu interlocutor acaba de sostener:\n{_position(current)}\n"
    if others:
        table = "\n".join(_position(turn) for turn in reversed(others))
        block += f"Antes hablaron en la mesa (contexto; no les respondas a ellos):\n{table}\n"
    return block + (
        "Respóndele directamente desde tu función y con tu propia forma: no adoptes su estructura "
        "ni repitas su conclusión; muestra lo que su posición no ve desde tu método."
    )


def stream_emitter() -> Emit:
    """Publica en el stream `custom` de LangGraph; fuera de un grafo no hace nada."""
    try:
        writer = get_stream_writer()
    except Exception:
        return lambda _message: None
    return lambda message: writer({"message": message})


def emit_step(message: str, step: dict[str, Any]) -> None:
    """Paso ReAct observable (tool, entrada, observación) para UI, trazas y persistencia."""
    try:
        writer = get_stream_writer()
    except Exception:
        return
    writer({"message": message, "step": step})
