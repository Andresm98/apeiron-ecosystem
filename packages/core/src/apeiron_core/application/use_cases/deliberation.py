"""Sesiones deliberativas (ADR-013): un debate con vida propia en el que el usuario participa.

Cada sesión corre en su propia `asyncio.Task` (sobrevive a la desconexión del cliente) sobre un grafo con
checkpointer. El grafo se pausa con `interrupt()` en el turno del usuario (`human`) y, con ritmo `step`,
antes de cada turno; la sesión espera la orden correspondiente (o el plazo) y lo reanuda con
`Command(resume=...)`. Los eventos públicos se numeran para que el cliente pueda reengancharse (`after=N`).

Durabilidad (fase 5): con un diario (`SessionJournalPort`) y un checkpointer persistente, una sesión abierta
sobrevive a un reinicio de la API. Queda dormida hasta que su dueño vuelve (con un token fresco: el diario nunca
guarda credenciales); entonces se rehidrata y el grafo continúa desde su último checkpoint. Sin diario, todo vive
en memoria y por instancia, como las tareas A2A.
"""

import asyncio
import contextvars
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import asdict, dataclass, field, replace
from typing import Any, Literal

from langgraph.types import Command

from apeiron_core.application.context import RequestContext, request_ctx
from apeiron_core.application.dto.chat import ChatEvent
from apeiron_core.application.guardrails import apply_guardrail
from apeiron_core.application.orchestration.control import (
    HUMAN,
    DeliberationControl,
    Pace,
    deliberation,
)
from apeiron_core.application.ports.outbound.guardrails import GuardrailPort
from apeiron_core.application.ports.outbound.sessions import SessionJournalPort, SessionRecord, StoredEvent
from apeiron_core.application.usage import TokenUsage, usage_meter
from apeiron_core.application.use_cases.chat import ApeironFacade
from apeiron_core.application.use_cases.execution import ExecutionCollector
from apeiron_core.domain.value_objects.mode import Mode

log = logging.getLogger("apeiron.sessions")

SessionStatus = Literal["running", "waiting", "closing", "completed", "cancelled", "error"]
TERMINAL: frozenset[str] = frozenset({"completed", "cancelled", "error"})
SESSION_RECURSION_LIMIT = 600  # debates abiertos: los cierran el usuario y los topes duros, no las rondas
_FINISHED = object()  # el grafo ya había terminado antes del reinicio: solo falta cerrar la sesión


class SessionError(Exception):
    """Orden inválida para el estado actual de la sesión (la API la traduce a 409)."""


class SessionLimitError(SessionError):
    """El usuario ya tiene demasiadas sesiones activas (la API la traduce a 429)."""


@dataclass(frozen=True)
class SessionConfig:
    question: str
    mode: Mode | None = None
    agent: str | None = None
    participants: list[str] | None = None
    max_rounds: int | None = None
    open_ended: bool = False
    time_budget_s: int | None = None
    pace: Pace = "auto"
    turn_delay_s: float = 0.0
    human_turn_timeout_s: int = 240
    simulate: bool = False

    def graph_input(self) -> dict[str, Any]:
        inputs: dict[str, Any] = {"question": self.question}
        for key in ("mode", "agent", "participants", "max_rounds"):
            if (value := getattr(self, key)) is not None:
                inputs[key] = value
        if self.open_ended:
            inputs["open_ended"] = True
        return inputs

    def public(self) -> dict[str, Any]:
        """Configuración que se persiste con la ejecución (sin la pregunta, que ya tiene columna)."""
        data = asdict(self)
        data.pop("question")
        return data


@dataclass
class Waiting:
    kind: Literal["human_turn", "advance"]
    deadline: float | None  # epoch (s) para el cliente; None = sin plazo propio
    detail: dict[str, Any]


