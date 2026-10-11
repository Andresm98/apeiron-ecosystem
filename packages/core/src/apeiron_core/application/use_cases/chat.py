"""Caso de uso de chat y facade para los adaptadores de entrada."""

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from apeiron_core.application.context import request_ctx
from apeiron_core.application.conversations import MAX_EXCHANGES, context_block
from apeiron_core.application.dto.chat import ChatEvent
from apeiron_core.application.dto.runs import AgentRun, RunStatus
from apeiron_core.application.metrics import RuntimeMetrics
from apeiron_core.application.ports.inbound.chat import ChatUseCasePort
from apeiron_core.application.ports.outbound.conversations import ConversationPort
from apeiron_core.application.ports.outbound.memory import VectorStorePort
from apeiron_core.application.ports.outbound.runs import RunRepositoryPort
from apeiron_core.application.usage import TokenUsage, usage_meter
from apeiron_core.application.use_cases.execution import ExecutionCollector
from apeiron_core.domain.value_objects.mode import Mode

log = logging.getLogger("apeiron.facade")


class ApeironFacade(ChatUseCasePort):
    def __init__(
        self,
        graph: Any,
        memory: VectorStorePort | None = None,
        simulation_graph: Any = None,
        runs: RunRepositoryPort | None = None,
        model_label: str = "",
        metrics: RuntimeMetrics | None = None,
        conversations: ConversationPort | None = None,
    ) -> None:
        self._graph = graph
        self._conversations = conversations
        self._memory = memory
        self._simulation_graph = simulation_graph or graph
        self._runs = runs
        self._model_label = model_label
        self.metrics = metrics or RuntimeMetrics()

    @staticmethod
    def _inputs(
        question: str,
        mode: Mode | None,
        max_rounds: int | None,
        agent: str | None = None,
        participants: list[str] | None = None,
        context: str = "",
    ) -> dict[str, Any]:
        inputs: dict[str, Any] = {"question": question}
        if mode:
            inputs["mode"] = mode
        if max_rounds:
            inputs["max_rounds"] = max_rounds
        if agent:
            inputs["agent"] = agent
        if participants:
            inputs["participants"] = list(participants)  # el router fuerza `debate` y valida los nombres
        if context:
            inputs["context"] = context
        return inputs

    async def _context(self, conversation_id: str | None) -> str:
        """Intercambios previos de la conversación (ADR-014). Si no se pueden leer, la pregunta sigue sola."""
        if not (conversation_id and self._conversations):
            return ""
        try:
            return context_block(await self._conversations.exchanges(conversation_id, MAX_EXCHANGES))
        except Exception:
            self.metrics.failure("conversation_load_failed")
            log.warning("conversation_load_failed", exc_info=True)
            return ""

    @staticmethod
    def run_config(simulate: bool, run_name: str = "apeiron_chat") -> dict[str, Any]:
        """Configuración de LangSmith para una ejecución: nombre, etiquetas y metadatos de correlación."""
        context = request_ctx.get()
        return {
            "run_name": run_name,
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

    @property
    def model_label(self) -> str:
        return self._model_label

    async def ask(
        self,
        question: str,
        mode: Mode | None = None,
        max_rounds: int | None = None,
        simulate: bool = False,
        agent: str | None = None,
        *,
        participants: list[str] | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """Misma ejecución que `stream` (y mismo registro), devuelta al final."""
        result: dict[str, Any] = {}
        turns: list[dict[str, Any]] = []
        trace: list[str] = []
        steps: list[dict[str, Any]] = []
        async for event in self.stream(
            question, mode, max_rounds, simulate, agent, participants=participants, conversation_id=conversation_id
        ):
            if event.type == "turn":
                turns.append(event.data)
            elif event.type == "trace":
                trace.extend(event.data["messages"])
            elif event.type == "step":
                steps.append(event.data)
            elif event.type == "answer":
                result = event.data
        return {**result, "turns": turns, "trace": trace, "steps": steps}

    async def stream(
        self,
        question: str,
        mode: Mode | None = None,
        max_rounds: int | None = None,
        simulate: bool = False,
        agent: str | None = None,
        *,
        participants: list[str] | None = None,
        conversation_id: str | None = None,
    ) -> AsyncIterator[ChatEvent]:
        """Ejecuta el grafo y emite sus eventos. Con `conversation_id`, los agentes ven los intercambios previos."""
        meter = TokenUsage()
        usage_meter.set(meter)  # las tareas del grafo copian este contexto
        started = time.perf_counter()
        run = ExecutionCollector(mode=mode or "")
        self.metrics.run_started()
        try:
            context = await self._context(conversation_id)
            try:
                async for namespace, kind, chunk in self._select(simulate).astream(
                    self._inputs(question, mode, max_rounds, agent, participants, context),
                    self.run_config(simulate),
                    stream_mode=["tasks", "updates", "custom"],
                    subgraphs=True,
                ):
                    for event in run.consume(namespace, kind, chunk):
                        yield event
            except (Exception, asyncio.CancelledError) as exc:  # cancelar (A2A) también se registra
                await self.record(
                    question, simulate, started, meter, run, error=exc, conversation_id=conversation_id
                )
                raise
            yield await self.finish(question, simulate, started, meter, run, conversation_id=conversation_id)
        finally:
            self.metrics.run_finished()

    async def finish(
        self,
        question: str,
        simulate: bool,
        started: float,
        meter: TokenUsage,
        run: ExecutionCollector,
        *,
        config: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> ChatEvent:
        """Cierra una ejecución completada: evento `answer`, memoria (si no es simulación) y registro."""
        answer = ChatEvent(
            "answer",
            {
                "answer": run.answer,
                "mode": run.mode,
                "simulate": simulate,
                "blocked": run.blocked,
                "usage": meter.as_dict(),
            },
        )
        run.mark(answer)
        if not (simulate or run.blocked):
            await self._memorize(run.question or question, run.answer)
        if conversation_id and not run.blocked:
            await self._remember(conversation_id, run.question or question, run.answer, run.mode)
        await self.record(question, simulate, started, meter, run, config=config, conversation_id=conversation_id)
        return answer

    async def _remember(self, conversation_id: str, question: str, answer: str, mode: str) -> None:
        if self._conversations is None:
            return
        try:
            await self._conversations.append(conversation_id, {"question": question, "answer": answer, "mode": mode})
        except Exception:
            self.metrics.failure("conversation_append_failed")
            log.warning("conversation_append_failed", exc_info=True)

    async def record(
        self,
        question: str,
        simulate: bool,
        started: float,
        meter: TokenUsage,
        run: ExecutionCollector,
        *,
        error: BaseException | None = None,
        config: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> None:
        """Mide la ejecución y la persiste si hay repositorio; un fallo aquí nunca rompe el chat."""
        context = request_ctx.get()
        status: RunStatus = "error" if error else "blocked" if run.blocked else "completed"
        record: AgentRun = {
            "user_id": context.user_id,
            "trace_id": context.trace_id,
            "channel": context.channel,
            "a2a_task_id": context.a2a_task_id,
            "conversation_id": conversation_id,
            "question": run.question or question,  # nunca persiste un secreto redactado
            "mode": run.mode,
            "simulate": simulate,
            "status": status,
            "answer": run.answer,
            "turns": list(run.turns),
            "trace": list(run.trace),
            "steps": list(run.steps),
            "guardrails": list(run.guardrails),
            "agents": run.agents(meter),
            "usage": meter.as_dict(),
            "model": "simulation" if simulate else self._model_label,
            "duration_ms": round((time.perf_counter() - started) * 1000),
            "error": type(error).__name__ if error else None,
            "config": config or {},
            "events": list(run.timeline),
        }
        self.metrics.observe(record)
        if self._runs is None:
            return
        try:
            await self._runs.save(record)
        except Exception:
            self.metrics.failure("run_persist_failed")
            log.warning("run_persist_failed", exc_info=True)

    async def _memorize(self, question: str, answer: str) -> None:
        if not (self._memory and answer):
            return
        try:
            await self._memory.add(
                request_ctx.get().user_id, [f"Q: {question}\nA: {answer}"]
            )
        except Exception:
            self.metrics.failure("memorize_failed")
            log.warning("memorize_failed", exc_info=True)
