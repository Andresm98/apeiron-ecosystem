"""Worker ReAct como subgrafo LangGraph: reason -> act (tool) -> reason ... -> END.

El subgrafo es visible en LangGraph Studio y en el stream (`subgraphs=True`). El protocolo
de texto es explícito: Thought -> Action -> Observation -> Reflect -> Final Answer.
"""

import asyncio
import re
from collections.abc import Sequence
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from apeiron_core.application.agents.base import dialogue_block, stream_emitter
from apeiron_core.application.ports.outbound.events import Emit
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.application.ports.outbound.tools import ToolPort
from apeiron_core.domain.entities.agent_turn import AgentTurn

ACTION_RE = re.compile(
    r"Action:\s*(?P<tool>[\w\-]+)\s*\n\s*Action Input:\s*(?P<input>[^\n]+)"
)
FINAL_RE = re.compile(r"Final Answer:\s*(?P<answer>.+)", re.S)

FORMAT = """Usa EXACTAMENTE este formato.
Para usar una herramienta:
Thought: <razonamiento>
Action: <nombre_de_herramienta>
Action Input: <entrada en una sola línea>
(el sistema responderá con Observation; luego escribe)
Reflect: <¿la observación basta? ¿qué falta?>
...repite si hace falta. Cuando puedas responder:
Thought: <razonamiento>
Final Answer: <respuesta>"""


class WorkerState(TypedDict, total=False):
    question: str
    history: list[AgentTurn]
    scratch: str
    step: int
    action_tool: str
    action_input: str
    answer: str


class ReActAgent:
    """Worker especialista. Sin tools, `reason` responde directamente en un paso."""

    def __init__(
        self,
        name: str,
        persona: str,
        llm: LLMPort,
        tools: Sequence[ToolPort] = (),
        max_steps: int = 4,
        tool_timeout_s: float = 20.0,
    ) -> None:
        if not 1 <= max_steps <= 8:
            raise ValueError("max_steps debe estar entre 1 y 8")
        if not 0 < tool_timeout_s <= 120:
            raise ValueError("tool_timeout_s debe estar entre 0 y 120")
        self.name = name
        self._persona = persona
        self._llm = llm
        self._tools = {tool.name: tool for tool in tools}
        self._max_steps = max_steps
        self._tool_timeout_s = tool_timeout_s
        self.graph: Any = self._build_graph()

    def _build_graph(self) -> Any:
        graph = StateGraph(WorkerState)
        graph.add_node("reason", self._reason)
        graph.add_edge(START, "reason")
        if self._tools:
            graph.add_node("act", self._act)
            graph.add_conditional_edges(
                "reason",
                lambda state: "act" if state.get("action_tool") else END,
                ["act", END],
            )
            graph.add_edge("act", "reason")
        else:
            graph.add_edge("reason", END)
        return graph.compile(name=self.name)

    def _system(self) -> str:
        if not self._tools:
            return self._persona
        catalog = "\n".join(
            f"- {tool.name}: {tool.description}" for tool in self._tools.values()
        )
        return f"{self._persona}\n\nHerramientas disponibles:\n{catalog}\n\n{FORMAT}"

    async def _run_tool(self, tool_name: str, tool_input: str) -> str:
        tool = self._tools.get(tool_name)
        if tool is None:
            return f"Error: herramienta desconocida '{tool_name}'."
        try:
            async with asyncio.timeout(self._tool_timeout_s):
                return await tool.run(tool_input)
        except TimeoutError:
            return f"Error: la herramienta '{tool_name}' excedió {self._tool_timeout_s:.0f}s."
        except Exception as exc:
            return f"Error en '{tool_name}': {exc}"

    async def _reason(self, state: WorkerState) -> dict[str, Any]:
        step = state.get("step", 0)
        scratch = state.get("scratch", "")
        prompt = state["question"] + dialogue_block(self.name, state.get("history", []))
        if scratch:
            prompt += f"\n\n{scratch}"
        force = step == self._max_steps - 1
        if self._tools and force:
            prompt += "\n\nDebes responder ahora con 'Final Answer:'."
        output = (await self._llm.complete(self._system(), prompt)).strip()
        if not self._tools:
            final = FINAL_RE.search(output)
            return {"answer": final.group("answer").strip() if final else output}
        action, final = ACTION_RE.search(output), FINAL_RE.search(output)
        if final and not (action and action.start() < final.start()):
            return {"answer": final.group("answer").strip(), "action_tool": ""}
        if action is None or force:
            return {
                "answer": f"[{self.name}: no se obtuvo una respuesta final válida]",
                "action_tool": "",
            }
        return {
            "action_tool": action.group("tool"),
            "action_input": action.group("input").strip(),
            "scratch": scratch + output[: action.end()],
        }

    async def _act(self, state: WorkerState) -> dict[str, Any]:
        notify = stream_emitter()
        tool_name = state["action_tool"]
        notify(f"[{self.name} Executing Tool: {tool_name}]")
        observation = await self._run_tool(tool_name, state.get("action_input", ""))
        notify(f"[{self.name} Reflecting]")
        return {
            "scratch": f"{state.get('scratch', '')}\nObservation: {observation}\n",
            "step": state.get("step", 0) + 1,
            "action_tool": "",
        }

    async def respond(
        self, question: str, history: list[AgentTurn], emit: Emit | None = None
    ) -> str:
        """Ejecución autónoma (fuera del grafo Ápeiron) reenviando eventos a `emit`."""
        notify: Emit = emit or (lambda _message: None)
        answer = ""
        async for kind, chunk in self.graph.astream(
            {"question": question, "history": history},
            stream_mode=["custom", "values"],
        ):
            if kind == "custom":
                notify(chunk["message"])
            else:
                answer = chunk.get("answer", answer)
        return answer
