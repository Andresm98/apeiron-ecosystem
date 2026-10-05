"""Cliente mínimo de OpenAlex (https://openalex.org): búsqueda de obras académicas con DOI.

Gratuito y sin clave. Con `mailto` las peticiones entran en el "polite pool" (más estables).
"""

from dataclasses import dataclass
from typing import Any

import httpx

OPENALEX_URL = "https://api.openalex.org/works"
FIELDS = "id,doi,display_name,publication_year,authorships,primary_location,abstract_inverted_index,cited_by_count"
MAX_QUERY_CHARS = 300
MAX_RESULTS = 5
ABSTRACT_CHARS = 280


@dataclass(frozen=True)
class Work:
    title: str
    year: int | None
    authors: list[str]
    venue: str
    doi: str  # "10.xxxx/yyy" o ""
    url: str
    cited_by: int
    abstract: str


def abstract_from_index(index: dict[str, list[int]] | None, limit: int = ABSTRACT_CHARS) -> str:
    """OpenAlex publica el resumen como índice invertido {palabra: [posiciones]}."""
    if not index:
        return ""
    positions = sorted((pos, word) for word, places in index.items() for pos in places)
    text = " ".join(word for _, word in positions)
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "…"


def parse_work(raw: dict[str, Any]) -> Work:
    location = raw.get("primary_location") or {}
    doi_url = raw.get("doi") or ""
    return Work(
        title=" ".join(str(raw.get("display_name") or "Sin título").split()),
        year=raw.get("publication_year"),
        authors=[
            author["display_name"]
            for a in raw.get("authorships") or []
            if (author := a.get("author") or {}).get("display_name")
        ],
        venue=((location.get("source") or {}).get("display_name")) or "",
        doi=doi_url.removeprefix("https://doi.org/"),
        url=doi_url or location.get("landing_page_url") or raw.get("id") or "",
        cited_by=int(raw.get("cited_by_count") or 0),
        abstract=abstract_from_index(raw.get("abstract_inverted_index")),
    )


def format_works(works: list[Work]) -> str:
    """Texto para el LLM: cada obra con su DOI literal, para que sus citas sean verificables."""
    if not works:
        return "Sin resultados en OpenAlex."
    lines = []
    for w in works:
        authors = ", ".join(w.authors[:3]) + (" et al." if len(w.authors) > 3 else "")
        head = f"- {w.title} ({w.year or 's. f.'})"
        cited = f"citado {w.cited_by} {'vez' if w.cited_by == 1 else 'veces'}"
        meta = " · ".join(p for p in (authors, w.venue, cited) if p)
        ref = f"doi:{w.doi} · {w.url}" if w.doi else w.url
        lines.append(f"{head} — {meta}\n  {ref}" + (f"\n  {w.abstract}" if w.abstract else ""))
    return "\n".join(lines)


class OpenAlexClient:
    def __init__(self, http: httpx.AsyncClient, mailto: str | None = None, url: str = OPENALEX_URL) -> None:
        self._http, self._mailto, self._url = http, mailto, url

    async def search(self, query: str, limit: int = 3) -> list[Work]:
        query = " ".join(query.split())[:MAX_QUERY_CHARS]
        if not query:
            return []
        params: dict[str, str | int] = {
            "search": query,
            "per-page": max(1, min(limit, MAX_RESULTS)),
            "select": FIELDS,
        }
        if self._mailto:
            params["mailto"] = self._mailto
        res = await self._http.get(self._url, params=params)
        res.raise_for_status()
        return [parse_work(raw) for raw in res.json().get("results", [])]
