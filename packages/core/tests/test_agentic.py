"""Comunicación agéntica observable: evidencia por paso, interlocutor y métricas por agente."""

from apeiron_core.application.agents.react import ReActAgent
from apeiron_core.application.orchestration.graph import build_graph
from apeiron_core.application.use_cases.chat import ApeironFacade


class MemoryTool:
    name, description = "vector_memory_retriever", "memoria"

    def __init__(self) -> None:
        self.inputs: list[str] = []

    async def run(self, tool_input: str) -> str:
        self.inputs.append(tool_input)
        return f"- [source=global] fragmento sobre {tool_input}"


class ToolThenAnswerLLM:
    """Primera llamada de cada worker pide la tool; la segunda responde."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def complete(self, system: str, user: str) -> str:
        self.calls.append((system, user))
        if "Herramientas disponibles" not in system:
            return "síntesis"
        if "Observation:" not in user:
            return "Thought: busco\nAction: vector_memory_retriever\nAction Input: devenir"
        speaker = "anaximandro" if "Eres anaximandro" in system else "heraclito"
        return f"Final Answer: posición de {speaker}"


class EagerLLM:
    """Responde sin evidencia salvo que el sistema se lo pida."""

    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def complete(self, system: str, user: str) -> str:
        self.prompts.append(user)
        if "Sistema: aún no has consultado" in user and "Observation:" not in user:
            return "Action: vector_memory_retriever\nAction Input: ápeiron"
        return "Final Answer: respuesta"


def debate_graph(llm, tool):
    agents = {
        name: ReActAgent(name, f"Eres {name}.", llm, [tool], max_steps=3)
        for name in ("anaximandro", "heraclito")
    }
    return build_graph(agents, llm)


async def test_stream_exposes_steps_interlocutor_and_agent_metrics():
    llm, tool = ToolThenAnswerLLM(), MemoryTool()
    facade = ApeironFacade(debate_graph(llm, tool))
    events = [e async for e in facade.stream("Debate: el cambio", "debate", 1)]

    steps = [e.data for e in events if e.type == "step"]
    assert [(s["agent"], s["round"], s["tool"]) for s in steps] == [
        ("anaximandro", 0, "vector_memory_retriever"),
        ("heraclito", 0, "vector_memory_retriever"),
    ]
    assert steps[0]["input"] == "devenir" and "fragmento sobre devenir" in steps[0]["observation"]

    turns = [e.data for e in events if e.type == "turn"]
    assert turns[0]["responds_to"] is None
    assert turns[1]["agent"] == "heraclito" and turns[1]["responds_to"] == "anaximandro"
    # Heráclito recibió de verdad la posición de Anaximandro en su prompt.
    heraclito_prompts = [u for s, u in llm.calls if "Eres heraclito" in s]
    assert "anaximandro (ronda 1): posición de anaximandro" in heraclito_prompts[0]


async def test_collector_records_agents_executed_with_effort():
    class Runs:
        saved: list = []

        async def save(self, run):
            self.saved.append(run)

    runs = Runs()
    facade = ApeironFacade(debate_graph(ToolThenAnswerLLM(), MemoryTool()), runs=runs)
    await facade.ask("Debate: el cambio", "debate", 1)
    [run] = runs.saved
    by_agent = {a["agent_id"]: a for a in run["agents"]}
    assert set(by_agent) == {"apeiron", "anaximandro", "heraclito"}
    assert by_agent["apeiron"]["invocations"] == 4  # router + 2 supervisor + síntesis
    assert by_agent["anaximandro"]["reasoning_steps"] == 2
    assert by_agent["anaximandro"]["tool_calls"] == 1
    assert by_agent["anaximandro"]["tools_used"] == ["vector_memory_retriever"]
    assert len(run["steps"]) == 2 and run["steps"][1]["agent"] == "heraclito"


async def test_require_evidence_asks_once_for_a_tool_before_answering():
    llm, tool = EagerLLM(), MemoryTool()
    agent = ReActAgent("anaximandro", "p", llm, [tool], max_steps=2, require_evidence=True)
    assert await agent.respond("¿qué es el ápeiron?", []) == "respuesta"
    assert tool.inputs == ["ápeiron"]  # consultó la herramienta tras el aviso
    assert len(llm.prompts) == 3  # respuesta sin evidencia, tool, respuesta final


async def test_require_evidence_is_off_by_default():
    llm, tool = EagerLLM(), MemoryTool()
    agent = ReActAgent("anaximandro", "p", llm, [tool], max_steps=2)
    assert await agent.respond("q", []) == "respuesta"
    assert tool.inputs == [] and len(llm.prompts) == 1


class StubbornLLM:
    """Nunca usa herramientas por iniciativa propia, aunque se le pida."""

    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def complete(self, system: str, user: str) -> str:
        self.prompts.append(user)
        cited = "Observation:" in user
        return f"Final Answer: {'con evidencia real' if cited else 'según mi consulta (inventada)'}"


async def test_require_evidence_runs_the_tool_itself_when_the_model_refuses():
    from apeiron_core.application.use_cases.chat import ApeironFacade

    llm, tool = StubbornLLM(), MemoryTool()
    agent = ReActAgent("anaximandro", "p", llm, [tool], max_steps=2, require_evidence=True)
    facade = ApeironFacade(build_graph({"anaximandro": agent}, llm))
    events = [e async for e in facade.stream("¿ápeiron?", "single", None)]
    [step] = [e.data for e in events if e.type == "step"]
    assert step["auto"] is True and step["input"] == "¿ápeiron?"  # consulta del sistema, visible
    assert tool.inputs == ["¿ápeiron?"]
    assert events[-1].data["answer"] == "con evidencia real"  # nunca la cita inventada
    assert len(llm.prompts) == 3  # sin evidencia, reintento, respuesta tras observación real


async def test_steps_never_exceed_max_steps():
    class ToolAddict:
        calls = 0

        async def complete(self, system: str, user: str) -> str:
            self.calls += 1
            return "Action: vector_memory_retriever\nAction Input: más"

    llm = ToolAddict()
    agent = ReActAgent("a", "p", llm, [MemoryTool()], max_steps=3, require_evidence=True)
    answer = await agent.respond("q", [])
    assert "no se obtuvo una respuesta final válida" in answer
    assert llm.calls == 3
