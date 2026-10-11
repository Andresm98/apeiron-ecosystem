"""Sesiones deliberativas de la Polis (ADR-013, fase 2): el usuario convoca, participa y gobierna el debate.

La sesión vive en el servidor (sobrevive a la desconexión y, con `APEIRON_SESSIONS_DB_PATH`, a un reinicio de la
API); el SSE es reanudable con `after=N` y cada frame lleva `id: N`. Las sesiones son privadas: una ajena responde
404, igual que una inexistente.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse

from apeiron_api.container import Container
from apeiron_api.deps import current_user, enforce_chat_rate, get_container
from apeiron_api.schemas import InviteRequest, SessionRequest, TurnRequest
from apeiron_core.application.orchestration.control import HUMAN, MAX_PARTICIPANTS
from apeiron_core.application.use_cases.deliberation import (
    DeliberationService,
    DeliberationSession,
    SessionConfig,
    SessionError,
    SessionLimitError,
)

router = APIRouter(prefix="/v1/sessions", tags=["sessions"])
log = logging.getLogger("apeiron.api")


def _service(c: Container) -> DeliberationService:
    if c.sessions is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sessions_disabled")
    return c.sessions


async def _session(session_id: str, user: str, c: Container) -> DeliberationSession:
    session = await _service(c).get(session_id, user)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session_not_found")
    return session


def _agents(c: Container) -> set[str]:
    return {a["name"] for a in c.topology["agents"]}


def _conflict(exc: SessionError) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, str(exc))


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_session(
    body: SessionRequest,
    user: Annotated[str, Depends(enforce_chat_rate)],
    c: Annotated[Container, Depends(get_container)],
) -> dict[str, Any]:
    known = _agents(c)
    if body.agent is not None and body.agent not in known:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"agente desconocido: {body.agent}")
    unknown = [p for p in body.participants or [] if p not in known and p != HUMAN]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"participantes desconocidos: {unknown}")
    config = SessionConfig(**body.model_dump())
    try:
        session = await _service(c).start(user, config)
    except SessionLimitError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc)) from None
    return session.snapshot()


@router.get("")
async def list_sessions(
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> list[dict[str, Any]]:
    """Deliberaciones abiertas del usuario (también las que sobrevivieron a un reinicio), para retomarlas."""
    return await _service(c).list_open(user)


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> dict[str, Any]:
    return (await _session(session_id, user, c)).snapshot()


@router.get("/{session_id}/events")
async def session_events(
    session_id: str,
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
    after: Annotated[int, Query(ge=0)] = 0,
) -> StreamingResponse:
    session = await _session(session_id, user, c)

    async def frames() -> AsyncIterator[str]:
        async for seq, event in session.follow(after):
            yield f"id: {seq}\nevent: {event.type}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        frames(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@router.post("/{session_id}/turn")
async def submit_turn(
    session_id: str,
    body: TurnRequest,
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> dict[str, Any]:
    session = await _session(session_id, user, c)
    try:
        result = await _service(c).submit_turn(session, body.text)
    except SessionError as exc:
        raise _conflict(exc) from None
    if not result["accepted"]:
        # El guardrail de entrada bloqueó el texto: la sesión sigue esperando una nueva redacción.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"blocked": True, "rules": result["rules"]})
    return result


@router.post("/{session_id}/advance", status_code=status.HTTP_204_NO_CONTENT)
async def advance(
    session_id: str,
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> Response:
    try:
        _service(c).advance(await _session(session_id, user, c))
    except SessionError as exc:
        raise _conflict(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{session_id}/invite", status_code=status.HTTP_204_NO_CONTENT)
async def invite(
    session_id: str,
    body: InviteRequest,
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> Response:
    session = await _session(session_id, user, c)
    if body.agent not in _agents(c) and body.agent != HUMAN:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"agente desconocido: {body.agent}")
    if session.config.agent is not None or session.collector.mode == "single":
        raise HTTPException(status.HTTP_409_CONFLICT, "solo se puede invitar a un debate")
    present = set(session.collector.participants) | set(session.control.invited)
    if body.agent not in present and len(present) >= MAX_PARTICIPANTS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"máximo {MAX_PARTICIPANTS} participantes")
    try:
        _service(c).invite(session, body.agent)
    except SessionError as exc:
        raise _conflict(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{session_id}/close", status_code=status.HTTP_204_NO_CONTENT)
async def close(
    session_id: str,
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> Response:
    try:
        _service(c).close(await _session(session_id, user, c))
    except SessionError as exc:
        raise _conflict(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel(
    session_id: str,
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> Response:
    _service(c).cancel(await _session(session_id, user, c))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
