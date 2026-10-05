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
    llm = ScriptedLLM(["Thought: razonamiento privado"] * 4)  # insiste en todos los pasos
    answer = await ReActAgent("a", "p", llm, [EchoTool()]).respond("q", [])
    assert "razonamiento privado" not in answer
    assert "respuesta final válida" in answer
    assert "no entendí tu salida" in llm.prompts[1]  # se le recordó el formato antes de rendirse


async def test_react_recovers_from_a_malformed_output():
    llm = ScriptedLLM(["Pienso que sí, sin formato", "Final Answer: ahora sí"])
    assert await ReActAgent("a", "p", llm, [EchoTool()]).respond("q", []) == "ahora sí"


async def test_failed_worker_is_degraded_and_not_answered_to():
    llm = ScriptedLLM(["sin formato"] * 2 + ["Final Answer: réplica", "síntesis"])
    agents = {
        "first": ReActAgent("first", "p", llm, [EchoTool()], max_steps=2),
        "second": ReActAgent("second", "p", llm, [EchoTool()], max_steps=2),
    }
    out = await build_graph(agents, llm).ainvoke({"question": "Debate: x", "mode": "debate", "max_rounds": 1})
    first, second = out["turns"]
    assert first["degraded"] is True
    assert second["responds_to"] is None  # no se responde a un turno fallido


async def test_facade_stream_emits_trace_turn_answer():
    facade = ApeironFacade(make_graph({"formal_logic_calculator": EchoTool()}))
    kinds = [e.type async for e in facade.stream("debate: tres cuerpos", None, 1)]
    assert kinds[0] == "node" and kinds[-1] == "answer" and kinds.count("turn") == 2
    assert "trace" in kinds


def test_graph_topology_exposes_orchestrator_workers_and_react_subgraphs():
    drawing = make_graph({"formal_logic_calculator": EchoTool()}).get_graph(xray=True)
    nodes = set(drawing.nodes)
    assert {"apeiron_router", "apeiron_supervisor", "apeiron_synthesis"} <= nodes
    assert {"anaximandro:reason", "anaximandro:act", "heraclito:reason"} <= nodes
    assert "heraclito:act" not in nodes  # sus tools no están en el catálogo inyectado


class RecordingLLM:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def complete(self, system: str, user: str) -> str:
        self.calls.append((system, user))
        return f"posición {len(self.calls)}"


async def test_debate_workers_reply_to_each_other_in_turns():
    llm = RecordingLLM()
    reg = AgentRegistry()
    reg.register(AnaximandroFactory())
    reg.register(HeraclitoFactory())
    graph = build_graph(reg.build_all(llm), llm)
    out = await graph.ainvoke({"question": "Debate: el cambio", "max_rounds": 2})
    order = [(t["agent"], t["round"]) for t in out["turns"]]
    assert order == [("anaximandro", 0), ("heraclito", 0), ("anaximandro", 1), ("heraclito", 1)]
    heraclito_r0 = llm.calls[1][1]
    assert "Tu interlocutor" in heraclito_r0 and "anaximandro (ronda 1): posición 1" in heraclito_r0
    assert "heraclito (ronda 1): posición 2" in llm.calls[2][1]
    assert "[Ápeiron Delegating → heraclito r0]" in out["trace"]
    assert out["trace"][-1] == "[Synthesis]" and len(llm.calls) == 5


async def test_facade_stream_reports_inner_nodes_and_usage():
    from apeiron_core.application.usage import record_usage

    class MeteredLLM(ScriptedLLM):
        async def complete(self, system: str, user: str) -> str:
            record_usage(10, 5)
            return await super().complete(system, user)

    llm = MeteredLLM(
        [
            "Thought: verifico\nAction: formal_logic_calculator\nAction Input: P |- P",
            "Final Answer: válido",
        ]
    )
    agent = ReActAgent("anaximandro", "persona", llm, [EchoTool()])
    facade = ApeironFacade(build_graph({"anaximandro": agent}, llm))
    events = [e async for e in facade.stream("¿válido?", "single", None)]
    nodes = {e.data["node"] for e in events if e.type == "node"}
    assert {"apeiron_router", "anaximandro", "anaximandro/reason", "anaximandro/act"} <= nodes
    assert "[anaximandro Executing Tool: formal_logic_calculator]" in [
        m for e in events if e.type == "trace" for m in e.data["messages"]
    ]
    answer = events[-1].data
    assert answer["answer"] == "válido"
    assert answer["usage"] == {"calls": 2, "input_tokens": 20, "output_tokens": 10, "total_tokens": 30}


async def test_remote_agent_factory_uses_the_adapter_or_a_local_stand_in():
    from apeiron_core.application.agents.factories import RemoteAgentFactory

    remote = RespondingAgent()
    reg = AgentRegistry()
    reg.register(AnaximandroFactory())
    reg.register(RemoteAgentFactory("sophos", "Socio remoto.", remote, endpoint="sophos.example.org"))
    described = {a["name"]: a for a in reg.describe()}
    assert described["anaximandro"]["kind"] == "local"
    assert described["sophos"] == {
        "name": "sophos", "role": "Socio remoto.", "tools": [], "kind": "remote", "endpoint": "sophos.example.org"
    }
    assert reg.build_all(StubLLM())["sophos"] is remote
    stand_in = RemoteAgentFactory("sophos", "Socio remoto.").create(StubLLM(), {})
    assert isinstance(stand_in, ReActAgent) and stand_in.name == "sophos"