@dataclass
class DeliberationSession:
    id: str
    owner: str
    config: SessionConfig
    control: DeliberationControl
    context: RequestContext
    status: SessionStatus = "running"
    waiting: Waiting | None = None
    reason: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    deadline: float | None = None  # epoch del presupuesto de tiempo (el control usa el reloj monotónico)
    hard_deadline: float | None = None
    events: list[tuple[int, ChatEvent]] = field(default_factory=list)
    collector: ExecutionCollector = field(default_factory=ExecutionCollector)
    meter: TokenUsage = field(default_factory=TokenUsage)
    runner: asyncio.Task[None] | None = None
    dormant: bool = False  # rehidratada desde el diario y aún sin reanudar (espera a su dueño)
    cancel_requested: bool = False
    on_event: Callable[[StoredEvent], None] | None = None  # el servicio lo conecta al diario
    on_status: Callable[[], None] | None = None
    _changed: asyncio.Event = field(default_factory=asyncio.Event)
    _reply: asyncio.Future[Any] | None = None

    @property
    def finished(self) -> bool:
        return self.status in TERMINAL

    def publish(self, event: ChatEvent) -> None:
        seq = len(self.events) + 1
        self.events.append((seq, event))
        self.updated_at = time.time()
        self._changed.set()
        if self.on_event is not None:
            self.on_event(StoredEvent(seq, round((self.updated_at - self.created_at) * 1000), event.type, event.data))

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "waiting": self.waiting.kind if self.waiting else None,
            "deadline": self.waiting.deadline if self.waiting else None,
            **(self.waiting.detail if self.waiting else {}),
            "participants": self.collector.participants,
            "reason": self.reason,
            "last_event": len(self.events),
        }

    def record(self) -> SessionRecord:
        return {
            "id": self.id,
            "owner": self.owner,
            "trace_id": self.context.trace_id,
            "config": asdict(self.config),
            "status": self.status,
            "reason": self.reason,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "deadline": self.deadline,
            "hard_deadline": self.hard_deadline,
            "usage": self.meter.snapshot(),
        }

    def set_status(self, status: SessionStatus, reason: str | None = None) -> None:
        self.status = status
        if reason:
            self.reason = reason
        self.publish(ChatEvent("session", self.snapshot()))
        if self.on_status is not None:
            self.on_status()

    async def follow(self, after: int = 0) -> AsyncIterator[tuple[int, ChatEvent]]:
        """Eventos con número > `after`, primero los ya ocurridos y luego en vivo hasta que termine."""
        cursor = after
        while True:
            self._changed.clear()
            pending = self.events[cursor:]
            for seq, event in pending:
                yield seq, event
            cursor += len(pending)
            if self.finished and cursor >= len(self.events):
                return
            await self._changed.wait()

    def resolve(self, kind: str, value: Any) -> None:
        if self.waiting is None or self.waiting.kind != kind or self._reply is None or self._reply.done():
            raise SessionError(f"la sesión no espera {kind}")
        self._reply.set_result(value)

    def release(self) -> None:
        """Libera cualquier espera (al cerrar o cancelar): el turno humano queda vacío y el avance concedido."""
        if self._reply is not None and not self._reply.done():
            self._reply.set_result(None)


def _monotonic(epoch: float | None) -> float | None:
    """Plazo de pared (persistible) -> reloj monotónico del proceso actual."""
    return None if epoch is None else time.monotonic() + (epoch - time.time())


