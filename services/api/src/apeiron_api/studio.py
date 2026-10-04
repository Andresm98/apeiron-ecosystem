"""Grafos para LangGraph Studio (`langgraph dev`), con la misma composición que la API.

- `apeiron`: LLM configurado en el entorno (consume tokens).
- `apeiron_demo`: LLM determinista; recorre router, workers, tools y síntesis con 0 tokens.

Studio no pasa por la API: no hay JWT y la memoria se consulta como usuario `anonymous`.
`langgraph dev` llama a la fábrica en cada petición y usa varios event loops: el grafo se
cachea por loop (el cliente httpx queda ligado a uno) y el cliente Chroma, que hace I/O
síncrono, se crea fuera del loop.
"""

import asyncio
from typing import Any

import httpx

from apeiron_api.container import _build_store, _build_tools, build_apeiron_graph
from apeiron_api.settings import Settings
from apeiron_infra.memory.vector import seed_global
from apeiron_infra.observability.langsmith import configure_langsmith

_graphs: dict[tuple[bool, int], Any] = {}


async def _graph(simulate: bool) -> Any:
    key = (simulate, id(asyncio.get_running_loop()))
    if key not in _graphs:  # construir dos veces en una carrera es inocuo
        s = Settings()
        configure_langsmith(s.langsmith_enabled, s.langsmith_api_key, s.langsmith_project)
        store = await asyncio.to_thread(_build_store, s)
        await seed_global(store)
        http = httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "apeiron-studio/0.2"})
        _graphs[key] = build_apeiron_graph(s, _build_tools(s, http, store), simulate)
    return _graphs[key]


async def apeiron() -> Any:
    return await _graph(simulate=False)


async def apeiron_demo() -> Any:
    return await _graph(simulate=True)
