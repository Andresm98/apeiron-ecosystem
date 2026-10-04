"""Memoria vectorial por usuario + conocimiento global (presocráticos / física teórica)."""

from __future__ import annotations

import asyncio
import hashlib
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from apeiron_infra.memory.hybrid import format_fragment, hybrid_rerank

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


@dataclass
class _Stored:
    text: str
    user_id: str
    created_at: float


def _source_of(user_id: str) -> str:
    return "global" if user_id == GLOBAL else "user"


class InMemoryVectorStore:
    """Double de desarrollo: BM25 + solapamiento léxico (no embeddings)."""

    def __init__(
        self,
        max_docs_per_user: int = 200,
        semantic_weight: float = 0.6,
        lexical_weight: float = 0.4,
    ) -> None:
        self._docs: dict[str, list[_Stored]] = {}
        self._max_docs = max_docs_per_user
        self._semantic_weight = semantic_weight
        self._lexical_weight = lexical_weight

    def _bucket(self, user_id: str) -> list[_Stored]:
        return self._docs.setdefault(user_id, [])

    def _pool(self, user_id: str) -> list[_Stored]:
        pool = list(self._docs.get(GLOBAL, []))
        if user_id != GLOBAL:
            pool.extend(self._docs.get(user_id, []))
        return pool

    async def add(self, user_id: str, texts: Sequence[str]) -> None:
        bucket = self._bucket(user_id)
        known = {item.text for item in bucket}
        now = time.time()
        for text in texts:
            if text in known:
                continue
            bucket.append(_Stored(text, user_id, now))
            known.add(text)
        if user_id != GLOBAL and len(bucket) > self._max_docs:
            bucket[:] = bucket[-self._max_docs :]

    async def search(self, user_id: str, query: str, k: int = 3) -> list[str]:
        pool = self._pool(user_id)
        texts = [item.text for item in pool]
        overlap = hybrid_rerank(
            query,
            semantic=[(item.text, 1.0 if query.lower() in item.text.lower() else 0.0) for item in pool],
            lexical_docs=texts,
            k=k,
            semantic_weight=self._semantic_weight,
            lexical_weight=self._lexical_weight,
        )
        by_text = {item.text: item for item in pool}
        return [format_fragment(text, _source_of(by_text[text].user_id)) for text in overlap]

    async def delete(self, user_id: str) -> None:
        if user_id == GLOBAL:
            return
        self._docs.pop(user_id, None)


class ChromaVectorStore:
    """ChromaDB vía HTTP (extra [chroma]). Filtra por user_id + global y rerankea híbrido."""

    def __init__(
        self,
        host: str,
        port: int,
        collection: str = "apeiron_memory",
        max_docs_per_user: int = 200,
        semantic_weight: float = 0.6,
        lexical_weight: float = 0.4,
        client: Any = None,
    ) -> None:
        if client is None:
            import chromadb  # import diferido

            client = chromadb.HttpClient(host=host, port=port)
        self._col: Any = client.get_or_create_collection(collection)
        self._max_docs = max_docs_per_user
        self._semantic_weight = semantic_weight
        self._lexical_weight = lexical_weight

    async def add(self, user_id: str, texts: Sequence[str]) -> None:
        now = str(time.time())
        ids = [hashlib.sha1(f"{user_id}:{t}".encode()).hexdigest() for t in texts]
        await asyncio.to_thread(
            self._col.upsert,
            ids=ids,
            documents=list(texts),
            metadatas=[{"user_id": user_id, "created_at": now} for _ in texts],
        )
        await self._enforce_retention(user_id)

    async def search(self, user_id: str, query: str, k: int = 3) -> list[str]:
        where = {"user_id": {"$in": [user_id, GLOBAL]}}
        semantic_res, lexical_res = await asyncio.gather(
            asyncio.to_thread(
                self._col.query,
                query_texts=[query],
                n_results=max(k * 4, k),
                where=where,
            ),
            asyncio.to_thread(
                self._col.get,
                where=where,
                include=["documents", "metadatas"],
            ),
        )
        documents = list((semantic_res.get("documents") or [[]])[0])
        distances = list((semantic_res.get("distances") or [[]])[0])
        metadatas = list((semantic_res.get("metadatas") or [[]])[0])
        if len(distances) < len(documents):
            distances.extend([1.0] * (len(documents) - len(distances)))
        semantic = [
            (doc, 1.0 / (1.0 + float(dist))) for doc, dist in zip(documents, distances, strict=False) if doc
        ]
        lexical_docs = [doc for doc in (lexical_res.get("documents") or []) if doc]
        ranked = hybrid_rerank(
            query,
            semantic=semantic,
            lexical_docs=lexical_docs,
            k=k,
            semantic_weight=self._semantic_weight,
            lexical_weight=self._lexical_weight,
        )
        source_by_text: dict[str, str] = {}
        for doc, meta in zip(documents, metadatas, strict=False):
            owner = (meta or {}).get("user_id", user_id)
            source_by_text[doc] = _source_of(str(owner))
        for doc, meta in zip(lexical_res.get("documents") or [], lexical_res.get("metadatas") or [], strict=False):
            owner = (meta or {}).get("user_id", user_id)
            source_by_text.setdefault(doc, _source_of(str(owner)))
        return [format_fragment(text, source_by_text.get(text, "user")) for text in ranked]

    async def delete(self, user_id: str) -> None:
        if user_id == GLOBAL:
            return
        await asyncio.to_thread(self._col.delete, where={"user_id": user_id})

    async def _enforce_retention(self, user_id: str) -> None:
        if user_id == GLOBAL:
            return
        payload = await asyncio.to_thread(
            self._col.get,
            where={"user_id": user_id},
            include=["metadatas"],
        )
        ids = list(payload.get("ids") or [])
        metas = list(payload.get("metadatas") or [])
        if len(ids) <= self._max_docs:
            return
        ordered = sorted(
            zip(ids, metas, strict=False),
            key=lambda item: float((item[1] or {}).get("created_at") or 0),
        )
        drop = [doc_id for doc_id, _ in ordered[: len(ids) - self._max_docs]]
        if drop:
            await asyncio.to_thread(self._col.delete, ids=drop)


async def seed_global(store: Any) -> None:
    await store.add(GLOBAL, PRESOCRATIC_SEED)
