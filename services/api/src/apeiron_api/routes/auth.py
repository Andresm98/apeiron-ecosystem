from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from apeiron_api.container import Container
from apeiron_api.deps import get_container
from apeiron_api.schemas import Credentials, TokenResponse
from apeiron_infra.security.tokens import hash_password, verify_password

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: Credentials, c: Annotated[Container, Depends(get_container)]) -> dict[str, str]:
    if not await c.users.add(body.username, hash_password(body.password)):
        raise HTTPException(status.HTTP_409_CONFLICT, "usuario existente")
    return {"username": body.username}


@router.post("/token")
async def token(
    form: Annotated[OAuth2PasswordRequestForm, Depends()], c: Annotated[Container, Depends(get_container)]
) -> TokenResponse:
    hashed = await c.users.get(form.username)
    if not hashed or not verify_password(form.password, hashed):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "credenciales inválidas")
    return TokenResponse(access_token=c.tokens.create(form.username))
