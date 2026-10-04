"""Puerto de entrada para consultas y streaming de chat."""

from collections.abc import AsyncIterator
from typing import Any, Protocol

from apeiron_core.application.dto.chat import ChatEvent
from apeiron_core.domain.value_objects.mode import Mode


class ChatUseCasePort(Protocol):
    async def ask(
        self, question: str, mode: Mode | None = None, max_rounds: int | None = None
    ) -> dict[str, Any]: ...

    def stream(
        self, question: str, mode: Mode | None = None, max_rounds: int | None = None
    ) -> AsyncIterator[ChatEvent]: ...
