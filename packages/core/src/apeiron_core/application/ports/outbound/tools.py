"""Puerto de salida para herramientas invocables por agentes."""

from typing import Protocol


class ToolPort(Protocol):
    name: str
    description: str

    async def run(self, tool_input: str) -> str: ...
