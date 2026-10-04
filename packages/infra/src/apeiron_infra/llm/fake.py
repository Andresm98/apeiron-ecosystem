"""LLM determinista para desarrollo y pruebas."""


class FakeLLM:
    async def complete(self, system: str, user: str) -> str:
        return f"Thought: respondiendo en modo fake\nFinal Answer: [fake] {system[:24]}… respondiendo a: {user[:60]}"
