from collections.abc import Mapping

import pytest

from apeiron_core.application.agents.factories import (
    AnaximandroFactory,
    HeraclitoFactory,
)
from apeiron_core.application.agents.react import ReActAgent
from apeiron_core.application.agents.registry import AgentRegistry
from apeiron_core.application.orchestration.graph import build_graph
from apeiron_core.application.ports.outbound.tools import ToolPort
from apeiron_core.application.use_cases.chat import ApeironFacade
from apeiron_core.domain.services.routing import decide_agent, decide_mode


class StubLLM:
    async def complete(self, system: str, user: str) -> str:
        return f"STUB {system[:12]}"


class ScriptedLLM:
    def __init__(self, outputs: list[str]) -> None:
        self.outputs, self.prompts = outputs, []

    async def complete(self, system: str, user: str) -> str:
        self.prompts.append(user)
        return self.outputs.pop(0)


class EchoTool:
    name, description = "formal_logic_calculator", "verifica lógica"

    async def run(self, tool_input: str) -> str:
        return f"VALID({tool_input})"


class FailingAgent:
    async def respond(self, question, history, emit=None):
        raise RuntimeError("provider unavailable")


class RespondingAgent:
    async def respond(self, question, history, emit=None):
        return "La observación disponible es X."


class FailingLLM:
    async def complete(self, system: str, user: str) -> str:
        raise RuntimeError("synthesis unavailable")


def make_graph(tools: Mapping[str, ToolPort] | None = None):
    llm = StubLLM()
    reg = AgentRegistry()
    reg.register(AnaximandroFactory())
    reg.register(HeraclitoFactory())
    return build_graph(reg.build_all(llm, tools), llm)


def test_domain_routing_selects_interaction_mode():
    assert decide_mode("¿Qué es el ápeiron?") == "single"
    assert decide_mode("Debate: ¿qué explica mejor el cosmos?") == "debate"
    assert (
        decide_agent(
            "¿Qué diría Heráclito sobre el logos?",
            ["anaximandro", "heraclito"],
            "anaximandro",
        )
        == "heraclito"
    )
    assert (
        decide_agent("¿Qué diría Heráclito?", ["anaximandro"], "anaximandro")
        == "anaximandro"
    )


async def test_single_routes_to_default_agent():
    out = await make_graph().ainvoke({"question": "¿Qué es el ápeiron?"})
    assert out["mode"] == "single" and [t["agent"] for t in out["turns"]] == [
        "anaximandro"
    ]


async def test_single_intent_routing_selects_enabled_specialist():
    out = await make_graph().ainvoke(
        {"question": "¿Qué diría Heráclito sobre el logos?"}
    )
    assert [turn["agent"] for turn in out["turns"]] == ["heraclito"]


async def test_debate_two_agents_two_rounds_then_synthesis():
    out = await make_graph().ainvoke({"question": "Debate: entrelazamiento y monismo"})
    assert len(out["turns"]) == 4 and out["trace"][-1] == "[Synthesis]"
    assert {t["agent"] for t in out["turns"]} == {"anaximandro", "heraclito"}


async def test_failed_specialist_is_degraded_without_blocking_debate():
    graph = build_graph(
        {"healthy": RespondingAgent(), "broken": FailingAgent()}, StubLLM()
    )
    out = await graph.ainvoke(
        {"question": "Debate: evidencia", "mode": "debate", "max_rounds": 1}
    )
    by_agent = {turn["agent"]: turn for turn in out["turns"]}
    assert by_agent["healthy"]["text"] == "La observación disponible es X."
    assert by_agent["broken"]["degraded"] is True
    assert out["answer"].startswith("STUB")


async def test_failed_synthesis_uses_completed_turns_deterministically():
    graph = build_graph({"healthy": RespondingAgent()}, FailingLLM())
    out = await graph.ainvoke(
        {"question": "Debate: evidencia", "mode": "debate", "max_rounds": 1}
    )
    assert "Síntesis degradada" in out["answer"]
    assert "healthy: La observación disponible es X." in out["answer"]


async def test_debate_uses_only_configured_participants():
    graph = build_graph(
        {"first": RespondingAgent(), "second": RespondingAgent()},
        StubLLM(),
        debate_participants=["second"],
    )
    out = await graph.ainvoke(
        {"question": "Debate: evidencia", "mode": "debate", "max_rounds": 1}
    )
    assert [turn["agent"] for turn in out["turns"]] == ["second"]


def test_graph_rejects_unbounded_rounds_and_unknown_participants():
    agents = {"known": RespondingAgent()}
    with pytest.raises(ValueError, match="default_rounds"):
        build_graph(agents, StubLLM(), default_rounds=5)
    with pytest.raises(ValueError, match="debate_participants"):
        build_graph(agents, StubLLM(), debate_participants=["unknown"])


async def test_react_tool_cycle_with_reflection_and_events():
    llm = ScriptedLLM(
        [
            "Thought: verifico\nAction: formal_logic_calculator\nAction Input: P->Q, P |- Q",
            "Thought: ok\nReflect: basta\nFinal Answer: Es válido (modus ponens)",
        ]
    )
    events: list[str] = []
    agent = ReActAgent("anaximandro", "persona", llm, [EchoTool()])
    answer = await agent.respond("¿válido?", [], events.append)
    assert answer == "Es válido (modus ponens)"
    assert "Observation: VALID(P->Q, P |- Q)" in llm.prompts[1]
    assert events == [
        "[anaximandro Executing Tool: formal_logic_calculator]",
        "[anaximandro Reflecting]",
    ]


async def test_react_unknown_tool_does_not_crash():
    llm = ScriptedLLM(["Action: nope\nAction Input: x", "Final Answer: listo"])
    assert await ReActAgent("a", "p", llm, [EchoTool()]).respond("q", []) == "listo"
    assert "herramienta desconocida" in llm.prompts[1]


async def test_react_never_returns_unmarked_reasoning_as_answer():
    llm = ScriptedLLM(["Thought: razonamiento privado"])
    answer = await ReActAgent("a", "p", llm, [EchoTool()]).respond("q", [])
    assert "razonamiento privado" not in answer
    assert "respuesta final válida" in answer


async def test_facade_stream_emits_trace_turn_answer():
    facade = ApeironFacade(make_graph({"formal_logic_calculator": EchoTool()}))
    kinds = [e.type async for e in facade.stream("debate: tres cuerpos", None, 1)]
    assert kinds[0] == "trace" and kinds[-1] == "answer" and kinds.count("turn") == 2
