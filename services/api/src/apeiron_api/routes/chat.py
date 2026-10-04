import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from apeiron_api.container import Container
from apeiron_api.deps import current_user, get_container
from apeiron_api.schemas import ChatRequest, ChatResponse
from apeiron_core.application.context import request_ctx

router = APIRouter(prefix="/v1", tags=["chat"])
log = logging.getLogger("apeiron.api")


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/agents")
async def agents(_: Annotated[str, Depends(current_user)]) -> dict[str, list[str]]:
    return {"agents": ["anaximandro", "heraclito"], "modes": ["single", "debate"]}


@router.post("/chat")
async def chat(
    body: ChatRequest,
    _: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> ChatResponse:
    out = await c.facade.ask(body.question, body.mode, body.max_rounds)
    return ChatResponse(
        answer=out["answer"], mode=out["mode"], turns=out["turns"], trace=out["trace"]
    )


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest,
    _: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> StreamingResponse:
    ctx = request_ctx.get()  # incluye user_id fijado por la dependencia

    async def events() -> AsyncIterator[str]:
        request_ctx.set(ctx)
        try:
            async for ev in c.facade.stream(body.question, body.mode, body.max_rounds):
                yield sse(ev.type, ev.data)
        except Exception:
            log.exception("stream_failed")
            yield sse("error", {"message": "internal_error", "trace_id": ctx.trace_id})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
