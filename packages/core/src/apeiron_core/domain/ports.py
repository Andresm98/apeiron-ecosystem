"""Puertos: el núcleo define contratos; infraestructura los implementa."""
from collections.abc import Callable, Sequence
from typing import Protocol

Emit = Callable[[str], None]


class LLMPort(Protocol):
    async def complete(self, system: str, user: str) -> str: ...


class ToolPort(Protocol):
    name: str
    description: str

    async def run(self, tool_input: str) -> str: ...


class VectorStorePort(Protocol):
    async def search(self, user_id: str, query: str, k: int = 3) -> list[str]: ...

    async def add(self, user_id: str, texts: Sequence[str]) -> None: ...


class SpecialistAgent(Protocol):
    name: str

    async def respond(
        self, question: str, history: list[dict[str, str]], emit: Emit | None = None
    ) -> str: ...
