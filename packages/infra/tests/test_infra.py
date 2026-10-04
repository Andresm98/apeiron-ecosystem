import httpx
import pytest

from apeiron_core.application.context import RequestContext, request_ctx
from apeiron_infra.llm.langchain_llm import LangChainLLM
from apeiron_infra.llm.resilient import ResilientLLM
from apeiron_infra.memory.vector import InMemoryVectorStore, seed_global
from apeiron_infra.resilience import CircuitBreaker, CircuitOpenError, call_with_retry
from apeiron_infra.security.tokens import (
    InvalidTokenError,
    TokenService,
    hash_password,
    verify_password,
)
from apeiron_infra.tools.formal_logic import FormalLogicCalculator, evaluate
from apeiron_infra.tools.public_api import ArxivClient, McpPublicApiTool
from apeiron_infra.tools.vector_memory import VectorMemoryRetriever


class Flaky:
    def __init__(self, fail_times: int) -> None:
        self.fail, self.calls = fail_times, 0

    async def complete(self, system: str, user: str) -> str:
        self.calls += 1
        if self.calls <= self.fail:
            raise ConnectionError("boom")
        return "ok"


class Const:
    async def complete(self, system: str, user: str) -> str:
        return "fallback"


async def test_retry_recovers_after_transient_failures():
    llm = Flaky(2)
    out = await call_with_retry(
        lambda: llm.complete("", ""), attempts=3, base_delay_s=0.001
    )
    assert out == "ok" and llm.calls == 3


async def test_timeout_triggers_failure():
    import asyncio

    async def slow() -> str:
        await asyncio.sleep(1)
        return "x"

    with pytest.raises(TimeoutError):
        await call_with_retry(slow, attempts=1, timeout_s=0.01)


async def test_breaker_opens_then_half_open_recovers():
    now = [0.0]
    br = CircuitBreaker(
        failure_threshold=2, recovery_timeout_s=10, clock=lambda: now[0]
    )
    llm = Flaky(99)
    for _ in range(2):
        with pytest.raises(ConnectionError):
            await br.call(lambda: llm.complete("", ""))
    assert br.state == "open"
    with pytest.raises(CircuitOpenError):
        await br.call(lambda: llm.complete("", ""))
    now[0] = 11
    assert br.state == "half_open"
    llm.fail = 0
    assert await br.call(lambda: llm.complete("", "")) == "ok" and br.state == "closed"


async def test_resilient_llm_uses_fallback_when_primary_dies():
    r = ResilientLLM(
        Flaky(99),
        Const(),
        CircuitBreaker(failure_threshold=1),
        attempts=2,
        base_delay_s=0.001,
    )
    assert await r.complete("s", "u") == "fallback"
    assert (
        await r.complete("s", "u") == "fallback"
    )  # circuito abierto -> directo a fallback


def test_formal_logic_validity_and_tables():
    assert "VÁLIDO" in evaluate("P -> Q, P |- Q")  # modus ponens
    assert "INVÁLIDO" in evaluate("P -> Q, Q |- P")  # afirmación del consecuente
    assert "tautología" in evaluate("P | ~P")
    assert "contradicción" in evaluate("P & ~P")
    assert "VÁLIDO" in evaluate("P → Q, ¬Q ⊢ ¬P")  # modus tollens con símbolos


async def test_formal_logic_tool_reports_syntax_errors():
    assert (await FormalLogicCalculator().run("P ->")).startswith("Sintaxis inválida")


ATOM = """<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/1</id>
<title>Chaos in   three-body</title><published>2026-09-01T00:00:00Z</published>
<summary>Resumen   largo</summary></entry></feed>"""


async def test_public_api_tool_parses_arxiv_and_degrades_on_failure():
    ok = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, text=ATOM))
    )
    assert "Chaos in three-body" in await McpPublicApiTool(ArxivClient(ok)).run(
        "three body"
    )
    bad = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(503))
    )
    out = await McpPublicApiTool(ArxivClient(bad)).run("x")
    assert "no disponible" in out


async def test_vector_memory_is_scoped_per_user():
    store = InMemoryVectorStore()
    await seed_global(store)
    await store.add("ana", ["Q: ápeiron favorito\nA: mi secreto personal ana"])
    tool = VectorMemoryRetriever(store)
    request_ctx.set(RequestContext(user_id="ana"))
    assert "secreto personal" in await tool.run("secreto personal ápeiron")
    request_ctx.set(RequestContext(user_id="bob"))
    assert "secreto personal" not in await tool.run("secreto personal ápeiron")
    assert "ilimitado" in await tool.run("Anaximandro ápeiron ilimitado")


def test_jwt_and_passwords():
    ts = TokenService("s3cret" * 8, ttl_minutes=1)
    assert ts.decode(ts.create("santiago")) == "santiago"
    with pytest.raises(InvalidTokenError):
        TokenService("otra" * 10).decode(ts.create("x"))
    h = hash_password("clave-larga-123")
    assert verify_password("clave-larga-123", h) and not verify_password("mala", h)


