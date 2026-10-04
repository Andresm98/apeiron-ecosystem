import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from apeiron_api.container import Container
from apeiron_api.deps import current_user, get_container
from apeiron_core.application.ports.outbound.runs import RunRepositoryPort

router = APIRouter(prefix="/v1/runs", tags=["runs"])
log = logging.getLogger("apeiron.api")


def _repository(c: Container) -> RunRepositoryPort:
    if c.runs is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "historial deshabilitado (requiere Supabase)"
        )
    return c.runs


@router.get("")
async def list_runs(
    _: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[dict[str, Any]]:
    """Ejecuciones recientes del usuario autenticado (resumen)."""
    try:
        return await _repository(c).list_recent(limit)
    except HTTPException:
        raise
    except Exception:
        log.warning("runs_list_failed", exc_info=True)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "historial no disponible") from None


@router.get("/{run_id}")
async def get_run(
    run_id: uuid.UUID,  # validado: evita inyectar filtros PostgREST
    _: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> dict[str, Any]:
    try:
        run = await _repository(c).get(str(run_id))
    except HTTPException:
        raise
    except Exception:
        log.warning("runs_get_failed", exc_info=True)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "historial no disponible") from None
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ejecución no encontrada")
    return run
