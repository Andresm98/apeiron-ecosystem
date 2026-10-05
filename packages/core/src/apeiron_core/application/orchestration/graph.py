"""Grafo Ápeiron (supervisor/worker).

    START -> apeiron_router -> <worker> -> apeiron_supervisor -> <worker> | apeiron_synthesis -> END
                  └─ (entrada bloqueada) ───────────────────────────────────────┘

Ápeiron es el orquestador: enruta (modo y participantes), supervisa cada turno decidiendo
el siguiente orador o el cierre, y sintetiza. Cada worker es un nodo con nombre propio; si
expone `graph`, su ciclo ReAct aparece como subgrafo en LangGraph Studio y en el stream.
En debate los workers hablan por turnos: cada uno responde a la última posición del otro.

Guardrails (ADR-011), si se configuran: el router valida la entrada, cada worker su turno
(citas contra la evidencia real) y la síntesis la salida. Sin nodos extra: el contrato SSE
y la topología visible no cambian.
"""

import asyncio
import logging
import time
from collections.abc import Sequence
from typing import Any

from langgraph.graph import END, START, StateGraph

from apeiron_core.application.agents.base import stream_emitter
from apeiron_core.application.guardrails import BLOCKED_ANSWER, apply_guardrail
from apeiron_core.application.orchestration.state import ApeironInput, ApeironState
from apeiron_core.application.ports.outbound.agents import SpecialistAgent
from apeiron_core.application.ports.outbound.guardrails import GuardrailPort
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.domain.entities.agent_turn import AgentTurn
from apeiron_core.domain.services.routing import decide_agent, decide_mode

log = logging.getLogger("apeiron.graph")

ROUTER = "apeiron_router"
SUPERVISOR = "apeiron_supervisor"
SYNTHESIS = "apeiron_synthesis"
RECURSION_LIMIT = 100  # 4 rondas x 4 workers x (worker + supervisor) + margen
SYNTH_PROMPT = (
    "Eres Ápeiron, moderador. Sintetiza en un párrafo breve las coincidencias y "
    "desacuerdos del debate, en el idioma de los participantes."
)


def _validate(
    agents: dict[str, SpecialistAgent],
    default_rounds: int,
    node_timeout_s: float,
    participants: list[str],
) -> None:
    if not agents:
        raise ValueError("Se requiere al menos un agente registrado")
    if not 1 <= default_rounds <= 4:
        raise ValueError("default_rounds debe estar entre 1 y 4")
    if not 0 < node_timeout_s <= 300:
        raise ValueError("node_timeout_s debe estar entre 0 y 300")
    reserved = [n for n in agents if n.startswith(("apeiron_", "__"))]
    if reserved:
        raise ValueError(f"nombres de agente reservados: {reserved}")
    if (
        not participants
        or len(participants) > 4
        or len(set(participants)) != len(participants)
        or any(name not in agents for name in participants)
    ):
        raise ValueError(
            "debate_participants debe contener de 1 a 4 agentes registrados y únicos"
        )


def _worker_node(
    name: str,
    agent: SpecialistAgent,
    node_timeout_s: float,
    guardrails: GuardrailPort | None = None,
) -> Any:
    subgraph = getattr(agent, "graph", None)  # referencia directa: Studio lo detecta

    async def worker(state: ApeironState) -> dict[str, Any]:
        history = state.get("turns", [])
        started = time.perf_counter()
        degraded = False
        out: dict[str, Any] = {}
        try:
            async with asyncio.timeout(node_timeout_s):
                if subgraph is not None:
                    out = await subgraph.ainvoke(
                        {
                            "question": state["question"],
                            "history": history,
                            "round": state["round"],
                        }
                    )
                    text = str(out.get("answer", ""))
                    degraded = bool(out.get("failed"))
                else:
                    text = await agent.respond(
                        state["question"], history, stream_emitter()
                    )
        except TimeoutError:
            text = f"[{name} no respondió dentro de {node_timeout_s:.0f}s]"
            degraded = True
        except Exception as exc:
            log.warning("agent_turn_failed", extra={"agent_name": name, "error": type(exc).__name__})
            text = f"[{name}: turno degradado por un fallo del agente]"
            degraded = True
        evidence: list[str] = list(out.get("evidence", []))
        records = list(out.get("guardrails", []))
        messages: list[str] = []
        if not degraded:
            # Citas contra la evidencia de toda la ejecución: la propia y la de turnos previos.
            verdict, turn_records, messages = await apply_guardrail(
                guardrails,
                "turn",
                text,
                agent=name,
                round_=state["round"],
                evidence=[*state.get("evidence", []), *evidence],
            )
            text = verdict.text
            records += turn_records
        log.info(
            "agent_turn",
            extra={
                "agent_name": name,
                "state_transition": f"{name}:r{state['round']}",
                "execution_time_ms": round((time.perf_counter() - started) * 1000, 1),
            },
        )
        interlocutor = next(
            (t["agent"] for t in reversed(history) if t["agent"] != name and not t["degraded"]),
            None,
        )
        turn: AgentTurn = {
            "agent": name,
            "round": state["round"],
            "text": text,
            "degraded": degraded,
            "responds_to": interlocutor,
        }
        return {
            "turns": [turn],
            "trace": [f"[{name} Thinking r{state['round']}]", *messages],
            "evidence": evidence,
            "guardrails": records,
        }

    return worker


