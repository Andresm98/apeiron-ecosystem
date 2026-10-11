"""Ejecuciones de agentes en Postgres de Supabase vía PostgREST.

Escritura atómica con la RPC `record_agent_run` (ejecución + `agent_executions`); lectura
de `agent_runs` con los agentes ejecutados embebidos. Esquema en `supabase/migrations/`.

También es la memoria durable de las conversaciones de la consola (ADR-014): cada ejecución guarda su
`conversation_id` y los intercambios previos se leen de `agent_runs`, así que `append` no escribe nada.

Escribe y lee con el access token del propio usuario (tomado del contexto de la
petición), así que las políticas RLS de la tabla garantizan que cada usuario solo
inserta y ve sus ejecuciones. El backend no necesita la service_role key.
"""

from typing import Any

import httpx

from apeiron_core.application.context import request_ctx
from apeiron_core.application.dto.runs import AgentRun
from apeiron_core.application.ports.outbound.conversations import ConversationExchange

SUMMARY_COLUMNS = (
    "id,created_at,question,mode,simulate,status,usage,model,duration_ms,channel,a2a_task_id,guardrails,"
    "conversation_id"
)
MAX_CONVERSATION_RUNS = 50
EXECUTIONS = (
    "agent_executions(agent_id,invocations,reasoning_steps,tool_calls,tools_used,degraded,duration_ms,"
    "llm_calls,input_tokens,output_tokens)"
)


class RunPersistenceError(RuntimeError):
    pass


class SupabaseRunRepository:
    def __init__(
        self,
        supabase_url: str,
        api_key: str,
        client: httpx.AsyncClient,
        table: str = "agent_runs",
    ) -> None:
        base = supabase_url.rstrip("/")
        self._endpoint = f"{base}/rest/v1/{table}"
        self._rpc = f"{base}/rest/v1/rpc/record_agent_run"
        self._api_key = api_key
        self._http = client

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        token = request_ctx.get().access_token
        if not token:
            raise RunPersistenceError("sin credencial de usuario para Supabase")
        return {"apikey": self._api_key, "Authorization": f"Bearer {token}", **(extra or {})}

    async def save(self, run: AgentRun) -> None:
        """Ejecución + agentes ejecutados en una transacción (RPC `record_agent_run`)."""
        payload = {k: v for k, v in run.items() if k not in ("agents", "user_id")}
        res = await self._http.post(
            self._rpc,
            json={"p_run": payload, "p_agents": run["agents"]},
            headers=self._headers(),
        )
        if res.status_code >= 300:
            raise RunPersistenceError(f"record_agent_run: HTTP {res.status_code} {res.text[:200]}")

    async def list_recent(self, limit: int = 20) -> list[dict[str, Any]]:
        res = await self._http.get(
            self._endpoint,
            params={
                "select": SUMMARY_COLUMNS,
                "user_id": f"eq.{request_ctx.get().user_id}",  # además de RLS
                "order": "created_at.desc",
                "limit": str(min(max(limit, 1), 100)),
            },
            headers=self._headers(),
        )
        if res.status_code >= 300:
            raise RunPersistenceError(f"select agent_runs: HTTP {res.status_code}")
        rows: list[dict[str, Any]] = res.json()
        return rows

    async def get(self, run_id: str) -> dict[str, Any] | None:
        res = await self._http.get(
            self._endpoint,
            params={
                "select": f"*,{EXECUTIONS}",
                "id": f"eq.{run_id}",
                "user_id": f"eq.{request_ctx.get().user_id}",
                "limit": "1",
            },
            headers=self._headers(),
        )
        if res.status_code >= 300:
            raise RunPersistenceError(f"select agent_runs: HTTP {res.status_code}")
        rows: list[dict[str, Any]] = res.json()
        return rows[0] if rows else None

    async def conversation(self, conversation_id: str, limit: int = MAX_CONVERSATION_RUNS) -> list[dict[str, Any]]:
        """Ejecuciones completas de una conversación del usuario, de la más antigua a la más reciente."""
        res = await self._http.get(
            self._endpoint,
            params={
                "select": f"*,{EXECUTIONS}",
                "conversation_id": f"eq.{conversation_id}",
                "user_id": f"eq.{request_ctx.get().user_id}",  # además de RLS
                "order": "created_at.asc",
                "limit": str(min(max(limit, 1), MAX_CONVERSATION_RUNS)),
            },
            headers=self._headers(),
        )
        if res.status_code >= 300:
            raise RunPersistenceError(f"select agent_runs (conversación): HTTP {res.status_code}")
        rows: list[dict[str, Any]] = res.json()
        return rows

    async def exchanges(self, conversation_id: str, limit: int = 6) -> list[ConversationExchange]:
        """Últimos intercambios completados (sin los bloqueados ni los fallidos) para el contexto de los agentes."""
        res = await self._http.get(
            self._endpoint,
            params={
                "select": "question,answer,mode",
                "conversation_id": f"eq.{conversation_id}",
                "user_id": f"eq.{request_ctx.get().user_id}",
                "status": "eq.completed",
                "order": "created_at.desc",
                "limit": str(min(max(limit, 1), MAX_CONVERSATION_RUNS)),
            },
            headers=self._headers(),
        )
        if res.status_code >= 300:
            raise RunPersistenceError(f"select agent_runs (contexto): HTTP {res.status_code}")
        rows: list[dict[str, Any]] = res.json()
        return [
            {
                "question": str(row.get("question") or ""),
                "answer": str(row.get("answer") or ""),
                "mode": str(row.get("mode") or ""),
            }
            for row in reversed(rows)
        ]

    async def append(self, conversation_id: str, exchange: ConversationExchange) -> None:
        """Nada que hacer: `record_agent_run` ya guarda la ejecución con su `conversation_id`."""
