"""Caso de uso de chat y facade para los adaptadores de entrada."""

import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from apeiron_core.application.context import request_ctx
from apeiron_core.application.dto.chat import ChatEvent
from apeiron_core.application.dto.runs import AgentRun
from apeiron_core.application.ports.inbound.chat import ChatUseCasePort
from apeiron_core.application.ports.outbound.memory import VectorStorePort
from apeiron_core.application.ports.outbound.runs import RunRepositoryPort
from apeiron_core.application.usage import TokenUsage, usage_meter
from apeiron_core.domain.value_objects.mode import Mode

log = logging.getLogger("apeiron.facade")


def _node_event(namespace: tuple[str, ...], task: dict[str, Any]) -> dict[str, Any]:
    """Tarea LangGraph -> evento de nodo: `anaximandro/act`, start|end."""
    path = [part.split(":", 1)[0] for part in namespace] + [task["name"]]
    finished = "result" in task or "error" in task
    return {
        "node": "/".join(path),
        "status": "end" if finished else "start",
        "error": bool(task.get("error")),
    }


class ApeironFacade(ChatUseCasePort):
    def __init__(
        self,
        graph: Any,
        memory: VectorStorePort | None = None,
        simulation_graph: Any = None,
        runs: RunRepositoryPort | None = None,
        model_label: str = "",
    ) -> None:
        self._graph = graph
        self._memory = memory
        self._simulation_graph = simulation_graph or graph
        self._runs = runs
        self._model_label = model_label

    @staticmethod
    def _inputs(
        question: str, mode: Mode | None, max_rounds: int | None
    ) -> dict[str, Any]:
        inputs: dict[str, Any] = {"question": question}
        if mode:
            inputs["mode"] = mode
        if max_rounds:
            inputs["max_rounds"] = max_rounds
        return inputs

    @staticmethod
    def _config(simulate: bool) -> dict[str, Any]:
        context = request_ctx.get()
        return {
            "run_name": "apeiron_chat",
            "tags": ["apeiron", "simulation" if simulate else "live"],
            "metadata": {
                "trace_id": context.trace_id,
                "user_id": context.user_id,
                "session_id": context.session_id,
                "simulate": simulate,
            },
        }

    def _select(self, simulate: bool) -> Any:
        return self._simulation_graph if simulate else self._graph

    async def ask(
        self,
        question: str,
        mode: Mode | None = None,
        max_rounds: int | None = None,
        simulate: bool = False,
    ) -> dict[str, Any]:
        meter = TokenUsage()
        usage_meter.set(meter)
        started = time.perf_counter()
        try:
            output: dict[str, Any] = await self._select(simulate).ainvoke(
                self._inputs(question, mode, max_rounds), self._config(simulate)
            )
        except Exception as exc:
            await self._record(question, mode or "", simulate, started, meter, error=exc)
            raise
        if not simulate:
            await self._memorize(question, output.get("answer", ""))
        await self._record(
            question,
            output.get("mode", mode or ""),
            simulate,
            started,
            meter,
            answer=output.get("answer", ""),
            turns=output.get("turns", []),
            trace=output.get("trace", []),
        )
        return {**output, "usage": meter.as_dict()}

    async def stream(
        self,
        question: str,
        mode: Mode | None = None,
        max_rounds: int | None = None,
        simulate: bool = False,
    ) -> AsyncIterator[ChatEvent]:
        meter = TokenUsage()
        usage_meter.set(meter)  # las tareas del grafo copian este contexto
        started = time.perf_counter()
        answer, final_mode = "", mode or ""
        turns: list[dict[str, Any]] = []
        trace: list[str] = []
        try:
            async for namespace, kind, chunk in self._select(simulate).astream(
                self._inputs(question, mode, max_rounds),
                self._config(simulate),
                stream_mode=["tasks", "updates", "custom"],
                subgraphs=True,
            ):
                if kind == "custom":
                    trace.append(chunk["message"])
                    yield ChatEvent("trace", {"messages": [chunk["message"]]})
                elif kind == "tasks":
                    yield ChatEvent("node", _node_event(namespace, chunk))
                elif not namespace:  # updates del grafo raíz; los internos van como nodos
                    for update in chunk.values():
                        if not update:
                            continue
                        final_mode = update.get("mode", final_mode)
                        if update.get("trace"):
                            trace.extend(update["trace"])
                            yield ChatEvent("trace", {"messages": update["trace"]})
                        for turn in update.get("turns", []):
                            turns.append(turn)
                            yield ChatEvent("turn", turn)
                        answer = update.get("answer", answer)
        except Exception as exc:
            await self._record(
                question, final_mode, simulate, started, meter, turns=turns, trace=trace, error=exc
            )
            raise
        yield ChatEvent(
            "answer",
            {
                "answer": answer,
                "mode": final_mode,
                "simulate": simulate,
                "usage": meter.as_dict(),
            },
        )
        if not simulate:
            await self._memorize(question, answer)
        await self._record(
            question, final_mode, simulate, started, meter, answer=answer, turns=turns, trace=trace
        )

    async def _record(
        self,
        question: str,
        mode: str,
        simulate: bool,
        started: float,
        meter: TokenUsage,
        *,
        answer: str = "",
        turns: list[dict[str, Any]] | None = None,
        trace: list[str] | None = None,
        error: Exception | None = None,
    ) -> None:
        """Persiste la ejecución si hay repositorio; un fallo aquí nunca rompe el chat."""
        if self._runs is None:
            return
        context = request_ctx.get()
        run: AgentRun = {
            "user_id": context.user_id,
            "trace_id": context.trace_id,
            "question": question,
            "mode": mode,
            "simulate": simulate,
            "status": "error" if error else "completed",
            "answer": answer,
            "turns": list(turns or []),
            "trace": list(trace or []),
            "usage": meter.as_dict(),
            "model": "simulation" if simulate else self._model_label,
            "duration_ms": round((time.perf_counter() - started) * 1000),
            "error": type(error).__name__ if error else None,
        }
        try:
            await self._runs.save(run)
        except Exception:
            log.warning("run_persist_failed", exc_info=True)

    async def _memorize(self, question: str, answer: str) -> None:
        if not (self._memory and answer):
            return
        try:
            await self._memory.add(
                request_ctx.get().user_id, [f"Q: {question}\nA: {answer}"]
            )
        except Exception:
            log.warning("memorize_failed", exc_info=True)
