"""Grafo Ápeiron: supervisor -> fan-out de agentes -> round_gate -> síntesis."""
import asyncio
import logging
import time
from typing import Any

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from apeiron_core.domain.ports import Emit, LLMPort, SpecialistAgent
from apeiron_core.domain.routing import decide_mode
from apeiron_core.orchestration.state import ApeironState

log = logging.getLogger("apeiron.graph")
SYNTH_PROMPT = (
    "Eres Ápeiron, moderador. Sintetiza coincidencias y desacuerdos del debate, "
    "en el idioma de los participantes."
)


def _emitter() -> Emit:
    try:
        writer = get_stream_writer()
    except Exception:  # fuera de contexto de streaming
        return lambda _m: None
    return lambda m: writer({"message": m})


def build_graph(
    agents: dict[str, SpecialistAgent],
    synthesizer: LLMPort,
    default_rounds: int = 2,
    node_timeout_s: float = 60.0,
) -> Any:
    default_agent = next(iter(agents))

    def sends(state: ApeironState) -> list[Send]:
        return [
            Send(
                "agent_turn",
                {
                    "agent": a,
                    "question": state["question"],
                    "turns": state.get("turns", []),
                    "round": state["round"],
                },
            )
            for a in state["participants"]
        ]

    async def supervisor(state: ApeironState) -> dict[str, Any]:
        mode = state.get("mode") or decide_mode(state["question"])
        participants = list(agents) if mode == "debate" else [default_agent]
        rounds = state.get("max_rounds") or default_rounds
        log.info("route", extra={"agent_name": "apeiron", "state_transition": f"supervisor->{mode}"})
        return {
            "mode": mode,
            "participants": participants,
            "round": 0,
            "max_rounds": rounds if mode == "debate" else 1,
            "trace": ["[Ápeiron Routing]"],
        }

    async def agent_turn(p: dict[str, Any]) -> dict[str, Any]:
        name: str = p["agent"]
        started = time.perf_counter()
        try:
            async with asyncio.timeout(node_timeout_s):
                text = await agents[name].respond(p["question"], p["turns"], _emitter())
        except TimeoutError:
            text = f"[{name} no respondió dentro de {node_timeout_s:.0f}s]"
        log.info(
            "agent_turn",
            extra={
                "agent_name": name,
                "state_transition": f"agent_turn:r{p['round']}",
                "execution_time_ms": round((time.perf_counter() - started) * 1000, 1),
            },
        )
        return {
            "turns": [{"agent": name, "round": p["round"], "text": text}],
            "trace": [f"[{name} Thinking r{p['round']}]"],
        }

    async def round_gate(state: ApeironState) -> dict[str, Any]:
        return {"round": state["round"] + 1}

    def after_gate(state: ApeironState) -> list[Send] | str:
        return sends(state) if state["round"] < state["max_rounds"] else "synthesis"

    async def synthesis(state: ApeironState) -> dict[str, Any]:
        turns = state["turns"]
        if state["mode"] == "single":
            return {"answer": turns[0]["text"], "trace": ["[Response Generation]"]}
        transcript = "\n".join(f"r{t['round']} {t['agent']}: {t['text']}" for t in turns)
        return {
            "answer": await synthesizer.complete(SYNTH_PROMPT, transcript),
            "trace": ["[Synthesis]"],
        }

    g = StateGraph(ApeironState)
    g.add_node("supervisor", supervisor)
    g.add_node("agent_turn", agent_turn)  # type: ignore[arg-type]  # payload de Send, no ApeironState
    g.add_node("round_gate", round_gate)
    g.add_node("synthesis", synthesis)
    g.add_edge(START, "supervisor")
    g.add_conditional_edges("supervisor", sends, ["agent_turn"])
    g.add_edge("agent_turn", "round_gate")
    g.add_conditional_edges("round_gate", after_gate, ["agent_turn", "synthesis"])
    g.add_edge("synthesis", END)
    return g.compile()
