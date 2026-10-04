"""JWT (HS256) y hashing de contraseñas con bcrypt. Admite un secreto previo para rotación."""

from datetime import UTC, datetime, timedelta

import bcrypt
import jwt


class InvalidTokenError(Exception):
    pass


class TokenService:
    def __init__(
        self,
        secret: str,
        ttl_minutes: int = 60,
        algorithm: str = "HS256",
        previous_secret: str | None = None,
    ) -> None:
        self._secret, self._ttl, self._alg = secret, ttl_minutes, algorithm
        self._previous = previous_secret

    def create(self, subject: str) -> str:
        now = datetime.now(UTC)
        payload = {"sub": subject, "iat": now, "exp": now + timedelta(minutes=self._ttl)}
        return jwt.encode(payload, self._secret, algorithm=self._alg)

    def decode(self, token: str) -> str:
        secrets = [self._secret]
        if self._previous:
            secrets.append(self._previous)
        last_error: Exception | None = None
        for secret in secrets:
            try:
                claims = jwt.decode(token, secret, algorithms=[self._alg])
            except jwt.PyJWTError as exc:
                last_error = exc
                continue
            sub = claims.get("sub")
            if not isinstance(sub, str):
                raise InvalidTokenError("missing sub")
            return sub
        raise InvalidTokenError(str(last_error) if last_error else "invalid token") from last_error


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())
