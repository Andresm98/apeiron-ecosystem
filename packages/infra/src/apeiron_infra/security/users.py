"""Repositorio de usuarios tras un puerto; la versión en memoria es solo para dev/test."""
from typing import Protocol


class UserRepository(Protocol):
    async def get(self, username: str) -> str | None: ...  # devuelve password_hash

    async def add(self, username: str, password_hash: str) -> bool: ...  # False si ya existe


class InMemoryUserRepository:
    def __init__(self) -> None:
        self._users: dict[str, str] = {}

    async def get(self, username: str) -> str | None:
        return self._users.get(username)

    async def add(self, username: str, password_hash: str) -> bool:
        if username in self._users:
            return False
        self._users[username] = password_hash
        return True
