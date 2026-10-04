"""Puerto de salida para persistir y consultar ejecuciones del usuario."""

from typing import Any, Protocol

from apeiron_core.application.dto.runs import AgentRun


class RunRepositoryPort(Protocol):
    async def save(self, run: AgentRun) -> None: ...

    async def list_recent(self, limit: int = 20) -> list[dict[str, Any]]: ...

    async def get(self, run_id: str) -> dict[str, Any] | None: ...
