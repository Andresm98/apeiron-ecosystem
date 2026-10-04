"""Memoria vectorial por usuario + conocimiento global (presocráticos / física teórica)."""
import asyncio
import hashlib
import re
from collections.abc import Sequence
from typing import Any

GLOBAL = "global"

PRESOCRATIC_SEED = [
    "Anaximandro propuso el ápeiron, lo ilimitado e indeterminado, como principio (arché) del que surgen y al que regresan los opuestos (cálido/frío, húmedo/seco).",
    "Según la tradición, Anaximandro describió que los seres pagan mutuamente su injusticia según el orden del tiempo: una ley cósmica de compensación entre opuestos.",
    "Anaximandro imaginó la Tierra suspendida sin soporte, en equilibrio por su equidistancia, y mundos innumerables que nacen y perecen en el ápeiron.",
    "Heráclito sostuvo que todo fluye (panta rhei) y que la realidad es tensión de opuestos regida por el logos; el fuego simboliza el cambio perpetuo.",
    "Heráclito: la armonía surge de la tensión entre contrarios, como en el arco y la lira; la guerra (pólemos) es común y la discordia, justicia.",
    "El problema de los tres cuerpos carece de solución general cerrada; el movimiento puede ser caótico, con sensibilidad extrema a las condiciones iniciales.",
    "El entrelazamiento cuántico produce correlaciones no clásicas entre subsistemas; los tests de Bell excluyen variables ocultas locales.",
    "La paradoja de Fermi contrasta la alta probabilidad estimada de civilizaciones con la ausencia de evidencia observacional de ellas.",
]

_WORD = re.compile(r"\w+", re.UNICODE)


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if len(w) > 3}


class InMemoryVectorStore:
    """Recuperación léxica (dev/test). Misma interfaz que el store vectorial real."""

    def __init__(self) -> None:
        self._docs: dict[str, list[str]] = {}

    async def add(self, user_id: str, texts: Sequence[str]) -> None:
        bucket = self._docs.setdefault(user_id, [])
        bucket.extend(t for t in texts if t not in bucket)

    async def search(self, user_id: str, query: str, k: int = 3) -> list[str]:
        q = _tokens(query)
        pool = self._docs.get(GLOBAL, []) + (self._docs.get(user_id, []) if user_id != GLOBAL else [])
        scored = sorted(((len(q & _tokens(d)), d) for d in pool), key=lambda p: -p[0])
        return [d for s, d in scored[:k] if s > 0]


class ChromaVectorStore:
    """ChromaDB vía HTTP (extra [chroma]). Filtra por user_id + global."""

    def __init__(self, host: str, port: int, collection: str = "apeiron_memory") -> None:
        import chromadb  # import diferido

        self._col: Any = chromadb.HttpClient(host=host, port=port).get_or_create_collection(collection)

    async def add(self, user_id: str, texts: Sequence[str]) -> None:
        ids = [hashlib.sha1(f"{user_id}:{t}".encode()).hexdigest() for t in texts]  # upsert idempotente
        await asyncio.to_thread(
            self._col.upsert, ids=ids, documents=list(texts), metadatas=[{"user_id": user_id}] * len(texts)
        )

    async def search(self, user_id: str, query: str, k: int = 3) -> list[str]:
        res = await asyncio.to_thread(
            self._col.query, query_texts=[query], n_results=k, where={"user_id": {"$in": [user_id, GLOBAL]}}
        )
        return list((res.get("documents") or [[]])[0])


async def seed_global(store: Any) -> None:
    await store.add(GLOBAL, PRESOCRATIC_SEED)
