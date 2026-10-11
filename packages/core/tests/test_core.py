from collections.abc import Mapping

import pytest

from apeiron_core.application.agents.base import dialogue_block, interlocutor
from apeiron_core.application.agents.factories import SpecAgentFactory
from apeiron_core.application.agents.react import ReActAgent
from apeiron_core.application.agents.registry import AgentRegistry
from apeiron_core.application.orchestration.graph import build_graph
from apeiron_core.application.ports.outbound.tools import ToolPort
from apeiron_core.application.use_cases.chat import ApeironFacade
from apeiron_core.domain.entities.agent_spec import AgentCardInfo, AgentSpec, Residence
from apeiron_core.domain.entities.agent_turn import AgentTurn
from apeiron_core.domain.services.routing import decide_agent, decide_mode


def spec(name: str, display: str, tools: tuple[str, ...] = (), **extra) -> AgentSpec:
    """Manifiesto mínimo para tests: el núcleo no conoce a ningún agente concreto (ADR-013, catálogo de agentes)."""
    fields = {
        "role": f"Rol de {display}.",
        "persona": f"Eres {display}. Responde en el idioma del usuario.",
        "card": AgentCardInfo(description=f"{display} razona."),
        "residence": Residence(title=f"Casa de {display}", subtitle="-"),
        **extra,
    }
    return AgentSpec(name=name, display_name=display, tools=tools, **fields)


ANAXIMANDRO = spec("anaximandro", "Anaximandro", ("formal_logic_calculator",), debate=True)
HERACLITO = spec("heraclito", "Heráclito", ("vector_memory_retriever",), hints=("logos",), debate=True)


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
    reg.register(SpecAgentFactory(ANAXIMANDRO))
    reg.register(SpecAgentFactory(HERACLITO))
    return build_graph(reg.build_all(llm, tools), llm)


def test_domain_routing_selects_interaction_mode():
    assert decide_mode("¿Qué es el ápeiron?") == "single"
    assert decide_mode("Debate: ¿qué explica mejor el cosmos?") == "debate"
    hints = {"anaximandro": ANAXIMANDRO.routing_hints, "heraclito": HERACLITO.routing_hints}
    assert decide_agent("¿Qué diría Heráclito sobre el logos?", hints, "anaximandro") == "heraclito"
    assert decide_agent("Háblame del logos", hints, "anaximandro") == "heraclito"  # pista declarada
    # Solo eligen los agentes disponibles: sin Heráclito en las pistas, gana el agente por defecto.
    assert decide_agent("¿Qué diría Heráclito?", {"anaximandro": ("anaximandro",)}, "anaximandro") == "anaximandro"


def test_agent_spec_rejects_invalid_manifests():
    with pytest.raises(ValueError, match="reservado"):
        spec("human", "Human")
    with pytest.raises(ValueError, match="nombrar al agente"):
        AgentSpec(
            name="socrates", display_name="Sócrates", role="r", persona="Eres otro.",
            card=AgentCardInfo("d"), residence=Residence("t", "s"),
        )
    with pytest.raises(ValueError, match="landmark"):
        spec("socrates", "Sócrates", residence=Residence("t", "s", landmark="castillo"))
    with pytest.raises(ValueError, match="simulation incompleta"):
        spec("socrates", "Sócrates", simulation={"query": "q"})
    assert spec("socrates", "Sócrates").routing_hints == ("socrates", "Sócrates")


def test_registry_describes_specs_and_rejects_duplicates():
    reg = AgentRegistry()
    reg.register(SpecAgentFactory(ANAXIMANDRO))
    reg.register(SpecAgentFactory(HERACLITO))
    with pytest.raises(ValueError, match="duplicado"):
        reg.register(SpecAgentFactory(ANAXIMANDRO))
    described = reg.describe()[1]
    assert described["display_name"] == "Heráclito" and described["residence"]["title"] == "Casa de Heráclito"
    assert reg.debate_defaults() == ["anaximandro", "heraclito"]
    assert reg.hints()["heraclito"] == ("heraclito", "Heráclito", "logos")


async def test_router_uses_hints_declared_by_each_manifest():
    llm = StubLLM()
    reg = AgentRegistry()
    reg.register(SpecAgentFactory(ANAXIMANDRO))
    reg.register(SpecAgentFactory(HERACLITO))
    graph = build_graph(reg.build_all(llm), llm, hints=reg.hints())
    out = await graph.ainvoke({"question": "¿Qué es el logos?"})
    assert [t["agent"] for t in out["turns"]] == ["heraclito"]


