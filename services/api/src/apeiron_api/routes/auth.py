from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from apeiron_api.container import Container
from apeiron_api.deps import enforce_auth_rate, get_container
from apeiron_api.schemas import Credentials, TokenResponse
from apeiron_infra.security.tokens import TokenService, hash_password, verify_password

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.get("/config")
async def auth_config(c: Annotated[Container, Depends(get_container)]) -> dict[str, Any]:
    """Configuración pública para el cliente; la publishable key de Supabase es pública."""
    s = c.settings
    config: dict[str, Any] = {
        "provider": s.auth_provider,
        "public_register": s.public_register,
        "runs_enabled": c.runs is not None,
    }
    if s.auth_provider == "supabase":
        config["supabase_url"] = s.supabase_url
        config["supabase_key"] = s.supabase_publishable_key
    return config


def _local_only(c: Container) -> None:
    if c.settings.auth_provider != "local":
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "autenticación gestionada por Supabase Auth"
        )


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: Credentials,
    c: Annotated[Container, Depends(get_container)],
    _: Annotated[None, Depends(enforce_auth_rate)],
) -> dict[str, str]:
    _local_only(c)
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
    _local_only(c)
    hashed = await c.users.get(form.username)
    if not hashed or not verify_password(form.password, hashed):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "credenciales inválidas")
    if not isinstance(c.tokens, TokenService):  # garantizado por _local_only
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "auth mal configurada")
    return TokenResponse(access_token=c.tokens.create(form.username))
