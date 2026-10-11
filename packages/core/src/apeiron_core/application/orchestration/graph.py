"""Grafo Ápeiron (supervisor/worker).

    START -> apeiron_router -> <worker> -> apeiron_supervisor -> <worker> | apeiron_synthesis -> END
                  └─ (entrada bloqueada) ───────────────────────────────────────┘

Ápeiron es el orquestador: enruta (modo y participantes), supervisa cada turno decidiendo
el siguiente orador o el cierre, y sintetiza. Cada worker es un nodo con nombre propio; si
expone `graph`, su ciclo ReAct aparece como subgrafo en LangGraph Studio y en el stream.
En debate los workers hablan por turnos: cada uno responde a la última posición del otro.

Deliberación (ADR-013): con `human=True` existe el nodo `human`, que pausa el grafo con `interrupt()` hasta
recibir el turno del usuario; el supervisor respeta el control de la sesión (cerrar, invitar, presupuesto de
tiempo, ritmo `step`, topes duros). Pausar exige checkpointer: lo recibe `build_graph`.

Guardrails (ADR-011), si se configuran: el router valida la entrada, cada worker su turno
(citas contra la evidencia real) y la síntesis la salida. Sin nodos extra: el contrato SSE
y la topología visible no cambian.
"""

import asyncio
import logging
import time
from collections.abc import Collection, Mapping, Sequence
from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from apeiron_core.application.agents.base import interlocutor, stream_emitter
from apeiron_core.application.guardrails import BLOCKED_ANSWER, apply_guardrail
from apeiron_core.application.orchestration.control import (
    HUMAN,
    MAX_PARTICIPANTS,
    OPEN_ENDED_ROUNDS,
    deliberation,
)
from apeiron_core.application.orchestration.state import ApeironInput, ApeironState
from apeiron_core.application.ports.outbound.agents import SpecialistAgent
from apeiron_core.application.ports.outbound.guardrails import GuardrailPort
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.application.usage import current_agent
from apeiron_core.domain.entities.agent_turn import AgentTurn
from apeiron_core.domain.services.routing import decide_agent, decide_mode

log = logging.getLogger("apeiron.graph")

ROUTER = "apeiron_router"
SUPERVISOR = "apeiron_supervisor"
SYNTHESIS = "apeiron_synthesis"
RECURSION_LIMIT = 100  # 4 rondas x 6 participantes x (worker + supervisor) + margen
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
    reserved = [n for n in agents if n.startswith(("apeiron_", "__")) or n == HUMAN]
    if reserved:
        raise ValueError(f"nombres de agente reservados: {reserved}")
    if (
        not participants
        or len(participants) > MAX_PARTICIPANTS
        or len(set(participants)) != len(participants)
        or any(name not in agents for name in participants)
    ):
        raise ValueError(
            f"debate_participants debe contener de 1 a {MAX_PARTICIPANTS} agentes registrados y únicos"
        )


