"""JWT (HS256) y hashing de contraseñas con bcrypt."""
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt


class InvalidTokenError(Exception):
    pass


class TokenService:
    def __init__(self, secret: str, ttl_minutes: int = 60, algorithm: str = "HS256") -> None:
        self._secret, self._ttl, self._alg = secret, ttl_minutes, algorithm

    def create(self, subject: str) -> str:
        now = datetime.now(UTC)
        payload = {"sub": subject, "iat": now, "exp": now + timedelta(minutes=self._ttl)}
        return jwt.encode(payload, self._secret, algorithm=self._alg)

    def decode(self, token: str) -> str:
        try:
            claims = jwt.decode(token, self._secret, algorithms=[self._alg])
        except jwt.PyJWTError as exc:
            raise InvalidTokenError(str(exc)) from exc
        sub = claims.get("sub")
        if not isinstance(sub, str):
            raise InvalidTokenError("missing sub")
        return sub


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())
