from collections.abc import Mapping

from apeiron_core.application.agents.factories import (
    AnaximandroFactory,
    HeraclitoFactory,
)
from apeiron_core.application.agents.react import ReActAgent
from apeiron_core.application.agents.registry import AgentRegistry
from apeiron_core.application.orchestration.graph import build_graph
from apeiron_core.application.ports.outbound.tools import ToolPort
from apeiron_core.application.use_cases.chat import ApeironFacade
from apeiron_core.domain.services.routing import decide_mode


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


def make_graph(tools: Mapping[str, ToolPort] | None = None):
    llm = StubLLM()
    reg = AgentRegistry()
    reg.register(AnaximandroFactory())
    reg.register(HeraclitoFactory())
    return build_graph(reg.build_all(llm, tools), llm)


def test_domain_routing_selects_interaction_mode():
    assert decide_mode("¿Qué es el ápeiron?") == "single"
    assert decide_mode("Debate: ¿qué explica mejor el cosmos?") == "debate"


async def test_single_routes_to_default_agent():
    out = await make_graph().ainvoke({"question": "¿Qué es el ápeiron?"})
    assert out["mode"] == "single" and [t["agent"] for t in out["turns"]] == [
        "anaximandro"
    ]


async def test_debate_two_agents_two_rounds_then_synthesis():
    out = await make_graph().ainvoke({"question": "Debate: entrelazamiento y monismo"})
    assert len(out["turns"]) == 4 and out["trace"][-1] == "[Synthesis]"
    assert {t["agent"] for t in out["turns"]} == {"anaximandro", "heraclito"}


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


async def test_facade_stream_emits_trace_turn_answer():
    facade = ApeironFacade(make_graph({"formal_logic_calculator": EchoTool()}))
    kinds = [e.type async for e in facade.stream("debate: tres cuerpos", None, 1)]
    assert kinds[0] == "trace" and kinds[-1] == "answer" and kinds.count("turn") == 2
