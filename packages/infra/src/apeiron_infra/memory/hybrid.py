"""Fusión determinista de candidatos semánticos y léxicos (BM25)."""

from __future__ import annotations

import math
import re
from collections import Counter

_WORD = re.compile(r"\w+", re.UNICODE)


def tokenize(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if len(w) > 2]


def bm25_scores(query: str, docs: list[str], *, k1: float = 1.5, b: float = 0.75) -> list[float]:
    terms = tokenize(query)
    if not docs:
        return []
    if not terms:
        return [0.0] * len(docs)
    tokenized = [tokenize(doc) for doc in docs]
    avgdl = sum(len(toks) for toks in tokenized) / len(tokenized)
    df: Counter[str] = Counter()
    for toks in tokenized:
        df.update(set(toks))
    n_docs = len(docs)
    idf = {
        term: math.log(1 + (n_docs - df[term] + 0.5) / (df[term] + 0.5)) for term in set(terms)
    }
    scores: list[float] = []
    for toks in tokenized:
        tf = Counter(toks)
        length = len(toks) or 1
        score = 0.0
        for term in terms:
            freq = tf.get(term, 0)
            if not freq:
                continue
            denom = freq + k1 * (1 - b + b * length / avgdl)
            score += idf[term] * (freq * (k1 + 1)) / denom
        scores.append(score)
    return scores


def _normalize(values: list[float]) -> list[float]:
    peak = max(values, default=0.0)
    if peak <= 0:
        return [0.0] * len(values)
    return [value / peak for value in values]


def format_fragment(text: str, source: str) -> str:
    return f"[source={source}] {text}"


def hybrid_rerank(
    query: str,
    *,
    semantic: list[tuple[str, float]],
    lexical_docs: list[str],
    k: int,
    semantic_weight: float = 0.6,
    lexical_weight: float = 0.4,
) -> list[str]:
    """Combina similitud semántica (mayor es mejor) y BM25; deduplica por texto."""
    pooled: dict[str, str] = {}
    semantic_raw: dict[str, float] = {}
    for text, score in semantic:
        key = text.strip()
        if not key:
            continue
        pooled[key] = text
        semantic_raw[key] = max(score, semantic_raw.get(key, 0.0))
    for text in lexical_docs:
        key = text.strip()
        if key:
            pooled.setdefault(key, text)
    ordered = list(pooled.values())
    if not ordered:
        return []
    keys = [doc.strip() for doc in ordered]
    lex_map = dict(zip(keys, bm25_scores(query, ordered), strict=True))
    sem_norm = _normalize([semantic_raw.get(key, 0.0) for key in keys])
    lex_norm = _normalize([lex_map.get(key, 0.0) for key in keys])
    ranked = sorted(
        zip(keys, sem_norm, lex_norm, strict=True),
        key=lambda item: -(semantic_weight * item[1] + lexical_weight * item[2]),
    )
    out: list[str] = []
    for key, sem, lex in ranked:
        if sem <= 0 and lex <= 0:
            continue
        out.append(pooled[key])
        if len(out) >= k:
            break
    return out
