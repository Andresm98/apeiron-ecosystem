"""Puerto de salida para completar prompts con un modelo de lenguaje."""

from typing import Protocol


class LLMPort(Protocol):
    async def complete(self, system: str, user: str) -> str: ...
