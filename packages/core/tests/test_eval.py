"""Casos de evaluación deterministas del agente (tools, citas, límites, sin certeza indebida)."""

from apeiron_core.application.agents.react import ReActAgent
from apeiron_core.application.orchestration.graph import build_graph


class EchoTool:
    name, description = "formal_logic_calculator", "verifica lógica"

    async def run(self, tool_input: str) -> str:
        return f"VALID({tool_input})"


class MemoryTool:
    name, description = "vector_memory_retriever", "memoria"

    async def run(self, tool_input: str) -> str:
        return "[source=global] Anaximandro propuso el ápeiron como principio ilimitado."


class LogicTool:
    name, description = "formal_logic_calculator", "lógica"

    async def run(self, tool_input: str) -> str:
        return "INVÁLIDO: afirmación del consecuente"


class ScriptedLLM:
    def __init__(self, outputs: list[str]) -> None:
        self.outputs = outputs

    async def complete(self, system: str, user: str) -> str:
        return self.outputs.pop(0)


class StubLLM:
    async def complete(self, system: str, user: str) -> str:
        return "STUB"


class FailingAgent:
    async def respond(self, question: str, history: object, emit: object = None) -> str:
        raise RuntimeError("provider unavailable")


async def test_eval_logic_tool_used_for_validity_question() -> None:
    llm = ScriptedLLM(
        [
            "Thought: verifico\nAction: formal_logic_calculator\nAction Input: P -> Q, Q |- P",
            "Thought: listo\nFinal Answer: El argumento no es válido; es la falacia de afirmar el consecuente.",
        ]
    )
    answer = await ReActAgent("anaximandro", "persona", llm, [LogicTool()]).respond(
        "¿Es válido P -> Q, Q |- P?", []
    )
    assert "no es válido" in answer.lower() or "falacia" in answer.lower()
    assert "certeza absoluta" not in answer.lower()


async def test_eval_memory_fragments_are_attributed() -> None:
    llm = ScriptedLLM(
        [
            "Thought: busco\nAction: vector_memory_retriever\nAction Input: ápeiron",
            "Thought: cito\nFinal Answer: Según [source=global], el ápeiron es el principio ilimitado.",
        ]
    )
    answer = await ReActAgent("anaximandro", "persona", llm, [MemoryTool()]).respond("ápeiron", [])
    assert "[source=global]" in answer


async def test_eval_synthesis_does_not_invent_when_specialists_fail() -> None:
    graph = build_graph({"broken": FailingAgent()}, StubLLM())
    out = await graph.ainvoke({"question": "Debate: evidencia", "mode": "debate", "max_rounds": 1})
    assert "Síntesis degradada" in out["answer"]
    assert "ningún especialista completó" in out["answer"]


async def test_eval_unknown_tool_is_rejected() -> None:
    llm = ScriptedLLM(
        ["Action: shell\nAction Input: rm -rf /", "Final Answer: no ejecuto herramientas ajenas"]
    )
    answer = await ReActAgent("a", "p", llm, [EchoTool()]).respond("q", [])
    assert "rm -rf" not in answer
