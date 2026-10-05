"""Tareas A2A en memoria (por instancia): ciclo de vida, cancelación y suscriptores del stream.

El ejecutor traduce los `ChatEvent` de la facade a eventos A2A:
trace/step/guard -> statusUpdate(working) · turn -> artifact `turns` · answer -> artifact
`answer` + estado final (completed, o rejected si el guardrail bloqueó la entrada).
"""

import asyncio
import logging
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from apeiron_core.application.ports.inbound.chat import ChatUseCasePort
from apeiron_infra.a2a import wire

log = logging.getLogger("apeiron.a2a")
END = None  # centinela de fin para los suscriptores


@dataclass
class A2ATask:
    id: str
    context_id: str
    owner: str
    trace_id: str
    question: str
    history: list[dict[str, Any]] = field(default_factory=list)
    status: dict[str, Any] = field(default_factory=lambda: wire.status(wire.SUBMITTED))
    artifacts: dict[str, dict[str, Any]] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    runner: asyncio.Task[None] | None = None
    subscribers: list[asyncio.Queue[dict[str, Any] | None]] = field(default_factory=list)

    @property
    def state(self) -> str:
        return str(self.status["state"])

    def to_dict(self, history_length: int | None = None) -> dict[str, Any]:
        history = self.history if history_length is None else self.history[-history_length:] if history_length else []
        return {
            "id": self.id,
            "contextId": self.context_id,
            "status": self.status,
            "artifacts": list(self.artifacts.values()),
            "history": history,
            "metadata": {"traceId": self.trace_id},
        }

    def summary(self) -> dict[str, Any]:
        """Vista para el panel de sistema del propio dueño."""
        return {
            "id": self.id,
            "context_id": self.context_id,
            "state": self.state,
            "question": self.question[:160],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def _publish(self, event: dict[str, Any]) -> None:
        self.updated_at = time.time()
        for queue in self.subscribers:
            queue.put_nowait(event)

    def set_status(self, state: str, text: str = "", data: Any = None) -> None:
        parts = ([wire.text_part(text)] if text else []) + ([wire.data_part(data)] if data is not None else [])
        msg = (
            wire.message(wire.ROLE_AGENT, parts, uuid.uuid4().hex, task_id=self.id, context_id=self.context_id)
            if parts
            else None
        )
        self.status = wire.status(state, msg)
        self._publish({"statusUpdate": {"taskId": self.id, "contextId": self.context_id, "status": self.status}})

    def add_artifact(self, name: str, parts: list[dict[str, Any]], *, last: bool) -> None:
        append = name in self.artifacts
        if append:
            self.artifacts[name]["parts"].extend(parts)
        else:
            self.artifacts[name] = {"artifactId": name, "name": name, "parts": list(parts)}
        update = {
            "taskId": self.id,
            "contextId": self.context_id,
            "artifact": {"artifactId": name, "name": name, "parts": parts},
            "append": append,
            "lastChunk": last,
        }
        self._publish({"artifactUpdate": update})


class A2ATaskStore:
    """Acotado: al superar `max_tasks` se descartan las tareas terminadas más antiguas."""

    def __init__(self, max_tasks: int = 500) -> None:
        self._tasks: dict[str, A2ATask] = {}
        self._max = max_tasks

    def add(self, task: A2ATask) -> None:
        self._tasks[task.id] = task
        if len(self._tasks) > self._max:
            finished = sorted(
                (t for t in self._tasks.values() if t.state in wire.TERMINAL), key=lambda t: t.updated_at
            )
            for old in finished[: len(self._tasks) - self._max]:
                del self._tasks[old.id]

    def get(self, task_id: str, owner: str) -> A2ATask | None:
        task = self._tasks.get(task_id)
        return task if task and task.owner == owner else None  # ajenas = inexistentes

    def for_owner(self, owner: str, limit: int = 10) -> list[A2ATask]:
        own = [t for t in self._tasks.values() if t.owner == owner]
        return sorted(own, key=lambda t: t.updated_at, reverse=True)[:limit]

    def counts(self) -> dict[str, int]:
        return dict(Counter(t.state for t in self._tasks.values()))


async def run_task(
    task: A2ATask,
    facade: ChatUseCasePort,
    question: str,
    mode: Any,
    max_rounds: int | None,
    simulate: bool,
) -> None:
    """Ejecuta el grafo para la tarea. Corre en su propia asyncio.Task: sobrevive al cliente."""
    task.set_status(wire.WORKING, "Ápeiron coordina a los workers")
    try:
        final, answer = wire.COMPLETED, ""
        async for event in facade.stream(question, mode, max_rounds, simulate):
            if event.type == "trace":
                for message in event.data["messages"]:
                    task.set_status(wire.WORKING, message)
            elif event.type == "step":
                task.set_status(wire.WORKING, data={"step": event.data})
            elif event.type == "guard":
                task.set_status(wire.WORKING, data={"guardrail": event.data})
            elif event.type == "turn":
                task.add_artifact("turns", [wire.data_part(event.data)], last=False)
            elif event.type == "answer":
                answer = event.data["answer"]
                meta = {k: event.data.get(k) for k in ("mode", "simulate", "blocked", "usage")}
                task.add_artifact("answer", [wire.text_part(answer), wire.data_part(meta)], last=True)
                final = wire.REJECTED if event.data.get("blocked") else wire.COMPLETED
        reply = wire.message(
            wire.ROLE_AGENT, [wire.text_part(answer)], uuid.uuid4().hex, task_id=task.id, context_id=task.context_id
        )
        task.history.append(reply)
        task.set_status(final, answer)
    except asyncio.CancelledError:
        task.set_status(wire.CANCELED, "Tarea cancelada por el cliente.")
    except Exception:
        log.exception("a2a_task_failed", extra={"a2a_task_id": task.id})
        task.set_status(wire.FAILED, f"internal_error (trace {task.trace_id})")
    finally:
        for queue in task.subscribers:
            queue.put_nowait(END)
