import asyncio
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


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "test"


def _rate_limited() -> HTTPException:
    return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited")


async def enforce_auth_rate(
    request: Request, container: Annotated[Container, Depends(get_container)]
) -> None:
    key = f"auth:{client_ip(request)}"
    if not container.limiter.allow(key, container.settings.auth_rate_limit_per_min):
        raise _rate_limited()


async def current_user(
    token: Annotated[str, Depends(oauth2)],
    container: Annotated[Container, Depends(get_container)],
) -> str:
    try:
        # Supabase puede descargar el JWKS en la primera verificación: fuera del event loop.
        user = await asyncio.to_thread(container.tokens.decode, token)
    except InvalidTokenError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "token inválido",
            {"WWW-Authenticate": "Bearer"},
        ) from None
    request_ctx.set(replace(request_ctx.get(), user_id=user, access_token=token))
    return user


async def enforce_chat_rate(
    user: Annotated[str, Depends(current_user)],
    container: Annotated[Container, Depends(get_container)],
) -> str:
    if not container.limiter.allow(f"chat:{user}", container.settings.chat_rate_limit_per_min):
        raise _rate_limited()
    return user
