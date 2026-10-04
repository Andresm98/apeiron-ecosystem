"""Piezas compartidas por los workers: diálogo entre agentes y emisión de eventos."""

from langgraph.config import get_stream_writer

from apeiron_core.application.ports.outbound.events import Emit
from apeiron_core.domain.entities.agent_turn import AgentTurn


def dialogue_block(name: str, history: list[AgentTurn]) -> str:
    """Solo la última posición de cada interlocutor: diálogo directo y prompts cortos."""
    latest: dict[str, AgentTurn] = {}
    for turn in history:
        if turn["agent"] != name and not turn["degraded"]:
            latest[turn["agent"]] = turn
    if not latest:
        return ""
    positions = "\n".join(
        f"- {agent} (ronda {turn['round'] + 1}): {turn['text']}"
        for agent, turn in latest.items()
    )
    return (
        "\n\nTu interlocutor acaba de sostener:\n"
        f"{positions}\n"
        "Respóndele directamente: reconoce un acuerdo, formula tu objeción principal "
        "y aporta tu tesis sin repetir lo ya dicho."
    )


def stream_emitter() -> Emit:
    """Publica en el stream `custom` de LangGraph; fuera de un grafo no hace nada."""
    try:
        writer = get_stream_writer()
    except Exception:
        return lambda _message: None
    return lambda message: writer({"message": message})
