"""Traduce el stream de LangGraph a eventos de chat y acumula el registro de la ejecución.

También guarda la cronología pública (`timeline`) para reproducir la ejecución (ADR-013, fase 4) y las
interrupciones pendientes (`__interrupt__`) de una deliberación con humano o ritmo paso a paso.
"""

import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from apeiron_core.application.dto.chat import ChatEvent
from apeiron_core.application.dto.runs import AgentExecution
from apeiron_core.application.usage import TokenUsage

ORCHESTRATOR = "apeiron"
INTERRUPT = "__interrupt__"
TIMELINE_LIMIT = 4000  # eventos guardados para el replay; los posteriores no se guardan


def node_event(namespace: tuple[str, ...], task: dict[str, Any]) -> dict[str, Any]:
    """Tarea LangGraph -> evento de nodo: `anaximandro/act`, start|end."""
    path = [part.split(":", 1)[0] for part in namespace] + [task["name"]]
    finished = "result" in task or "error" in task
    return {
        "node": "/".join(path),
        "status": "end" if finished else "start",
        "error": bool(task.get("error")),
    }


@dataclass
class _AgentStats:
    invocations: int = 0
    reasoning_steps: int = 0
    tool_calls: int = 0
    tools_used: list[str] = field(default_factory=list)
    degraded: bool = False
    duration_ms: float = 0.0


@dataclass
class ExecutionCollector:
    """Estado acumulado de una ejecución; `consume` emite los eventos públicos."""

    mode: str = ""
    answer: str = ""
    question: str = ""  # pregunta saneada por el guardrail de entrada, si la redactó
    blocked: bool = False
    turns: list[dict[str, Any]] = field(default_factory=list)
    trace: list[str] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)
    guardrails: list[dict[str, Any]] = field(default_factory=list)
    participants: list[str] = field(default_factory=list)
    close_reason: str = ""
    timeline: list[dict[str, Any]] = field(default_factory=list)
    _agents: dict[str, _AgentStats] = field(default_factory=dict)
    _started: dict[str, float] = field(default_factory=dict)
    _interrupts: list[dict[str, Any]] = field(default_factory=list)
    _t0: float = field(default_factory=time.perf_counter)

    def consume(self, namespace: tuple[str, ...], kind: str, chunk: Any) -> Iterator[ChatEvent]:
        for event in self._consume(namespace, kind, chunk):
            self.mark(event)
            yield event

    def mark(self, event: ChatEvent) -> None:
        """Añade un evento público a la cronología, con su instante relativo en ms."""
        if len(self.timeline) < TIMELINE_LIMIT:
            t = round((time.perf_counter() - self._t0) * 1000)
            self.timeline.append({"t": t, "type": event.type, "data": event.data})

    def replay(self, events: list[tuple[int, ChatEvent]]) -> None:
        """Reconstruye el registro desde eventos públicos ya emitidos `(t_ms, evento)` (sesión rehidratada).

        Las duraciones por agente de lo ocurrido antes del reinicio no se pueden recuperar: quedan en cero.
        """
        for t, event in events:
            if event.type in ("session", "error"):
                if event.type == "session":
                    self.participants = event.data.get("participants") or self.participants
                continue
            if len(self.timeline) < TIMELINE_LIMIT:
                self.timeline.append({"t": t, "type": event.type, "data": event.data})
            data = event.data
            if event.type == "turn":
                self.turns.append(data)
                if data.get("degraded"):
                    self._stats(data["agent"]).degraded = True
            elif event.type == "trace":
                self.trace.extend(data.get("messages", []))
            elif event.type == "step":
                self._on_step(data)
            elif event.type == "node" and data.get("status") == "start" and "/" not in data.get("node", "/"):
                root = data["node"]
                self._stats(ORCHESTRATOR if root.startswith(f"{ORCHESTRATOR}_") else root).invocations += 1
            elif event.type == "guard":
                self.guardrails.append(data)
            elif event.type == "answer":
                self.answer = data.get("answer", self.answer)
        if events:  # los eventos nuevos continúan la cronología donde quedó
            self._t0 = time.perf_counter() - events[-1][0] / 1000

    def take_interrupts(self) -> list[dict[str, Any]]:
        """Interrupciones pendientes del último tramo del stream (y las vacía)."""
        pending, self._interrupts = self._interrupts, []
        return pending

    def _consume(self, namespace: tuple[str, ...], kind: str, chunk: Any) -> Iterator[ChatEvent]:
        if kind == "custom":
            self.trace.append(chunk["message"])
            yield ChatEvent("trace", {"messages": [chunk["message"]]})
            if step := chunk.get("step"):
                self._on_step(step)
                yield ChatEvent("step", step)
        elif kind == "tasks":
            event = node_event(namespace, chunk)
            self._on_node(event)
            yield ChatEvent("node", event)
        elif not namespace:  # updates del grafo raíz; los internos van como nodos
            for key, update in chunk.items():
                if key == INTERRUPT:
                    self._interrupts.extend(i.value for i in update if isinstance(i.value, dict))
                    continue
                if not update:
                    continue
                self.mode = update.get("mode", self.mode)
                self.participants = update.get("participants", self.participants)
                self.close_reason = update.get("close_reason", self.close_reason)
                if update.get("trace"):
                    self.trace.extend(update["trace"])
                    yield ChatEvent("trace", {"messages": update["trace"]})
                for turn in update.get("turns", []):
                    self.turns.append(turn)
                    if turn.get("degraded"):
                        self._stats(turn["agent"]).degraded = True
                    yield ChatEvent("turn", turn)
                self.answer = update.get("answer", self.answer)
                self.question = update.get("question", self.question)
                self.blocked = self.blocked or bool(update.get("blocked"))
                for record in update.get("guardrails", []):
                    self.guardrails.append(record)
                    yield ChatEvent("guard", record)

    def agents(self, usage: TokenUsage | None = None) -> list[AgentExecution]:
        by_agent = usage.by_agent if usage is not None else {}
        for agent_id in by_agent:
            self._stats(agent_id)  # quien consumió tokens también actuó
        executions: list[AgentExecution] = []
        for agent_id, s in self._agents.items():
            spent = by_agent.get(agent_id)
            executions.append({
                "agent_id": agent_id,
                "invocations": s.invocations,
                "reasoning_steps": s.reasoning_steps,
                "tool_calls": s.tool_calls,
                "tools_used": s.tools_used,
                "degraded": s.degraded,
                "duration_ms": round(s.duration_ms),
                "llm_calls": spent.calls if spent else 0,
                "input_tokens": spent.input_tokens if spent else 0,
                "output_tokens": spent.output_tokens if spent else 0,
            })
        return executions

    def _stats(self, agent_id: str) -> _AgentStats:
        return self._agents.setdefault(agent_id, _AgentStats())

    def _on_node(self, event: dict[str, Any]) -> None:
        root, _, inner = event["node"].partition("/")
        agent_id = ORCHESTRATOR if root.startswith(f"{ORCHESTRATOR}_") else root
        stats = self._stats(agent_id)
        if event["status"] == "start":
            if not inner:
                stats.invocations += 1
                self._started[root] = time.perf_counter()
            elif inner == "reason":
                stats.reasoning_steps += 1
        elif not inner and root in self._started:
            stats.duration_ms += (time.perf_counter() - self._started.pop(root)) * 1000
            if event["error"]:
                stats.degraded = True

    def _on_step(self, step: dict[str, Any]) -> None:
        self.steps.append(step)
        stats = self._stats(step["agent"])
        stats.tool_calls += 1
        if step["tool"] not in stats.tools_used:
            stats.tools_used.append(step["tool"])