def _worker_node(
    name: str,
    agent: SpecialistAgent,
    node_timeout_s: float,
    guardrails: GuardrailPort | None = None,
) -> Any:
    subgraph = getattr(agent, "graph", None)  # referencia directa: Studio lo detecta

    async def worker(state: ApeironState) -> dict[str, Any]:
        current_agent.set(name)  # tokens por agente (ADR-013, fase 4); solo afecta a esta tarea
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
                            "context": state.get("context", ""),
                        }
                    )
                    text = str(out.get("answer", ""))
                    degraded = bool(out.get("failed"))
                else:
                    context = state.get("context", "")
                    question = f"{state['question']}\n\n{context}" if context else state["question"]
                    text = await agent.respond(question, history, stream_emitter())
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
        turn: AgentTurn = {
            "agent": name,
            "round": state["round"],
            "text": text,
            "degraded": degraded,
            "responds_to": interlocutor(name, history),  # el mismo al que le pidió responder `dialogue_block`
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
    *,
    hints: Mapping[str, Collection[str]] | None = None,
    human: bool = False,
    checkpointer: Any = None,
) -> Any:
    """`hints` son las pistas de enrutado que declara cada agente en su manifiesto (ADR-013, catálogo de agentes)."""
    # Sin lista explícita debaten los primeros registrados; una lista explícita se valida tal cual.
    selected_participants = list(debate_participants) if debate_participants else list(agents)[:MAX_PARTICIPANTS]
    _validate(agents, default_rounds, node_timeout_s, selected_participants)
    default_agent = next(iter(agents))
    routing = {name: (name, *(hints or {}).get(name, ())) for name in agents}  # su nombre siempre lo elige

    async def apeiron_router(state: ApeironState) -> dict[str, Any]:
        verdict, records, messages = await apply_guardrail(
            guardrails, "input", state["question"], agent="apeiron"
        )
        question = verdict.text or state["question"]
        chosen = state.get("agent")
        requested = state.get("participants")
        if chosen is not None and chosen not in agents:
            raise ValueError(f"agente desconocido: {chosen!r}")
        if chosen is not None and (state.get("mode") == "debate" or requested):
            raise ValueError("agent solo aplica en modo single")
        if requested:
            _check_participants(requested)
        mode = "single" if chosen else "debate" if requested else state.get("mode") or decide_mode(question)
        participants = (
            list(requested or selected_participants)
            if mode == "debate"
            else [chosen or decide_agent(question, routing, default_agent)]
        )
        rounds = state.get("max_rounds")
        rounds = default_rounds if rounds is None else rounds
        if not 1 <= rounds <= 4:
            raise ValueError("max_rounds debe estar entre 1 y 4")
        if mode == "debate" and state.get("open_ended"):
            rounds = OPEN_ENDED_ROUNDS
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

    def _check_participants(names: Sequence[str]) -> None:
        allowed = set(agents) | ({HUMAN} if human else set())
        if (
            not 1 <= len(names) <= MAX_PARTICIPANTS
            or len(set(names)) != len(names)
            or any(name not in allowed for name in names)
        ):
            raise ValueError(f"participants debe contener de 1 a {MAX_PARTICIPANTS} participantes válidos y únicos")

    async def apeiron_supervisor(state: ApeironState) -> dict[str, Any]:
        """Elige el siguiente orador o cierra. Puede re-ejecutarse al reanudar: no tiene efectos fuera del estado."""
        control = deliberation.get()
        participants = list(state["participants"])
        trace: list[str] = []
        update: dict[str, Any] = {}
        if control is not None and state["mode"] == "debate":
            allowed = set(agents) | ({HUMAN} if human else set())
            room = MAX_PARTICIPANTS - len(participants)
            joined = [n for n in dict.fromkeys(control.invited) if n in allowed and n not in participants][:room]
            if joined:
                participants += joined
                update["participants"] = participants
                trace += [f"[Ápeiron Inviting → {name}]" for name in joined]
        speaker, rnd = state["speaker"] + 1, state["round"]
        if speaker >= len(participants):
            speaker, rnd = 0, rnd + 1
        reason = control.close_reason() if control is not None else None
        if reason or rnd >= state["max_rounds"]:
            trace.append("[Ápeiron Closing Debate]" if state["mode"] == "debate" else "[Ápeiron Reviewing]")
            if reason:
                update["close_reason"] = reason
                trace.append(f"[Ápeiron Closing: {reason}]")
        else:
            next_speaker = participants[speaker]
            if control is not None and control.pace == "step":
                # Ritmo paso a paso: el grafo espera a que el usuario pida el siguiente turno.
                interrupt({"kind": "advance", "next": next_speaker, "round": rnd})
            elif control is not None and control.turn_delay_s:
                await asyncio.sleep(control.turn_delay_s)  # pausa de lectura entre turnos
            trace.append(f"[Ápeiron Delegating → {next_speaker} r{rnd}]")
        return {**update, "speaker": speaker, "round": rnd, "trace": trace}

    def after_supervisor(state: ApeironState) -> str:
        if state.get("close_reason") or state["round"] >= state["max_rounds"]:
            return SYNTHESIS
        return to_speaker(state)

    async def human_turn(state: ApeironState) -> dict[str, Any]:
        """Turno del usuario: pausa el grafo hasta que la sesión lo reanude con su texto (o sin él)."""
        rnd = state["round"]
        history = state.get("turns", [])
        responds_to = interlocutor(HUMAN, history)
        reply = interrupt({"kind": "human_turn", "round": rnd, "responds_to": responds_to})
        text = str(reply or "").strip()
        if not text:
            return {"trace": [f"[{HUMAN} Silent r{rnd}]"]}
        turn: AgentTurn = {
            "agent": HUMAN, "round": rnd, "text": text, "degraded": False, "responds_to": responds_to,
        }
        return {"turns": [turn], "trace": [f"[{HUMAN} Speaking r{rnd}]"]}

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

    workers = [*agents, *([HUMAN] if human else [])]
    graph = StateGraph(ApeironState, input_schema=ApeironInput)
    graph.add_node(ROUTER, apeiron_router)
    for name, agent in agents.items():
        graph.add_node(name, _worker_node(name, agent, node_timeout_s, guardrails))
        graph.add_edge(name, SUPERVISOR)
    if human:
        graph.add_node(HUMAN, human_turn)
        graph.add_edge(HUMAN, SUPERVISOR)
    graph.add_node(SUPERVISOR, apeiron_supervisor)
    graph.add_node(SYNTHESIS, apeiron_synthesis)
    graph.add_edge(START, ROUTER)
    graph.add_conditional_edges(ROUTER, after_router, [*workers, SYNTHESIS])
    graph.add_conditional_edges(SUPERVISOR, after_supervisor, [*workers, SYNTHESIS])
    graph.add_edge(SYNTHESIS, END)
    return graph.compile(name="apeiron", checkpointer=checkpointer).with_config(recursion_limit=RECURSION_LIMIT)
