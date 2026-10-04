"""Caso de uso de chat y facade para los adaptadores de entrada."""

import logging
from collections.abc import AsyncIterator
from typing import Any

from apeiron_core.application.context import request_ctx
from apeiron_core.application.dto.chat import ChatEvent
from apeiron_core.application.ports.inbound.chat import ChatUseCasePort
from apeiron_core.application.ports.outbound.memory import VectorStorePort
from apeiron_core.domain.value_objects.mode import Mode

log = logging.getLogger("apeiron.facade")


class ApeironFacade(ChatUseCasePort):
    def __init__(self, graph: Any, memory: VectorStorePort | None = None) -> None:
        self._graph = graph
        self._memory = memory

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
    def _config() -> dict[str, Any]:
        context = request_ctx.get()
        return {
            "run_name": "apeiron_chat",
            "tags": ["apeiron"],
            "metadata": {
                "trace_id": context.trace_id,
                "user_id": context.user_id,
                "session_id": context.session_id,
            },
        }

    async def ask(
        self, question: str, mode: Mode | None = None, max_rounds: int | None = None
    ) -> dict[str, Any]:
        output: dict[str, Any] = await self._graph.ainvoke(
            self._inputs(question, mode, max_rounds), self._config()
        )
        await self._memorize(question, output.get("answer", ""))
        return output

    async def stream(
        self, question: str, mode: Mode | None = None, max_rounds: int | None = None
    ) -> AsyncIterator[ChatEvent]:
        answer, final_mode = "", mode or ""
        async for kind, chunk in self._graph.astream(
            self._inputs(question, mode, max_rounds),
            self._config(),
            stream_mode=["updates", "custom"],
        ):
            if kind == "custom":
                yield ChatEvent("trace", {"messages": [chunk["message"]]})
                continue
            for update in chunk.values():
                if not update:
                    continue
                final_mode = update.get("mode", final_mode)
                if update.get("trace"):
                    yield ChatEvent("trace", {"messages": update["trace"]})
                for turn in update.get("turns", []):
                    yield ChatEvent("turn", turn)
                answer = update.get("answer", answer)
        yield ChatEvent("answer", {"answer": answer, "mode": final_mode})
        await self._memorize(question, answer)

    async def _memorize(self, question: str, answer: str) -> None:
        if not (self._memory and answer):
            return
        try:
            await self._memory.add(
                request_ctx.get().user_id, [f"Q: {question}\nA: {answer}"]
            )
        except Exception:
            log.warning("memorize_failed", exc_info=True)