def test_spec_factory_grants_only_declared_tools_and_caps_steps():
    class Other(EchoTool):
        name = "vector_memory_retriever"

    capped = spec("socrates", "Sócrates", ("formal_logic_calculator",), max_steps=1)
    agent = SpecAgentFactory(capped).create(StubLLM(), {"formal_logic_calculator": EchoTool(), **{Other.name: Other()}})
    assert isinstance(agent, ReActAgent)
    assert list(agent._tools) == ["formal_logic_calculator"] and agent._max_steps == 1


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


async def test_chosen_agent_overrides_intent_routing_and_forces_single():
    # La pregunta apunta a Heráclito por sus hints, pero el usuario eligió a Anaximandro (ADR-013).
    out = await make_graph().ainvoke(
        {"question": "Debate: ¿qué diría Heráclito sobre el logos?", "agent": "anaximandro"}
    )
    assert out["mode"] == "single"
    assert [turn["agent"] for turn in out["turns"]] == ["anaximandro"]


@pytest.mark.parametrize(
    ("inputs", "message"),
    [
        ({"agent": "socrates"}, "agente desconocido"),
        ({"agent": "heraclito", "mode": "debate"}, "solo aplica en modo single"),
    ],
)
async def test_chosen_agent_is_validated_by_the_graph(inputs, message):
    with pytest.raises(ValueError, match=message):
        await make_graph().ainvoke({"question": "¿Qué es el cambio?", **inputs})


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
    reg.register(SpecAgentFactory(ANAXIMANDRO))
    reg.register(SpecAgentFactory(HERACLITO))
    graph = build_graph(reg.build_all(llm), llm)
    out = await graph.ainvoke({"question": "Debate: el cambio", "max_rounds": 2})
    order = [(t["agent"], t["round"]) for t in out["turns"]]
    assert order == [("anaximandro", 0), ("heraclito", 0), ("anaximandro", 1), ("heraclito", 1)]
    heraclito_r0 = llm.calls[1][1]
    assert "Tu interlocutor" in heraclito_r0 and "anaximandro (ronda 1): posición 1" in heraclito_r0
    assert "heraclito (ronda 1): posición 2" in llm.calls[2][1]
    assert "[Ápeiron Delegating → heraclito r0]" in out["trace"]
    assert out["trace"][-1] == "[Synthesis]" and len(llm.calls) == 5


def test_dialogue_block_puts_the_latest_speaker_as_interlocutor():
    """Con varios en la mesa, el interlocutor es el último que habló (el `responds_to`), no el primero."""

    def turn(agent: str, rnd: int, degraded: bool = False) -> AgentTurn:
        return {"agent": agent, "round": rnd, "text": f"{agent}-{rnd}", "degraded": degraded, "responds_to": None}

    history = [turn("anaximandro", 0), turn("heraclito", 0), turn("epicuro", 0), turn("anaximandro", 1),
               turn("human", 1), turn("feynman", 1, degraded=True)]
    block = dialogue_block("heraclito", history)
    head, context = block.split("Antes hablaron en la mesa")

    assert interlocutor("heraclito", history) == "human"
    assert head.endswith("Tu interlocutor acaba de sostener:\n- human (ronda 2): human-1\n")
    # El resto, del más reciente al más antiguo; ni el propio agente ni los turnos degradados.
    assert context.index("anaximandro (ronda 2)") < context.index("epicuro (ronda 1)")
    assert "anaximandro-0" not in block and "heraclito" not in block and "feynman" not in block
    assert dialogue_block("heraclito", []) == ""


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
    reg.register(SpecAgentFactory(ANAXIMANDRO))
    reg.register(RemoteAgentFactory("sophos", "Socio remoto.", remote, endpoint="sophos.example.org"))
    described = {a["name"]: a for a in reg.describe()}
    assert described["anaximandro"]["kind"] == "local"
    assert described["sophos"] == {
        "name": "sophos", "role": "Socio remoto.", "tools": [], "kind": "remote", "endpoint": "sophos.example.org"
    }
    assert reg.build_all(StubLLM())["sophos"] is remote
    stand_in = RemoteAgentFactory("sophos", "Socio remoto.").create(StubLLM(), {})
    assert isinstance(stand_in, ReActAgent) and stand_in.name == "sophos"