async def test_langchain_adapter_with_stub_model(caplog):
    class Msg:
        content = [{"type": "text", "text": "hola"}]
        usage_metadata = {"input_tokens": 3, "output_tokens": 1}

    class Chat:
        async def ainvoke(self, messages):
            return Msg()

    caplog.set_level("INFO", logger="apeiron.llm")
    assert await LangChainLLM("m", "p", chat_model=Chat()).complete("s", "u") == "hola"
    assert caplog.records[0].token_usage == {"input_tokens": 3, "output_tokens": 1}


class FakeChromaCollection:
    def __init__(self) -> None:
        self.docs: list[dict] = []

    def upsert(self, ids: list[str], documents: list[str], metadatas: list[dict]) -> None:
        for doc_id, doc, meta in zip(ids, documents, metadatas, strict=False):
            self.docs = [d for d in self.docs if d["id"] != doc_id]
            self.docs.append({"id": doc_id, "document": doc, "metadata": meta})

    def query(self, query_texts: list[str], n_results: int, where: dict) -> dict:
        allowed = where.get("user_id", {}).get("$in", [])
        matched = [d for d in self.docs if d["metadata"].get("user_id") in allowed]
        return {
            "documents": [[d["document"] for d in matched]],
            "distances": [[0.1 * i for i in range(len(matched))]],
            "metadatas": [[d["metadata"] for d in matched]],
        }

    def get(self, where: dict = None, include: list[str] = None) -> dict:
        where = where or {}
        user_id = where.get("user_id")
        if isinstance(user_id, dict):
            allowed = user_id.get("$in", [])
            matched = [d for d in self.docs if d["metadata"].get("user_id") in allowed]
        elif user_id:
            matched = [d for d in self.docs if d["metadata"].get("user_id") == user_id]
        else:
            matched = list(self.docs)
        return {
            "ids": [d["id"] for d in matched],
            "documents": [d["document"] for d in matched],
            "metadatas": [d["metadata"] for d in matched],
        }

    def delete(self, ids: list[str] = None, where: dict = None) -> None:
        if ids:
            self.docs = [d for d in self.docs if d["id"] not in ids]
        elif where and "user_id" in where:
            uid = where["user_id"]
            self.docs = [d for d in self.docs if d["metadata"].get("user_id") != uid]


class FakeChromaClient:
    def __init__(self, col: FakeChromaCollection) -> None:
        self.col = col

    def get_or_create_collection(self, name: str) -> FakeChromaCollection:
        return self.col


async def test_chroma_vector_store_isolation_retention_and_delete():
    from apeiron_infra.memory.vector import ChromaVectorStore

    fake_col = FakeChromaCollection()
    client = FakeChromaClient(fake_col)
    store = ChromaVectorStore("host", 8000, max_docs_per_user=2, client=client)

    await store.add("ana", ["doc1", "doc2", "doc3"])
    assert len(fake_col.get(where={"user_id": "ana"})["ids"]) == 2

    res_ana = await store.search("ana", "doc", k=3)
    assert any("[source=user]" in r for r in res_ana)

    res_bob = await store.search("bob", "doc", k=3)
    assert not any("[source=user]" in r for r in res_bob)

    await store.delete("ana")
    assert len(fake_col.get(where={"user_id": "ana"})["ids"]) == 0


async def test_circuit_breaker_half_open_concurrent_probe_lock():
    import asyncio

    now = [0.0]
    br = CircuitBreaker(failure_threshold=1, recovery_timeout_s=10, clock=lambda: now[0])

    with pytest.raises(RuntimeError):
        await br.call(lambda: (_ for _ in ()).throw(RuntimeError("fail")))

    assert br.state == "open"
    now[0] = 11
    assert br.state == "half_open"

    probe_started = asyncio.Event()

    async def slow_probe():
        probe_started.set()
        await asyncio.sleep(0.1)
        return "ok"

    task1 = asyncio.create_task(br.call(slow_probe))
    await probe_started.wait()

    with pytest.raises(CircuitOpenError) as exc_info:
        await br.call(lambda: asyncio.sleep(0))
    assert "probe in flight" in str(exc_info.value)

    res = await task1
    assert res == "ok" and br.state == "closed"


async def test_sqlite_user_repository(tmp_path):
    from apeiron_infra.security.users import SqliteUserRepository

    db = str(tmp_path / "test_users.db")
    repo = SqliteUserRepository(db)
    assert await repo.add("ana", "hash123") is True
    assert await repo.add("ana", "hash456") is False
    assert await repo.get("ana") == "hash123"

    repo2 = SqliteUserRepository(db)
    assert await repo2.get("ana") == "hash123"


def test_json_formatter_normalizes_empty_token_usage():
    import json
    import logging

    from apeiron_infra.observability.logging import JsonFormatter

    formatter = JsonFormatter()
    record = logging.LogRecord("test", logging.INFO, "path", 1, "msg", (), None)
    record.token_usage = {}
    formatted = json.loads(formatter.format(record))
    assert formatted["token_usage"] is None

