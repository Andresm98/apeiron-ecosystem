"""Servidor A2A 1.0 (binding JSON-RPC): SendMessage, SendStreamingMessage, GetTask, CancelTask.

La Agent Card es pública; el endpoint exige el mismo Bearer que la API, así que la tarea
corre con la identidad, el RLS y el rate limit del usuario. Con `APEIRON_A2A_SERVER_ENABLED`
desactivado ambas rutas responden 404.
"""

import asyncio
import contextvars
import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from apeiron_api.a2a.card import agent_card
from apeiron_api.a2a.tasks import END, A2ATask, run_task
from apeiron_api.container import Container
from apeiron_api.deps import current_user, get_container
from apeiron_api.schemas import ChatRequest
from apeiron_core.application.context import request_ctx
from apeiron_infra.a2a import wire
from apeiron_infra.a2a.client import HOPS_KEY

router = APIRouter(tags=["a2a"])
log = logging.getLogger("apeiron.a2a")


class RpcError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


def _enabled(c: Container) -> None:
    if not c.settings.a2a_server_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "servidor A2A deshabilitado")


@router.get(wire.CARD_PATH)
async def card(request: Request, c: Annotated[Container, Depends(get_container)]) -> dict[str, Any]:
    _enabled(c)
    return agent_card(c.settings, c.topology, str(request.base_url))


def _hops(meta: dict[str, Any]) -> int:
    value = meta.get(HOPS_KEY, 0)
    return min(max(value, 0), 10) if isinstance(value, int) else 0


def _chat_request(params: dict[str, Any]) -> tuple[ChatRequest, dict[str, Any], int]:
    msg = params.get("message")
    if not isinstance(msg, dict):
        raise RpcError(wire.INVALID_PARAMS, "falta params.message")
    if msg.get("taskId"):
        raise RpcError(wire.UNSUPPORTED_OPERATION, "continuar una tarea existente no está soportado")
    meta = {**(params.get("metadata") or {}), **(msg.get("metadata") or {})}
    try:
        req = ChatRequest(
            question=wire.text_of(msg.get("parts")),
            mode=meta.get("mode"),
            max_rounds=meta.get("maxRounds"),
            simulate=bool(meta.get("simulate", False)),
        )
    except ValidationError:
        raise RpcError(
            wire.INVALID_PARAMS,
            "se espera texto de 1 a 4000 caracteres; metadata.mode single|debate; metadata.maxRounds 1-4",
        ) from None
    return req, msg, _hops(meta)


def _start(c: Container, user: str, params: dict[str, Any], *, stream: bool) -> A2ATask:
    if not c.limiter.allow(f"chat:{user}", c.settings.chat_rate_limit_per_min):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited")
    req, msg, hops = _chat_request(params)
    ctx = request_ctx.get()
    task = A2ATask(
        id=uuid.uuid4().hex,
        context_id=str(msg.get("contextId") or uuid.uuid4().hex),
        owner=user,
        trace_id=ctx.trace_id,
        question=req.question,
        history=[{**msg, "role": wire.ROLE_USER}],
    )
    c.a2a_tasks.add(task)
    # Contexto limpio: solo identidad, canal y correlación. Nada ambiental (p. ej. la config de
    # un grafo LangGraph que llame a este servidor en proceso) se filtra a la tarea.
    isolated = contextvars.Context()
    isolated.run(
        request_ctx.set,
        replace(ctx, channel="a2a", a2a_task_id=task.id, session_id=task.context_id, a2a_hops=hops),
    )
    if stream:
        task.subscribers.append(asyncio.Queue())  # suscrito antes de arrancar: no pierde eventos
    task.runner = asyncio.create_task(
        run_task(task, c.facade, req.question, req.mode, req.max_rounds, req.simulate),
        name=f"a2a:{task.id}",
        context=isolated,
    )
    log.info("a2a_task_started", extra={"a2a_task_id": task.id})
    return task


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream(request_id: Any, task: A2ATask) -> StreamingResponse:
    queue = task.subscribers[0]

    async def events() -> AsyncIterator[str]:
        try:
            yield _sse(wire.rpc_result(request_id, {"task": task.to_dict()}))
            while (event := await queue.get()) is not END:
                yield _sse(wire.rpc_result(request_id, event))
        finally:
            if queue in task.subscribers:  # el cliente se fue: la tarea sigue y queda en GetTask
                task.subscribers.remove(queue)

    return StreamingResponse(
        events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


async def _dispatch(c: Container, user: str, request_id: Any, method: str, params: dict[str, Any]) -> Any:
    if method == "SendStreamingMessage":
        return _stream(request_id, _start(c, user, params, stream=True))
    if method == "SendMessage":
        task = _start(c, user, params, stream=False)
        if not (params.get("configuration") or {}).get("returnImmediately") and task.runner:
            await asyncio.shield(task.runner)  # si el cliente corta, la tarea continúa
        return {"task": task.to_dict()}
    if method in ("GetTask", "CancelTask"):
        found = c.a2a_tasks.get(str(params.get("id", "")), user)
        if found is None:
            raise RpcError(wire.TASK_NOT_FOUND, "tarea no encontrada")
        if method == "CancelTask":
            if found.state in wire.TERMINAL or found.runner is None:
                raise RpcError(wire.TASK_NOT_CANCELABLE, f"la tarea ya terminó ({found.state})")
            found.runner.cancel()
            await asyncio.wait({found.runner}, timeout=5)
        length = params.get("historyLength")
        return found.to_dict(length if isinstance(length, int) and length >= 0 else None)
    raise RpcError(wire.METHOD_NOT_FOUND, f"método no soportado: {method}")


@router.post("/a2a")
async def a2a(
    request: Request,
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> Any:
    _enabled(c)
    request_id: Any = None
    try:
        if not wire.supports_version(request.headers.get(wire.VERSION_HEADER)):
            raise RpcError(wire.VERSION_NOT_SUPPORTED, f"solo A2A {wire.PROTOCOL_VERSION}")
        try:
            body = await request.json()
        except ValueError:
            raise RpcError(wire.PARSE_ERROR, "JSON inválido") from None
        if not isinstance(body, dict) or body.get("jsonrpc") != "2.0" or not isinstance(body.get("method"), str):
            raise RpcError(wire.INVALID_REQUEST, "petición JSON-RPC 2.0 inválida")
        request_id = body.get("id")
        params = body.get("params") or {}
        if not isinstance(params, dict):
            raise RpcError(wire.INVALID_PARAMS, "params debe ser un objeto")
        result = await _dispatch(c, user, request_id, body["method"], params)
    except RpcError as exc:
        return JSONResponse(wire.rpc_error(request_id, exc.code, exc.message))
    if isinstance(result, StreamingResponse):
        return result
    return JSONResponse(wire.rpc_result(request_id, result))
