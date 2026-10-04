"""Puerto de salida para memoria por usuario."""

from collections.abc import Sequence
from typing import Protocol


class VectorStorePort(Protocol):
    async def search(self, user_id: str, query: str, k: int = 3) -> list[str]: ...

    async def add(self, user_id: str, texts: Sequence[str]) -> None: ...
