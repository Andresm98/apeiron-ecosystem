"""LLM determinista para desarrollo, pruebas y modo simulación (0 tokens)."""

import asyncio

from apeiron_core.application.usage import record_usage

DEMO_TOOL = "vector_memory_retriever"


class FakeLLM:
    """Recorre el ciclo ReAct completo: una consulta a memoria y luego Final Answer.

    `pace_s` añade una pausa por llamada para que la UI muestre el grafo avanzando.
    """

    def __init__(self, pace_s: float = 0.0) -> None:
        self._pace_s = pace_s

    async def complete(self, system: str, user: str) -> str:
        record_usage()
        if self._pace_s:
            await asyncio.sleep(self._pace_s)
        persona = system.split(".", 1)[0][:60]
        topic = user.strip().splitlines()[0][:80] if user.strip() else ""
        is_react = "Action Input:" in system
        if is_react and DEMO_TOOL in system and "Observation:" not in user:
            return f"Thought: consulto la memoria\nAction: {DEMO_TOOL}\nAction Input: {topic}"
        if is_react:
            return f"Thought: respondo\nFinal Answer: [simulación] {persona} — sobre: {topic}"
        return f"[simulación] {persona} — sobre: {topic}"
