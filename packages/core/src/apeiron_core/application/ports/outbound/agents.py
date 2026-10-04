"""Puerto de salida para especialistas invocados por el supervisor."""

from typing import Protocol

from apeiron_core.application.ports.outbound.events import Emit
from apeiron_core.domain.entities.agent_turn import AgentTurn


class SpecialistAgent(Protocol):
    name: str

    async def respond(
        self, question: str, history: list[AgentTurn], emit: Emit | None = None
    ) -> str: ...
