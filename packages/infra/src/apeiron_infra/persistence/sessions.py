"""Durabilidad de las sesiones deliberativas (ADR-013, fase 5): diario SQLite y checkpointer de LangGraph.

- `SqliteSessionJournal`: dueño, configuración, estado público, uso y cronología numerada de cada sesión. SQLite de
  la biblioteca estándar en un hilo (`asyncio.to_thread`), WAL, una conexión por operación. Nunca guarda tokens.
- `open_sqlite_checkpointer`: `AsyncSqliteSaver` (extra `sessions` = `langgraph-checkpoint-sqlite`) en otro fichero,
  para que el estado del grafo (turnos, interrupciones pendientes) también sobreviva a un reinicio.

Ambos viven en el volumen `api-data` (`/app/data`), como `users.db`. Es durabilidad de una instancia: con varias
réplicas hace falta un almacén compartido (Postgres) detrás del mismo puerto.
"""

import asyncio
import json
import sqlite3
from collections.abc import Awaitable, Callable, Sequence
from pathlib import Path
from typing import Any

from apeiron_core.application.ports.outbound.sessions import SessionRecord, StoredEvent

OPEN = ("running", "waiting", "closing")
_SCHEMA = """
create table if not exists deliberation_sessions (
  id            text primary key,
  owner         text not null,
  trace_id      text not null,
  config        text not null,
  status        text not null,
  reason        text,
  created_at    real not null,
  updated_at    real not null,
  deadline      real,
  hard_deadline real,
  usage         text not null default '{}'
);
create index if not exists deliberation_sessions_owner on deliberation_sessions (owner, status);
create table if not exists deliberation_events (
  session_id text not null references deliberation_sessions (id) on delete cascade,
  seq        integer not null,
  t          integer not null,
  type       text not null,
  data       text not null,
  primary key (session_id, seq)
);
"""


class SqliteSessionJournal:
    def __init__(self, path: str) -> None:
        self._path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute("pragma journal_mode = wal")
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, timeout=10)
        conn.execute("pragma foreign_keys = on")
        conn.row_factory = sqlite3.Row
        return conn

    async def _run[T](self, work: Callable[[sqlite3.Connection], T]) -> T:
        def task() -> T:
            with self._connect() as conn:  # commit al salir del bloque
                return work(conn)

        return await asyncio.to_thread(task)

    async def save(self, record: SessionRecord) -> None:
        row = {
            **record,
            "config": json.dumps(record["config"], ensure_ascii=False),
            "usage": json.dumps(record["usage"]),
        }
        columns = ", ".join(row)
        updates = ", ".join(f"{k} = excluded.{k}" for k in row if k not in ("id", "owner", "created_at"))
        sql = (
            f"insert into deliberation_sessions ({columns}) values ({', '.join(':' + k for k in row)}) "
            f"on conflict (id) do update set {updates}"
        )
        await self._run(lambda conn: conn.execute(sql, row))

    async def append(self, session_id: str, events: Sequence[StoredEvent]) -> None:
        rows = [(session_id, e.seq, e.t, e.type, json.dumps(e.data, ensure_ascii=False)) for e in events]
        # `or ignore`: reintentar un lote ya escrito no duplica eventos.
        await self._run(
            lambda conn: conn.executemany(
                "insert or ignore into deliberation_events (session_id, seq, t, type, data) values (?, ?, ?, ?, ?)",
                rows,
            )
        )

    async def load(self, session_id: str) -> tuple[SessionRecord, list[StoredEvent]] | None:
        def query(conn: sqlite3.Connection) -> tuple[SessionRecord, list[StoredEvent]] | None:
            row = conn.execute("select * from deliberation_sessions where id = ?", (session_id,)).fetchone()
            if row is None:
                return None
            events = conn.execute(
                "select seq, t, type, data from deliberation_events where session_id = ? order by seq", (session_id,)
            ).fetchall()
            return _record(row), [StoredEvent(e["seq"], e["t"], e["type"], json.loads(e["data"])) for e in events]

        return await self._run(query)

    async def list_open(self, owner: str) -> list[SessionRecord]:
        marks = ", ".join("?" for _ in OPEN)
        rows = await self._run(
            lambda conn: conn.execute(
                f"select * from deliberation_sessions where owner = ? and status in ({marks}) "
                "order by created_at desc",
                (owner, *OPEN),
            ).fetchall()
        )
        return [_record(row) for row in rows]

    async def prune(self, updated_before: float) -> list[str]:
        def delete(conn: sqlite3.Connection) -> list[str]:
            ids = [r["id"] for r in conn.execute(
                "select id from deliberation_sessions where updated_at < ?", (updated_before,)
            ).fetchall()]
            conn.executemany("delete from deliberation_sessions where id = ?", [(i,) for i in ids])
            return ids

        return await self._run(delete)


def _record(row: sqlite3.Row) -> SessionRecord:
    return {
        "id": row["id"],
        "owner": row["owner"],
        "trace_id": row["trace_id"],
        "config": json.loads(row["config"]),
        "status": row["status"],
        "reason": row["reason"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "deadline": row["deadline"],
        "hard_deadline": row["hard_deadline"],
        "usage": json.loads(row["usage"]),
    }


async def open_sqlite_checkpointer(path: str) -> tuple[Any, Callable[[], Awaitable[None]]]:
    """Checkpointer persistente de LangGraph y la función que cierra su conexión (al parar la API)."""
    import aiosqlite  # import diferido: extra [sessions]
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = await aiosqlite.connect(path)
    saver = AsyncSqliteSaver(conn)
    await saver.setup()
    return saver, conn.close