def build_graph(
    agents: dict[str, SpecialistAgent],
    synthesizer: LLMPort,
    default_rounds: int = 2,
    node_timeout_s: float = 60.0,
    debate_participants: Sequence[str] | None = None,
    guardrails: GuardrailPort | None = None,
) -> Any:
    selected_participants = list(debate_participants or agents)
    _validate(agents, default_rounds, node_timeout_s, selected_participants)
    default_agent = next(iter(agents))

    async def apeiron_router(state: ApeironState) -> dict[str, Any]:
        verdict, records, messages = await apply_guardrail(
            guardrails, "input", state["question"], agent="apeiron"
        )
        question = verdict.text or state["question"]
        mode = state.get("mode") or decide_mode(question)
        participants = (
            selected_participants
            if mode == "debate"
            else [decide_agent(question, agents, default_agent)]
        )
        rounds = state.get("max_rounds")
        rounds = default_rounds if rounds is None else rounds
        if not 1 <= rounds <= 4:
            raise ValueError("max_rounds debe estar entre 1 y 4")
        update: dict[str, Any] = {
            "mode": mode,
            "participants": participants,
            "round": 0,
            "speaker": 0,
            "max_rounds": rounds if mode == "debate" else 1,
            "guardrails": records,
        }
        if verdict.action == "block":
            log.info("route", extra={"agent_name": "apeiron", "state_transition": "router->blocked"})
            return {**update, "blocked": True, "trace": ["[Ápeiron Routing]", *messages]}
        log.info(
            "route",
            extra={"agent_name": "apeiron", "state_transition": f"router->{mode}"},
        )
        if verdict.action == "redact":
            update["question"] = question  # los workers solo ven la pregunta saneada
        return {
            **update,
            "trace": ["[Ápeiron Routing]", *messages, f"[Ápeiron Delegating → {participants[0]} r0]"],
        }

    def after_router(state: ApeironState) -> str:
        return SYNTHESIS if state.get("blocked") else to_speaker(state)

    def to_speaker(state: ApeironState) -> str:
        return state["participants"][state["speaker"]]

    async def apeiron_supervisor(state: ApeironState) -> dict[str, Any]:
        speaker, rnd = state["speaker"] + 1, state["round"]
        if speaker >= len(state["participants"]):
            speaker, rnd = 0, rnd + 1
        if rnd >= state["max_rounds"]:
            message = "[Ápeiron Closing Debate]" if state["mode"] == "debate" else "[Ápeiron Reviewing]"
        else:
            message = f"[Ápeiron Delegating → {state['participants'][speaker]} r{rnd}]"
        return {"speaker": speaker, "round": rnd, "trace": [message]}

    def after_supervisor(state: ApeironState) -> str:
        return SYNTHESIS if state["round"] >= state["max_rounds"] else to_speaker(state)

    async def apeiron_synthesis(state: ApeironState) -> dict[str, Any]:
        if state.get("blocked"):
            return {"answer": BLOCKED_ANSWER, "trace": ["[Synthesis]"]}
        answer, label = await compose(state)
        verdict, records, messages = await apply_guardrail(
            guardrails,
            "output",
            answer,
            agent="apeiron",
            round_=state["round"],
            evidence=state.get("evidence", []),
        )
        return {"answer": verdict.text, "trace": [label, *messages], "guardrails": records}

    async def compose(state: ApeironState) -> tuple[str, str]:
        turns = state["turns"]
        if state["mode"] == "single":
            return turns[0]["text"], "[Response Generation]"
        if turns and all(t["degraded"] for t in turns):
            return "Síntesis degradada; ningún especialista completó un turno.", "[Synthesis]"
        transcript = "\n".join(
            f"r{turn['round']} {turn['agent']}: {turn['text']}" for turn in turns
        )
        try:
            async with asyncio.timeout(node_timeout_s):
                answer = await synthesizer.complete(SYNTH_PROMPT, transcript)
        except Exception:
            log.warning("synthesis_failed", extra={"turn_count": len(turns)})
            completed = [turn for turn in turns if not turn["degraded"]]
            if completed:
                transcript = "\n".join(
                    f"r{turn['round']} {turn['agent']}: {turn['text']}"
                    for turn in completed
                )
                answer = f"Síntesis degradada; turnos completados:\n{transcript}"
            else:
                answer = "Síntesis degradada; ningún especialista completó un turno."
        return answer, "[Synthesis]"

    workers = list(agents)
    graph = StateGraph(ApeironState, input_schema=ApeironInput)
    graph.add_node(ROUTER, apeiron_router)
    for name, agent in agents.items():
        graph.add_node(name, _worker_node(name, agent, node_timeout_s, guardrails))
        graph.add_edge(name, SUPERVISOR)
    graph.add_node(SUPERVISOR, apeiron_supervisor)
    graph.add_node(SYNTHESIS, apeiron_synthesis)
    graph.add_edge(START, ROUTER)
    graph.add_conditional_edges(ROUTER, after_router, [*workers, SYNTHESIS])
    graph.add_conditional_edges(SUPERVISOR, after_supervisor, [*workers, SYNTHESIS])
    graph.add_edge(SYNTHESIS, END)
    return graph.compile(name="apeiron").with_config(recursion_limit=RECURSION_LIMIT)
