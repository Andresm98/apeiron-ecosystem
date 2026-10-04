"""Traduce el stream de LangGraph a eventos de chat y acumula el registro de la ejecución."""

import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from apeiron_core.application.dto.chat import ChatEvent
from apeiron_core.application.dto.runs import AgentExecution

ORCHESTRATOR = "apeiron"


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
    turns: list[dict[str, Any]] = field(default_factory=list)
    trace: list[str] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)
    _agents: dict[str, _AgentStats] = field(default_factory=dict)
    _started: dict[str, float] = field(default_factory=dict)

    def consume(self, namespace: tuple[str, ...], kind: str, chunk: Any) -> Iterator[ChatEvent]:
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
            for update in chunk.values():
                if not update:
                    continue
                self.mode = update.get("mode", self.mode)
                if update.get("trace"):
                    self.trace.extend(update["trace"])
                    yield ChatEvent("trace", {"messages": update["trace"]})
                for turn in update.get("turns", []):
                    self.turns.append(turn)
                    if turn.get("degraded"):
                        self._stats(turn["agent"]).degraded = True
                    yield ChatEvent("turn", turn)
                self.answer = update.get("answer", self.answer)

    def agents(self) -> list[AgentExecution]:
        return [
            {
                "agent_id": agent_id,
                "invocations": s.invocations,
                "reasoning_steps": s.reasoning_steps,
                "tool_calls": s.tool_calls,
                "tools_used": s.tools_used,
                "degraded": s.degraded,
                "duration_ms": round(s.duration_ms),
            }
            for agent_id, s in self._agents.items()
        ]

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
