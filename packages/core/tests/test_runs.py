from dataclasses import replace

import pytest

from apeiron_core.application.agents.react import ReActAgent
from apeiron_core.application.context import request_ctx
from apeiron_core.application.orchestration.graph import build_graph
from apeiron_core.application.use_cases.chat import ApeironFacade


class StubLLM:
    async def complete(self, system: str, user: str) -> str:
        return "respuesta breve"


class MemoryRuns:
    def __init__(self, fail: bool = False) -> None:
        self.saved: list[dict] = []
        self.fail = fail

    async def save(self, run) -> None:
        if self.fail:
            raise RuntimeError("supabase caído")
        self.saved.append(dict(run))

    async def list_recent(self, limit: int = 20):
        return self.saved[:limit]

    async def get(self, run_id: str):
        return None


class BrokenGraph:
    async def astream(self, *args, **kwargs):
        raise RuntimeError("grafo roto")
        yield  # pragma: no cover

    async def ainvoke(self, *args, **kwargs):
        raise RuntimeError("grafo roto")


def graph():
    llm = StubLLM()
    return build_graph({"anaximandro": ReActAgent("anaximandro", "persona", llm)}, llm)


@pytest.fixture
def user_ctx():
    token = request_ctx.set(replace(request_ctx.get(), user_id="u-1", trace_id="t-1"))
    yield
    request_ctx.reset(token)


async def test_stream_persists_completed_run(user_ctx):
    runs = MemoryRuns()
    facade = ApeironFacade(graph(), runs=runs, model_label="openai:gpt")
    events = [e async for e in facade.stream("¿Qué es el ápeiron?", "single", None)]
    assert events[-1].type == "answer"
    [run] = runs.saved
    assert run["user_id"] == "u-1" and run["trace_id"] == "t-1"
    assert run["status"] == "completed" and run["answer"] == "respuesta breve"
    assert run["mode"] == "single" and run["model"] == "openai:gpt"
    assert [t["agent"] for t in run["turns"]] == ["anaximandro"]
    assert run["trace"][0] == "[Ápeiron Routing]" and run["usage"]["calls"] == 0


async def test_ask_persists_and_marks_simulation(user_ctx):
    runs = MemoryRuns()
    await ApeironFacade(graph(), runs=runs, model_label="openai:gpt").ask("q", "single", None, True)
    assert runs.saved[0]["simulate"] is True and runs.saved[0]["model"] == "simulation"


async def test_graph_failure_is_recorded_and_reraised(user_ctx):
    runs = MemoryRuns()
    facade = ApeironFacade(BrokenGraph(), runs=runs)
    with pytest.raises(RuntimeError):
        [e async for e in facade.stream("q", None, None)]
    assert runs.saved[0]["status"] == "error" and runs.saved[0]["error"] == "RuntimeError"


async def test_persistence_failure_never_breaks_chat(user_ctx):
    facade = ApeironFacade(graph(), runs=MemoryRuns(fail=True))
    events = [e async for e in facade.stream("q", "single", None)]
    assert events[-1].data["answer"] == "respuesta breve"