class DeliberationService:
    def __init__(
        self,
        facade: ApeironFacade,
        graph: Any,
        simulation_graph: Any,
        checkpointer: Any,
        guardrails: GuardrailPort | None = None,
        *,
        journal: SessionJournalPort | None = None,
        max_llm_calls: int = 60,
        max_duration_s: float = 1800,
        max_active_per_user: int = 3,
        ttl_s: float = 3600,
        max_sessions: int = 500,
    ) -> None:
        self._facade = facade
        self._graph = graph
        self._simulation_graph = simulation_graph
        self._checkpointer = checkpointer
        self._guardrails = guardrails
        self._journal = journal
        self._max_llm_calls = max_llm_calls
        self._max_duration_s = max_duration_s
        self._max_active = max_active_per_user
        self._ttl_s = ttl_s
        self._max_sessions = max_sessions
        self._sessions: dict[str, DeliberationSession] = {}
        self._outbox: asyncio.Queue[tuple[str, Any]] | None = None
        self._writer: asyncio.Task[None] | None = None
        self._closing = False

    @property
    def durable(self) -> bool:
        return self._journal is not None

    # Consultas -------------------------------------------------------------------------------

    async def get(self, session_id: str, owner: str) -> DeliberationSession | None:
        """La sesión del usuario. Si solo está en el diario (la API se reinició), se rehidrata y se reanuda."""
        session = self._sessions.get(session_id)
        if session is None and self._journal is not None:
            session = await self._restore(session_id, owner)
        if session is None or session.owner != owner:
            return None  # ajenas = inexistentes
        if session.dormant:
            self._wake(session)
        return session

    async def list_open(self, owner: str) -> list[dict[str, Any]]:
        """Sesiones abiertas del usuario (en memoria o dormidas en el diario), para retomarlas."""
        found = {
            s.id: {**s.snapshot(), "question": s.config.question, "created_at": s.created_at}
            for s in self._sessions.values()
            if s.owner == owner and not s.finished
        }
        if self._journal is not None:
            for record in await self._journal.list_open(owner):
                # La memoria manda: el diario puede ir unos eventos por detrás de una sesión viva.
                if record["id"] not in self._sessions and not self._expired(record):
                    found[record["id"]] = {
                        "id": record["id"],
                        "status": record["status"],
                        "question": record["config"].get("question", ""),
                        "created_at": record["created_at"],
                        "dormant": True,
                    }
        return sorted(found.values(), key=lambda item: -float(item["created_at"]))

    def counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for session in self._sessions.values():
            counts[session.status] = counts.get(session.status, 0) + 1
        return counts

    # Órdenes del usuario ---------------------------------------------------------------------

    async def start(self, owner: str, config: SessionConfig) -> DeliberationSession:
        self._prune()
        active = len(await self.list_open(owner))
        if active >= self._max_active:
            raise SessionLimitError(f"máximo {self._max_active} sesiones activas por usuario")
        now = time.time()
        session_id = uuid.uuid4().hex
        context = RequestContext(**{**asdict(request_ctx.get()), "channel": "session", "session_id": session_id})
        session = DeliberationSession(
            session_id,
            owner,
            config,
            DeliberationControl(pace=config.pace, turn_delay_s=config.turn_delay_s, max_calls=self._max_llm_calls),
            context,
            created_at=now,
            deadline=now + config.time_budget_s if config.time_budget_s else None,
            hard_deadline=now + self._max_duration_s,
        )
        session.control.deadline = _monotonic(session.deadline)
        session.control.hard_deadline = _monotonic(session.hard_deadline)
        self._attach(session)
        self._sessions[session_id] = session
        self._spawn(session, resume=False)
        return session

    async def submit_turn(self, session: DeliberationSession, text: str) -> dict[str, Any]:
        """Turno de ssanax. Pasa el guardrail de entrada: si lo bloquea, la sesión sigue esperando."""
        if session.waiting is None or session.waiting.kind != "human_turn":
            raise SessionError("no es el turno del usuario")
        verdict, records, _ = await apply_guardrail(
            self._guardrails, "input", text, agent=HUMAN, round_=session.waiting.detail.get("round", 0)
        )
        for record in records:
            session.collector.guardrails.append(dict(record))
            event = ChatEvent("guard", dict(record))
            session.collector.mark(event)
            session.publish(event)
        if verdict.action == "block":
            return {"accepted": False, "rules": list(verdict.rules)}
        session.resolve("human_turn", verdict.text or text)
        return {"accepted": True, "redacted": verdict.action == "redact"}

    def advance(self, session: DeliberationSession) -> None:
        session.resolve("advance", True)

    def invite(self, session: DeliberationSession, agent: str) -> None:
        if session.finished or session.status == "closing":
            raise SessionError("la sesión ya no admite invitados")
        if agent not in session.control.invited:
            session.control.invited.append(agent)
        session.publish(ChatEvent("trace", {"messages": [f"[Ápeiron Invitation → {agent}]"]}))

    def close(self, session: DeliberationSession) -> None:
        if session.finished:
            raise SessionError("la sesión ya terminó")
        session.control.close_requested = True
        session.release()

    def cancel(self, session: DeliberationSession) -> None:
        if session.runner is not None and not session.runner.done():
            session.cancel_requested = True
            session.runner.cancel()

    async def shutdown(self) -> None:
        """Parada de la API: las sesiones abiertas quedan dormidas en el diario (no se cancelan ni se cierran)."""
        self._closing = True
        runners = [s.runner for s in self._sessions.values() if s.runner is not None and not s.runner.done()]
        for runner in runners:
            runner.cancel()
        if runners:
            await asyncio.wait(runners, timeout=5)
        await self.flush()
        if self._writer is not None:
            self._writer.cancel()

    async def flush(self) -> None:
        """Espera a que el diario haya escrito todo lo publicado (tests y parada ordenada)."""
        if self._outbox is not None:
            await self._outbox.join()

    # Ejecución -------------------------------------------------------------------------------

    def _spawn(self, session: DeliberationSession, *, resume: bool) -> None:
        # Contexto limpio: la sesión no hereda el de la petición HTTP que la creó (patrón de A2A).
        session.runner = asyncio.get_running_loop().create_task(
            self._run(session, resume=resume), name=f"session-{session.id}", context=contextvars.Context()
        )

    async def _run(self, session: DeliberationSession, *, resume: bool) -> None:
        request_ctx.set(session.context)
        deliberation.set(session.control)
        usage_meter.set(session.meter)
        config = session.config
        run = session.collector
        run.mode = run.mode or config.mode or ""
        started = time.perf_counter() - (time.time() - session.created_at)  # la duración cuenta desde el inicio
        graph = self._simulation_graph if config.simulate else self._graph
        run_config = {
            **self._facade.run_config(config.simulate, "apeiron_session"),
            "configurable": {"thread_id": session.id},
            "recursion_limit": SESSION_RECURSION_LIMIT,
        }
        self._facade.metrics.run_started()
        session.set_status("running")
        interrupted = False
        try:
            inputs: Any = await self._resume_input(session, graph, run_config) if resume else config.graph_input()
            while inputs is not _FINISHED:
                async for namespace, kind, chunk in graph.astream(
                    inputs, run_config, stream_mode=["tasks", "updates", "custom"], subgraphs=True
                ):
                    for event in run.consume(namespace, kind, chunk):
                        session.publish(event)
                pending = run.take_interrupts()
                if not pending:
                    break
                inputs = Command(resume=await self._wait(session, pending[0]))
            session.set_status("closing", run.close_reason or None)
            session.publish(await self._facade.finish(config.question, config.simulate, started, session.meter, run,
                                                      config=config.public()))
            session.set_status("completed")
        except asyncio.CancelledError:
            if self._closing and not session.cancel_requested:
                interrupted = True  # parada de la API: la sesión sigue abierta en el diario y en el checkpointer
                raise
            await self._facade.record(config.question, config.simulate, started, session.meter, run,
                                      error=asyncio.CancelledError(), config=config.public())
            session.set_status("cancelled", "cancelled_by_user")
        except Exception as exc:
            log.exception("session_failed", extra={"session_id": session.id})
            await self._facade.record(config.question, config.simulate, started, session.meter, run,
                                      error=exc, config=config.public())
            session.publish(ChatEvent("error", {"message": "internal_error", "trace_id": session.context.trace_id}))
            session.set_status("error", "internal_error")
        finally:
            session.waiting = None
            self._facade.metrics.run_finished()
            if not interrupted:
                try:
                    await self._checkpointer.adelete_thread(session.id)
                except Exception:
                    log.warning("session_checkpoint_cleanup_failed", extra={"session_id": session.id})

    async def _resume_input(self, session: DeliberationSession, graph: Any, run_config: dict[str, Any]) -> Any:
        """Qué darle al grafo al rehidratar: la respuesta a su interrupción, `None` (seguir) o nada (ya terminó)."""
        snapshot = await graph.aget_state(run_config)
        values = dict(snapshot.values or {})
        if not values:  # el grafo no llegó a guardar ningún checkpoint: empieza de nuevo
            return session.config.graph_input()
        run = session.collector
        run.mode = values.get("mode", run.mode)
        run.participants = values.get("participants") or run.participants
        run.close_reason = values.get("close_reason") or run.close_reason
        log.info("session_resumed", extra={"session_id": session.id})
        pending = [i.value for i in snapshot.interrupts if isinstance(i.value, dict)]
        if pending:
            return Command(resume=await self._wait(session, pending[0]))
        if snapshot.next:
            return None  # continúa desde el último checkpoint
        run.answer = values.get("answer", run.answer)
        return _FINISHED

    async def _wait(self, session: DeliberationSession, request: dict[str, Any]) -> Any:
        """Publica la espera y devuelve lo que reanuda el grafo: el texto del usuario, None o True."""
        kind: Literal["human_turn", "advance"] = "advance" if request.get("kind") == "advance" else "human_turn"
        control = session.control
        if control.close_requested:  # cerró mientras el grafo corría: no hay nada que esperar
            return "" if kind == "human_turn" else True
        limits = [d for d in (control.next_deadline(),) if d is not None]
        if kind == "human_turn":
            limits.append(time.monotonic() + session.config.human_turn_timeout_s)
        timeout = max(0.0, min(limits) - time.monotonic()) if limits else None
        deadline = time.time() + timeout if timeout is not None else None
        detail = {k: v for k, v in request.items() if k != "kind"}
        session.waiting = Waiting(kind, deadline, detail)
        session._reply = asyncio.get_running_loop().create_future()
        session.set_status("waiting")
        try:
            value = await asyncio.wait_for(asyncio.shield(session._reply), timeout)
        except TimeoutError:
            value = None  # turno vacío o, si venció el tiempo, el supervisor cerrará al reanudar
            if kind == "human_turn":
                event = ChatEvent("trace", {"messages": ["[human Timeout]"]})
                session.collector.mark(event)
                session.publish(event)
        session.waiting = None
        session._reply = None
        session.set_status("running")
        # Nunca se reanuda con None: LangGraph 1.2 falla con `Command(resume=None)`. Turno vacío = "".
        return (value or "") if kind == "human_turn" else True

    # Diario (durabilidad) -----------------------------------------------------------------------

    def _attach(self, session: DeliberationSession, *, new: bool = True) -> None:
        """Conecta la sesión al diario: cada evento y cada cambio de estado se escriben en orden."""
        if self._journal is None:
            return
        session.on_event = lambda event: self._enqueue(("append", (session.id, event)))
        session.on_status = lambda: self._enqueue(("save", session.record()))
        if new:
            self._enqueue(("save", session.record()))

    def _enqueue(self, item: tuple[str, Any]) -> None:
        if self._outbox is None:
            self._outbox = asyncio.Queue()
            self._writer = asyncio.get_running_loop().create_task(
                self._write_loop(), name="session-journal", context=contextvars.Context()
            )
        self._outbox.put_nowait(item)

    async def _write_loop(self) -> None:
        """Único escritor del diario: conserva el orden y agrupa los eventos seguidos de una misma sesión."""
        assert self._outbox is not None and self._journal is not None
        while True:
            batch = [await self._outbox.get()]
            while not self._outbox.empty() and len(batch) < 500:
                batch.append(self._outbox.get_nowait())
            try:
                await self._flush_batch(batch)
            except Exception:
                log.warning("session_journal_failed", exc_info=True)  # degradar: la sesión en memoria sigue
            finally:
                for _ in batch:
                    self._outbox.task_done()

    async def _flush_batch(self, batch: list[tuple[str, Any]]) -> None:
        assert self._journal is not None
        pending: dict[str, list[StoredEvent]] = {}
        for kind, payload in batch:
            if kind == "append":
                session_id, event = payload
                pending.setdefault(session_id, []).append(event)
                continue
            for session_id, events in pending.items():
                await self._journal.append(session_id, events)
            pending = {}
            if kind == "save":
                await self._journal.save(payload)
            elif kind == "prune":
                for session_id in await self._journal.prune(payload):
                    await self._checkpointer.adelete_thread(session_id)
        for session_id, events in pending.items():
            await self._journal.append(session_id, events)

    async def _restore(self, session_id: str, owner: str) -> DeliberationSession | None:
        assert self._journal is not None
        loaded = await self._journal.load(session_id)
        if loaded is None or loaded[0]["owner"] != owner:
            return None
        record, stored = loaded
        if session_id in self._sessions:  # otra petición la rehidrató mientras leíamos
            return self._sessions[session_id]
        config = SessionConfig(**record["config"])
        session = DeliberationSession(
            session_id,
            owner,
            config,
            DeliberationControl(
                pace=config.pace,
                turn_delay_s=config.turn_delay_s,
                deadline=_monotonic(record["deadline"]),
                hard_deadline=_monotonic(record["hard_deadline"]),
                max_calls=self._max_llm_calls,
            ),
            RequestContext(user_id=owner, session_id=session_id, trace_id=record["trace_id"], channel="session"),
            status=record["status"],  # type: ignore[arg-type]
            reason=record["reason"],
            created_at=record["created_at"],
            updated_at=record["updated_at"],
            deadline=record["deadline"],
            hard_deadline=record["hard_deadline"],
            events=[(e.seq, ChatEvent(e.type, e.data)) for e in stored],  # type: ignore[arg-type]
            meter=TokenUsage.restore(record["usage"]),
            dormant=record["status"] not in TERMINAL,
        )
        session.collector.replay([(e.t, ChatEvent(e.type, e.data)) for e in stored])  # type: ignore[arg-type]
        self._attach(session, new=False)
        self._sessions[session_id] = session
        log.info("session_restored", extra={"session_id": session_id, "events": len(stored)})
        return session

    def _wake(self, session: DeliberationSession) -> None:
        """Reanuda una sesión rehidratada con la identidad de la petición actual (token fresco)."""
        session.dormant = False
        session.context = replace(
            request_ctx.get(), channel="session", session_id=session.id, trace_id=session.context.trace_id
        )
        self._spawn(session, resume=True)

    def _expired(self, record: SessionRecord) -> bool:
        """Una sesión dormida más allá de su tope duro y del TTL ya no cuenta como abierta."""
        hard = record["hard_deadline"] or record["created_at"]
        return time.time() > hard + self._ttl_s

    def _prune(self) -> None:
        now = time.time()
        stale = [sid for sid, s in self._sessions.items() if s.finished and now - s.updated_at > self._ttl_s]
        for sid in stale:
            del self._sessions[sid]
        if len(self._sessions) > self._max_sessions:
            finished = sorted((s for s in self._sessions.values() if s.finished), key=lambda s: s.updated_at)
            for old in finished[: len(self._sessions) - self._max_sessions]:
                del self._sessions[old.id]
        if self._journal is not None:
            self._enqueue(("prune", now - self._ttl_s - self._max_duration_s))
