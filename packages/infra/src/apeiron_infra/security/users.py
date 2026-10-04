"""Repositorio de usuarios tras un puerto; SQLite para despliegue, memoria para tests."""

from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path
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


class SqliteUserRepository:
    def __init__(self, path: str) -> None:
        self._path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS users ("
                "username TEXT PRIMARY KEY, "
                "password_hash TEXT NOT NULL)"
            )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    async def get(self, username: str) -> str | None:
        def query() -> str | None:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT password_hash FROM users WHERE username = ?", (username,)
                ).fetchone()
            return str(row[0]) if row else None

        return await asyncio.to_thread(query)

    async def add(self, username: str, password_hash: str) -> bool:
        def insert() -> bool:
            try:
                with self._connect() as conn:
                    conn.execute(
                        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                        (username, password_hash),
                    )
                    conn.commit()
                return True
            except sqlite3.IntegrityError:
                return False

        return await asyncio.to_thread(insert)
