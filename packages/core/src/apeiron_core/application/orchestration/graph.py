"""Grafo de aplicación: supervisor -> agentes -> rondas -> síntesis."""

import asyncio
import logging
import time
from typing import Any

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from apeiron_core.application.orchestration.state import ApeironState
from apeiron_core.application.ports.outbound.agents import SpecialistAgent
from apeiron_core.application.ports.outbound.events import Emit
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.domain.entities.agent_turn import AgentTurn
from apeiron_core.domain.services.routing import decide_mode

log = logging.getLogger("apeiron.graph")
SYNTH_PROMPT = (
    "Eres Ápeiron, moderador. Sintetiza coincidencias y desacuerdos del debate, "
    "en el idioma de los participantes."
)


def _emitter() -> Emit:
    try:
        writer = get_stream_writer()
    except Exception:
        return lambda _message: None
    return lambda message: writer({"message": message})


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
                    "agent": agent_name,
                    "question": state["question"],
                    "turns": state.get("turns", []),
                    "round": state["round"],
                },
            )
            for agent_name in state["participants"]
        ]

    async def supervisor(state: ApeironState) -> dict[str, Any]:
        mode = state.get("mode") or decide_mode(state["question"])
        participants = list(agents) if mode == "debate" else [default_agent]
        rounds = state.get("max_rounds") or default_rounds
        log.info(
            "route",
            extra={"agent_name": "apeiron", "state_transition": f"supervisor->{mode}"},
        )
        return {
            "mode": mode,
            "participants": participants,
            "round": 0,
            "max_rounds": rounds if mode == "debate" else 1,
            "trace": ["[Ápeiron Routing]"],
        }

    async def agent_turn(payload: dict[str, Any]) -> dict[str, Any]:
        name: str = payload["agent"]
        started = time.perf_counter()
        try:
            async with asyncio.timeout(node_timeout_s):
                text = await agents[name].respond(
                    payload["question"], payload["turns"], _emitter()
                )
        except TimeoutError:
            text = f"[{name} no respondió dentro de {node_timeout_s:.0f}s]"
        log.info(
            "agent_turn",
            extra={
                "agent_name": name,
                "state_transition": f"agent_turn:r{payload['round']}",
                "execution_time_ms": round((time.perf_counter() - started) * 1000, 1),
            },
        )
        turn: AgentTurn = {
            "agent": name,
            "round": payload["round"],
            "text": text,
        }
        return {
            "turns": [turn],
            "trace": [f"[{name} Thinking r{payload['round']}]"],
        }

    async def round_gate(state: ApeironState) -> dict[str, Any]:
        return {"round": state["round"] + 1}

    def after_gate(state: ApeironState) -> list[Send] | str:
        return sends(state) if state["round"] < state["max_rounds"] else "synthesis"

    async def synthesis(state: ApeironState) -> dict[str, Any]:
        turns = state["turns"]
        if state["mode"] == "single":
            return {"answer": turns[0]["text"], "trace": ["[Response Generation]"]}
        transcript = "\n".join(
            f"r{turn['round']} {turn['agent']}: {turn['text']}" for turn in turns
        )
        return {
            "answer": await synthesizer.complete(SYNTH_PROMPT, transcript),
            "trace": ["[Synthesis]"],
        }

    graph = StateGraph(ApeironState)
    graph.add_node("supervisor", supervisor)
    graph.add_node("agent_turn", agent_turn)  # type: ignore[arg-type]  # payload de Send, no ApeironState
    graph.add_node("round_gate", round_gate)
    graph.add_node("synthesis", synthesis)
    graph.add_edge(START, "supervisor")
    graph.add_conditional_edges("supervisor", sends, ["agent_turn"])
    graph.add_edge("agent_turn", "round_gate")
    graph.add_conditional_edges("round_gate", after_gate, ["agent_turn", "synthesis"])
    graph.add_edge("synthesis", END)
    return graph.compile()
