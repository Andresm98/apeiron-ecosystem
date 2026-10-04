"""Verificación de access tokens emitidos por Supabase Auth.

- Claves asimétricas (por defecto en proyectos nuevos): JWKS público en
  `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, cacheado en memoria.
- Proyectos con secreto compartido (legacy): HS256 con `SUPABASE_JWT_SECRET`.

Se exige `aud=authenticated` y el `iss` del proyecto. Llamada síncrona: el adaptador de
entrada la ejecuta fuera del event loop (la primera vez descarga el JWKS).
"""

from typing import Any

import jwt

from apeiron_infra.security.tokens import InvalidTokenError

ASYMMETRIC_ALGS = ["ES256", "RS256", "EdDSA"]


class SupabaseTokenVerifier:
    def __init__(
        self,
        supabase_url: str,
        jwt_secret: str | None = None,
        audience: str = "authenticated",
        jwk_client: Any = None,  # inyectable para pruebas
    ) -> None:
        base = supabase_url.rstrip("/")
        self._issuer = f"{base}/auth/v1"
        self._audience = audience
        self._secret = jwt_secret
        self._jwks: Any = jwk_client or (
            None
            if jwt_secret
            else jwt.PyJWKClient(f"{self._issuer}/.well-known/jwks.json", lifespan=3600)
        )

    def decode(self, token: str) -> str:
        """Devuelve el `sub` (UUID del usuario en Supabase) o lanza InvalidTokenError."""
        try:
            if self._secret:
                key: Any = self._secret
                algorithms = ["HS256"]
            else:
                key = self._jwks.get_signing_key_from_jwt(token).key
                algorithms = ASYMMETRIC_ALGS
            claims = jwt.decode(
                token,
                key,
                algorithms=algorithms,
                audience=self._audience,
                issuer=self._issuer,
                options={"require": ["exp", "sub"]},
            )
        except (jwt.PyJWTError, jwt.PyJWKClientError) as exc:
            raise InvalidTokenError(str(exc)) from exc
        sub = claims.get("sub")
        if not isinstance(sub, str) or not sub:
            raise InvalidTokenError("missing sub")
        return sub
