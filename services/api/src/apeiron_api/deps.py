from dataclasses import replace
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer

from apeiron_api.container import Container
from apeiron_core.application.context import request_ctx
from apeiron_infra.security.tokens import InvalidTokenError

oauth2 = OAuth2PasswordBearer(tokenUrl="/v1/auth/token")


def get_container(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


async def current_user(
    token: Annotated[str, Depends(oauth2)],
    container: Annotated[Container, Depends(get_container)],
) -> str:
    try:
        user = container.tokens.decode(token)
    except InvalidTokenError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "token inválido",
            {"WWW-Authenticate": "Bearer"},
        ) from None
    request_ctx.set(replace(request_ctx.get(), user_id=user))
    return user
