"""Panel de sistema: estado de cada componente, actividad del proceso, A2A y límites.

Solo agregados del proceso (por instancia) y datos del propio usuario (sus tareas A2A y su
cupo de rate limit). Nunca expone secretos, preguntas ajenas ni detalles de errores internos.
"""

import asyncio
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from apeiron_api.a2a.card import API_VERSION, rpc_url
from apeiron_api.container import Container
from apeiron_api.deps import current_user, get_container
from apeiron_infra.a2a import wire
from apeiron_infra.resilience import CircuitBreaker

router = APIRouter(prefix="/v1", tags=["system"])
BREAKER_STATUS = {"closed": "ok", "half_open": "degraded", "open": "down"}
RECENT_FAILURE_S = 300


def _component(id_: str, label: str, status: str, detail: str) -> dict[str, str]:
    return {"id": id_, "label": label, "status": status, "detail": detail}


def _breaker(breaker: CircuitBreaker | None) -> tuple[str, str]:
    state = breaker.state if breaker else "closed"
    return BREAKER_STATUS[state], state


async def _memory(c: Container) -> dict[str, str]:
    probe = c.probes.get("memory")
    backend = c.settings.vector_backend
    if probe is None:
        return _component("memory", "Memoria vectorial", "ok", backend)
    try:
        async with asyncio.timeout(2):
            size = await probe()
    except Exception:
        return _component("memory", "Memoria vectorial", "down", f"{backend} no responde")
    return _component("memory", "Memoria vectorial", "ok", f"{backend} · {size} fragmentos")


def _runs(c: Container) -> dict[str, str]:
    if c.runs is None:
        return _component("runs", "Historial (Supabase)", "disabled", "requiere APEIRON_AUTH_PROVIDER=supabase")
    failed_at = c.metrics.last_failure_at.get("run_persist_failed")
    if failed_at and time.time() - failed_at < RECENT_FAILURE_S:
        ago = int(time.time() - failed_at)
        return _component("runs", "Historial (Supabase)", "degraded", f"último guardado fallido hace {ago} s")
    return _component("runs", "Historial (Supabase)", "ok", "Postgres con RLS por usuario")


def _scholar(c: Container) -> dict[str, str]:
    label = "Literatura académica (MCP)"
    if not c.settings.scholar_mcp_url:
        return _component("scholarly_sources", label, "disabled", "APEIRON_SCHOLAR_MCP_URL vacío")
    status, state = _breaker(c.breakers.get("scholarly_sources"))
    detail = f"OpenAlex vía {c.settings.scholar_mcp_url} · breaker {state}"
    return _component("scholarly_sources", label, status, detail)


async def _components(c: Container, base_url: str) -> list[dict[str, str]]:
    s = c.settings
    if s.llm_provider == "fake":
        llm = _component("llm", "Modelo de lenguaje", "simulated", "LLM determinista (0 tokens)")
    else:
        status, state = _breaker(c.breakers.get("llm"))
        fallback = f" · respaldo {s.llm_fallback_model}" if s.llm_fallback_model else ""
        detail = f"{s.llm_provider}:{s.llm_model} · breaker {state}{fallback}"
        llm = _component("llm", "Modelo de lenguaje", status, detail)
    status, state = _breaker(c.breakers.get("external_sources"))
    source = "servidor MCP" if s.mcp_server_url else "arXiv"
    components = [
        llm,
        await _memory(c),
        _runs(c),
        _component("external_sources", "Fuentes externas", status, f"{source} · breaker {state}"),
        _scholar(c),
        _component(
            "guardrails",
            "Guardrails",
            "ok" if s.guardrails_enabled else "disabled",
            "deterministas · 0 tokens" if s.guardrails_enabled else "APEIRON_GUARDRAILS_ENABLED=false",
        ),
        _component(
            "a2a_server",
            "Servidor A2A",
            "ok" if s.a2a_server_enabled else "disabled",
            rpc_url(s, base_url) if s.a2a_server_enabled else "APEIRON_A2A_SERVER_ENABLED=false",
        ),
    ]
    for name, agent in c.remotes.items():
        status, state = _breaker(agent.breaker)
        components.append(_component(f"remote:{name}", f"Agente remoto · {name}", status, f"A2A · breaker {state}"))
    return components


@router.get("/system")
async def system(
    request: Request,
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> dict[str, Any]:
    s = c.settings
    base_url = str(request.base_url)
    return {
        "service": {
            "version": API_VERSION,
            "env": s.env,
            "auth_provider": s.auth_provider,
            "started_at": c.started_at,
            "uptime_s": int(time.time() - c.started_at),
        },
        "components": await _components(c, base_url),
        "activity": c.metrics.snapshot(),
        "a2a": {
            "server_enabled": s.a2a_server_enabled,
            "card_url": (s.a2a_public_url or base_url).rstrip("/") + wire.CARD_PATH if s.a2a_server_enabled else None,
            "tasks": c.a2a_tasks.counts(),
            "my_tasks": [task.summary() for task in c.a2a_tasks.for_owner(user)],
        },
        "limits": {
            "chat_per_min": s.chat_rate_limit_per_min,
            "chat_remaining": c.limiter.remaining(f"chat:{user}", s.chat_rate_limit_per_min),
            "max_rounds": 4,
            "max_react_steps": s.max_react_steps,
            "node_timeout_s": s.node_timeout_s,
            "tool_timeout_s": s.tool_timeout_s,
            "require_evidence": s.require_evidence,
        },
    }
