"""Diario SQLite de sesiones (ADR-013, fase 5): ida y vuelta, idempotencia, sesiones abiertas y poda."""

import time

from apeiron_core.application.ports.outbound.sessions import SessionRecord, StoredEvent
from apeiron_infra.persistence.sessions import SqliteSessionJournal, open_sqlite_checkpointer


def record(session_id: str, owner: str = "u-1", status: str = "waiting", updated: float | None = None) -> SessionRecord:
    now = time.time()
    return {
        "id": session_id,
        "owner": owner,
        "trace_id": "t-1",
        "config": {"question": "¿Todo fluye?", "participants": ["heraclito", "human"], "pace": "step"},
        "status": status,
        "reason": None,
        "created_at": now,
        "updated_at": updated if updated is not None else now,
        "deadline": None,
        "hard_deadline": now + 1800,
        "usage": {"calls": 2, "by_agent": {"heraclito": {"calls": 2, "input_tokens": 9, "output_tokens": 3}}},
    }


async def test_journal_round_trip_is_ordered_and_idempotent(tmp_path):
    journal = SqliteSessionJournal(str(tmp_path / "data" / "sessions.db"))
    await journal.save(record("s1"))
    events = [StoredEvent(i, i * 10, "trace", {"messages": [f"m{i}"]}) for i in (2, 1, 3)]
    await journal.append("s1", events)
    await journal.append("s1", events[:1])  # reintento de un lote: no duplica
    await journal.save({**record("s1"), "status": "completed", "reason": "closed_by_user"})

    loaded = await journal.load("s1")
    assert loaded is not None
    saved, stored = loaded
    assert saved["status"] == "completed" and saved["reason"] == "closed_by_user"
    assert saved["config"]["participants"] == ["heraclito", "human"] and saved["usage"]["by_agent"]["heraclito"]
    assert [e.seq for e in stored] == [1, 2, 3] and stored[0].data == {"messages": ["m1"]} and stored[2].t == 30
    assert await journal.load("nope") is None


async def test_open_sessions_are_per_owner_and_old_ones_are_pruned(tmp_path):
    journal = SqliteSessionJournal(str(tmp_path / "sessions.db"))
    await journal.save(record("mine"))
    await journal.save(record("done", status="completed"))
    await journal.save(record("theirs", owner="u-2"))
    await journal.save(record("old", updated=time.time() - 10_000))
    await journal.append("old", [StoredEvent(1, 0, "trace", {"messages": []})])
    assert sorted(r["id"] for r in await journal.list_open("u-1")) == ["mine", "old"]

    assert await journal.prune(time.time() - 5_000) == ["old"]
    assert await journal.load("old") is None  # sus eventos se borran en cascada
    assert [r["id"] for r in await journal.list_open("u-1")] == ["mine"]


async def test_sqlite_checkpointer_opens_and_closes(tmp_path):
    saver, close = await open_sqlite_checkpointer(str(tmp_path / "cp" / "checkpoints.db"))
    try:
        assert hasattr(saver, "aget_tuple") and (tmp_path / "cp" / "checkpoints.db").exists()
    finally:
        await close()
