"""Agente filosófico sin ejecución de herramientas."""

from apeiron_core.application.ports.outbound.events import Emit
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.domain.entities.agent_turn import AgentTurn


def others_block(name: str, history: list[AgentTurn]) -> str:
    others = [
        f"{turn['agent']}: {turn['text']}" for turn in history if turn["agent"] != name
    ]
    return "\n\nPosiciones previas de otros:\n" + "\n".join(others) if others else ""


class PhilosopherAgent:
    def __init__(self, name: str, persona: str, llm: LLMPort) -> None:
        self.name = name
        self._persona = persona
        self._llm = llm

    async def respond(
        self, question: str, history: list[AgentTurn], emit: Emit | None = None
    ) -> str:
        return await self._llm.complete(
            self._persona, question + others_block(self.name, history)
        )
