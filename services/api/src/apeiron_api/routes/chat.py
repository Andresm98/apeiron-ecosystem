import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from apeiron_api.container import Container
from apeiron_api.deps import current_user, enforce_chat_rate, get_container
from apeiron_api.schemas import ChatRequest, ChatResponse
from apeiron_core.application.context import request_ctx

router = APIRouter(prefix="/v1", tags=["chat"])
log = logging.getLogger("apeiron.api")


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/agents")
async def agents(
    _: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> dict[str, Any]:
    """Topología del grafo para la UI: orquestador, workers, tools y límites."""
    return c.topology


def _check_agent(body: ChatRequest, c: Container) -> None:
    """El interlocutor y la mesa deben existir en la topología publicada (incluye los remotos A2A)."""
    known = {a["name"] for a in c.topology["agents"]}
    if body.agent is not None and body.agent not in known:
        raise HTTPException(status_code=422, detail=f"agente desconocido: {body.agent}")
    unknown = [name for name in body.participants or [] if name not in known]
    if unknown:
        raise HTTPException(status_code=422, detail=f"participantes desconocidos: {', '.join(unknown)}")


def _conversation(body: ChatRequest) -> str | None:
    return str(body.conversation_id) if body.conversation_id else None


@router.post("/chat")
async def chat(
    body: ChatRequest,
    _: Annotated[str, Depends(enforce_chat_rate)],
    c: Annotated[Container, Depends(get_container)],
) -> ChatResponse:
    _check_agent(body, c)
    out = await c.facade.ask(
        body.question,
        body.mode,
        body.max_rounds,
        body.simulate,
        body.agent,
        participants=body.participants,
        conversation_id=_conversation(body),
    )
    return ChatResponse(
        answer=out["answer"],
        mode=out["mode"],
        turns=out["turns"],
        trace=out["trace"],
        usage=out["usage"],
    )


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest,
    _: Annotated[str, Depends(enforce_chat_rate)],
    c: Annotated[Container, Depends(get_container)],
) -> StreamingResponse:
    _check_agent(body, c)
    ctx = request_ctx.get()  # incluye user_id fijado por la dependencia

    async def events() -> AsyncIterator[str]:
        request_ctx.set(ctx)
        try:
            async for ev in c.facade.stream(
                body.question,
                body.mode,
                body.max_rounds,
                body.simulate,
                body.agent,
                participants=body.participants,
                conversation_id=_conversation(body),
            ):
                yield sse(ev.type, ev.data)
        except Exception:
            log.exception("stream_failed")
            yield sse("error", {"message": "internal_error", "trace_id": ctx.trace_id})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
