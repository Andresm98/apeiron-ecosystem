from apeiron_core.domain.context import request_ctx
from apeiron_core.domain.ports import VectorStorePort


class VectorMemoryRetriever:
    name = "vector_memory_retriever"
    description = (
        "Recupera fragmentos presocráticos, física teórica y el historial previo del usuario. "
        "Entrada: consulta en lenguaje natural."
    )

    def __init__(self, store: VectorStorePort, k: int = 3) -> None:
        self._store, self._k = store, k

    async def run(self, tool_input: str) -> str:
        docs = await self._store.search(request_ctx.get().user_id, tool_input, self._k)
        return "\n".join(f"- {d}" for d in docs) if docs else "Sin fragmentos relevantes."
