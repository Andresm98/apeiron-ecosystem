"""Worker ReAct como subgrafo LangGraph: reason -> act (tool) -> reason ... -> END.

El subgrafo es visible en LangGraph Studio y en el stream (`subgraphs=True`). El protocolo
de texto es explícito: Thought -> Action -> Observation -> Reflect -> Final Answer.
"""

import asyncio
import re
from collections.abc import Sequence
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from apeiron_core.application.agents.base import dialogue_block, emit_step, stream_emitter
from apeiron_core.application.guardrails import DATA_RULE, apply_guardrail
from apeiron_core.application.ports.outbound.events import Emit
from apeiron_core.application.ports.outbound.guardrails import GuardrailPort
from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_core.application.ports.outbound.tools import ToolPort
from apeiron_core.domain.entities.agent_turn import AgentTurn
from apeiron_core.domain.value_objects.guardrail import GuardrailRecord

PREVIEW_INPUT, PREVIEW_OBSERVATION = 200, 480
EVIDENCE_RULE = (
    "Antes de 'Final Answer:' usa al menos una herramienta para apoyar tu posición "
    "con evidencia verificable. Cita solo observaciones reales; nunca inventes consultas."
)
EVIDENCE_RETRY = (
    "\nSistema: aún no has consultado ninguna herramienta. Responde SOLO con:\n"
    "Thought: <qué evidencia buscas>\nAction: <herramienta>\nAction Input: <consulta>\n"
)
FALLBACK_TOOLS = ("vector_memory_retriever", "scholarly_search", "mcp_public_api_tool")
# Tolerante a desvíos habituales de los LLM: **negritas**, `backticks` y la entrada de
# la acción en la línea siguiente a "Action Input:".
ACTION_RE = re.compile(
    r"\**Action\**:\**\s*[`*]*(?P<tool>[\w\-]+)[`*]*\s*\n+\s*"
    r"\**Action Input\**:\**[ \t]*\n?[ \t]*(?P<input>[^\n]+)"
)
FINAL_RE = re.compile(r"\**Final Answer\**:\**\s*(?P<answer>.+)", re.S)
FORMAT_RETRY = (
    "\nSistema: no entendí tu salida. Usa exactamente 'Action:' + 'Action Input:' "
    "o 'Final Answer:'.\n"
)

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
    round: int
    scratch: str
    step: int
    action_tool: str
    action_input: str
    answer: str
    retry: bool
    auto: bool
    failed: bool  # sin respuesta final válida: el turno se publica como degradado
    evidence: list[str]  # observaciones reales (ya saneadas): base para verificar citas
    guardrails: list[GuardrailRecord]


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
        require_evidence: bool = False,
        guardrails: GuardrailPort | None = None,
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
        # Exigir evidencia necesita al menos un paso de tool y otro de respuesta.
        self._require_evidence = require_evidence and bool(tools) and max_steps >= 2
        self._guardrails = guardrails
        self.graph: Any = self._build_graph()

    def _build_graph(self) -> Any:
        graph = StateGraph(WorkerState)
        graph.add_node("reason", self._reason)
        graph.add_edge(START, "reason")
        if self._tools:
            graph.add_node("act", self._act)
            graph.add_conditional_edges("reason", self._next, ["act", "reason", END])
            graph.add_edge("act", "reason")
        else:
            graph.add_edge("reason", END)
        return graph.compile(name=self.name)

    @staticmethod
    def _next(state: WorkerState) -> str:
        if state.get("action_tool"):
            return "act"
        return "reason" if state.get("retry") and not state.get("answer") else END

    def _system(self) -> str:
        data_rule = f"\n\n{DATA_RULE}" if self._guardrails else ""
        if not self._tools:
            return self._persona + data_rule
        catalog = "\n".join(
            f"- {tool.name}: {tool.description}" for tool in self._tools.values()
        )
        rule = f"\n{EVIDENCE_RULE}" if self._require_evidence else ""
        return f"{self._persona}\n\nHerramientas disponibles:\n{catalog}\n\n{FORMAT}{rule}{data_rule}"

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
        force = step >= self._max_steps - 1  # cota dura: nunca más pasos que max_steps
        if self._tools and force:
            prompt += "\n\nDebes responder ahora con 'Final Answer:'."
        output = (await self._llm.complete(self._system(), prompt)).strip()
        if not self._tools:
            final = FINAL_RE.search(output)
            return {"answer": final.group("answer").strip() if final else output}
        action, final = ACTION_RE.search(output), FINAL_RE.search(output)
        if final and not (action and action.start() < final.start()):
            if self._require_evidence and "Observation:" not in scratch:
                if not state.get("retry") and not force:
                    # 1º: se le pide (sin consumir paso) que use una herramienta.
                    return {"scratch": scratch + EVIDENCE_RETRY, "action_tool": "", "retry": True}
                # 2º: insiste en responder sin evidencia -> la consulta la hace el sistema,
                # así ninguna respuesta llega sin una observación real detrás.
                return self._fallback_action(state)
            return {"answer": final.group("answer").strip(), "action_tool": ""}
        if action is None and not force:
            # Salida fuera de formato: se le recuerda el formato (consume un paso, acotado).
            return {"scratch": scratch + FORMAT_RETRY, "step": step + 1, "action_tool": "", "retry": True}
        if action is None or force:
            return {
                "answer": f"[{self.name}: no se obtuvo una respuesta final válida]",
                "action_tool": "",
                "failed": True,
            }
        return {
            "action_tool": action.group("tool"),
            "action_input": action.group("input").strip(),
            "scratch": scratch + output[: action.end()],
        }

    def _fallback_action(self, state: WorkerState) -> dict[str, Any]:
        tool = next((t for t in FALLBACK_TOOLS if t in self._tools), next(iter(self._tools)))
        return {
            "action_tool": tool,
            "action_input": state["question"][:PREVIEW_INPUT],
            "auto": True,
            "step": max(state.get("step", 0), self._max_steps - 2),  # tras act, toca responder
        }

    async def _act(self, state: WorkerState) -> dict[str, Any]:
        notify = stream_emitter()
        tool_name = state["action_tool"]
        tool_input = state.get("action_input", "")
        step = state.get("step", 0)
        notify(f"[{self.name} Executing Tool: {tool_name}]")
        observation = await self._run_tool(tool_name, tool_input)
        # Inyección indirecta: la observación se sanea antes de entrar al prompt y al stream.
        verdict, records, messages = await apply_guardrail(
            self._guardrails, "observation", observation, agent=self.name, round_=state.get("round", 0)
        )
        observation = verdict.text
        for message in messages:
            notify(message)
        emit_step(
            f"[{self.name} Reflecting]",
            {
                "agent": self.name,
                "round": state.get("round", 0),
                "step": step + 1,
                "tool": tool_name,
                "input": tool_input[:PREVIEW_INPUT],
                "observation": observation[:PREVIEW_OBSERVATION],
                "error": observation.startswith("Error"),
                "auto": bool(state.get("auto")),  # consulta forzada por la política de evidencia
            },
        )
        return {
            "scratch": f"{state.get('scratch', '')}\nObservation: {observation}\n",
            "step": step + 1,
            "action_tool": "",
            "retry": False,
            "auto": False,
            "evidence": [*state.get("evidence", []), observation],
            "guardrails": [*state.get("guardrails", []), *records],
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
