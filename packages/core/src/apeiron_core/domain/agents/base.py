"""Agentes: PhilosopherAgent (sin tools) y helpers compartidos."""
from apeiron_core.domain.ports import Emit, LLMPort


def others_block(name: str, history: list[dict[str, str]]) -> str:
    others = [f"{t['agent']}: {t['text']}" for t in history if t["agent"] != name]
    return "\n\nPosiciones previas de otros:\n" + "\n".join(others) if others else ""


class PhilosopherAgent:
    def __init__(self, name: str, persona: str, llm: LLMPort) -> None:
        self.name = name
        self._persona = persona
        self._llm = llm

    async def respond(
        self, question: str, history: list[dict[str, str]], emit: Emit | None = None
    ) -> str:
        return await self._llm.complete(self._persona, question + others_block(self.name, history))
