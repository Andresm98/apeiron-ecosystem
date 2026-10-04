from typing import Annotated

from fastapi import APIRouter, Depends, status

from apeiron_api.container import Container
from apeiron_api.deps import current_user, get_container

router = APIRouter(prefix="/v1/memory", tags=["memory"])


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    user: Annotated[str, Depends(current_user)],
    c: Annotated[Container, Depends(get_container)],
) -> None:
    await c.memory.delete(user)
