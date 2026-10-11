from dataclasses import replace

import pytest

from apeiron_core.application.agents.react import ReActAgent
from apeiron_core.application.context import request_ctx
from apeiron_core.application.conversations import (
    CONTEXT_HEADER,
    MAX_CONTEXT_CHARS,
    InMemoryConversations,
    context_block,
)
from apeiron_core.application.orchestration.graph import build_graph
from apeiron_core.application.use_cases.chat import ApeironFacade


class RecordingLLM:
    """Responde con un texto fijo y guarda cada prompt de usuario que recibe."""

    def __init__(self, answer: str = "respuesta breve") -> None:
        self.answer = answer
        self.prompts: list[str] = []

    async def complete(self, system: str, user: str) -> str:
        self.prompts.append(user)
        return self.answer


class MemoryRuns:
    def __init__(self) -> None:
        self.saved: list[dict] = []

    async def save(self, run) -> None:
        self.saved.append(dict(run))


class BrokenConversations:
    async def exchanges(self, conversation_id: str, limit: int = 6):
        raise RuntimeError("supabase caído")

    async def append(self, conversation_id, exchange) -> None:
        raise RuntimeError("supabase caído")


@pytest.fixture
def user_ctx():
    token = request_ctx.set(replace(request_ctx.get(), user_id="u-1", trace_id="t-1"))
    yield
    request_ctx.reset(token)


def _graph(llm: RecordingLLM, names=("anaximandro", "heraclito", "feynman")):
    agents = {name: ReActAgent(name, f"Eres {name}", llm) for name in names}
    return build_graph(agents, llm, debate_participants=list(names[:2]))


def test_context_block_is_bounded_and_skips_empty_answers():
    exchanges = [{"question": f"pregunta {i}", "answer": "a" * 2000, "mode": "single"} for i in range(10)]
    exchanges.append({"question": "bloqueada", "answer": "", "mode": "single"})
    block = context_block(exchanges)
    assert block.startswith(CONTEXT_HEADER)
    assert "bloqueada" not in block and "pregunta 3" not in block  # solo los últimos intercambios
    assert len(block) <= MAX_CONTEXT_CHARS + len(CONTEXT_HEADER) + 1
    assert context_block([]) == ""


async def test_in_memory_conversations_isolate_users_and_stay_bounded(user_ctx):
    store = InMemoryConversations(max_conversations=2, max_exchanges=2)
    for i in range(3):
        await store.append("c-1", {"question": f"q{i}", "answer": f"a{i}", "mode": "single"})
    assert [e["question"] for e in await store.exchanges("c-1")] == ["q1", "q2"]
    other = request_ctx.set(replace(request_ctx.get(), user_id="u-2"))
    try:
        assert await store.exchanges("c-1") == []  # la conversación de otro usuario no existe
    finally:
        request_ctx.reset(other)
    await store.append("c-2", {"question": "x", "answer": "y", "mode": "single"})
    await store.append("c-3", {"question": "x", "answer": "y", "mode": "single"})
    assert await store.exchanges("c-1") == []  # LRU: la más antigua se descarta


async def test_follow_up_question_sees_previous_exchange(user_ctx):
    llm = RecordingLLM("El ápeiron es lo indeterminado.")
    runs = MemoryRuns()
    facade = ApeironFacade(_graph(llm), runs=runs, conversations=InMemoryConversations())
    await facade.ask("¿Qué es el ápeiron?", "single", None, agent="anaximandro", conversation_id="c-1")
    llm.prompts.clear()
    await facade.ask("¿Y cómo se relaciona con el fuego?", "single", None, agent="heraclito", conversation_id="c-1")
    [prompt] = llm.prompts
    assert prompt.startswith("¿Y cómo se relaciona con el fuego?")  # la pregunta actual va primero
    assert CONTEXT_HEADER in prompt and "Usuario: ¿Qué es el ápeiron?" in prompt
    assert "Ápeiron: El ápeiron es lo indeterminado." in prompt
    assert [r["conversation_id"] for r in runs.saved] == ["c-1", "c-1"]


async def test_without_conversation_there_is_no_context(user_ctx):
    llm = RecordingLLM()
    facade = ApeironFacade(_graph(llm), conversations=InMemoryConversations())
    await facade.ask("primera", "single", None, agent="anaximandro")
    await facade.ask("segunda", "single", None, agent="anaximandro")
    assert all(CONTEXT_HEADER not in prompt for prompt in llm.prompts)


async def test_conversation_failure_degrades_to_a_plain_question(user_ctx):
    llm = RecordingLLM()
    facade = ApeironFacade(_graph(llm), conversations=BrokenConversations())
    out = await facade.ask("pregunta", "single", None, agent="anaximandro", conversation_id="c-1")
    assert out["answer"] == "respuesta breve"
    assert facade.metrics.snapshot()["failures"]["conversation_load_failed"] == 1


async def test_participants_choose_the_table_and_its_order(user_ctx):
    llm = RecordingLLM()
    facade = ApeironFacade(_graph(llm))
    out = await facade.ask("¿Es el tiempo real?", None, 1, participants=["feynman", "anaximandro", "heraclito"])
    assert out["mode"] == "debate"
    assert [t["agent"] for t in out["turns"]] == ["feynman", "anaximandro", "heraclito"]
