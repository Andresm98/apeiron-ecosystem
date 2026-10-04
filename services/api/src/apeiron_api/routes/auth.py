from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from apeiron_api.container import Container
from apeiron_api.deps import enforce_auth_rate, get_container
from apeiron_api.schemas import Credentials, TokenResponse
from apeiron_infra.security.tokens import hash_password, verify_password

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.get("/config")
async def auth_config(c: Annotated[Container, Depends(get_container)]) -> dict[str, bool]:
    return {"public_register": c.settings.public_register}


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: Credentials,
    c: Annotated[Container, Depends(get_container)],
    _: Annotated[None, Depends(enforce_auth_rate)],
) -> dict[str, str]:
    if not c.settings.public_register:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "registro deshabilitado")
    if not await c.users.add(body.username, hash_password(body.password)):
        raise HTTPException(status.HTTP_409_CONFLICT, "usuario existente")
    return {"username": body.username}


@router.post("/token")
async def token(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    c: Annotated[Container, Depends(get_container)],
    _: Annotated[None, Depends(enforce_auth_rate)],
) -> TokenResponse:
    hashed = await c.users.get(form.username)
    if not hashed or not verify_password(form.password, hashed):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "credenciales inválidas")
    return TokenResponse(access_token=c.tokens.create(form.username))
