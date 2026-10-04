"""LLM determinista para desarrollo y pruebas."""


class FakeLLM:
    async def complete(self, system: str, user: str) -> str:
        return f"[fake] {system[:24]}… respondiendo a: {user[:60]}"
