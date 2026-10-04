"""Patrón ReAct explícito: Thought -> Action -> Observation -> Reflect."""

import asyncio
import re
from collections.abc import Sequence

from apeiron_core.application.agents.base import others_block
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


class ReActAgent:
    def __init__(
        self,
        name: str,
        persona: str,
        llm: LLMPort,
        tools: Sequence[ToolPort],
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

    def _system(self) -> str:
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

    async def respond(
        self, question: str, history: list[AgentTurn], emit: Emit | None = None
    ) -> str:
        notify: Emit = emit or (lambda _message: None)
        base = question + others_block(self.name, history)
        scratch = ""
        last = ""
        for step in range(self._max_steps):
            force = step == self._max_steps - 1
            prompt = base + (f"\n\n{scratch}" if scratch else "")
            if force:
                prompt += "\n\nDebes responder ahora con 'Final Answer:'."
            output = (await self._llm.complete(self._system(), prompt)).strip()
            last = output
            action, final = ACTION_RE.search(output), FINAL_RE.search(output)
            if final and not (action and action.start() < final.start()):
                return final.group("answer").strip()
            if action is None or force:
                return f"[{self.name}: no se obtuvo una respuesta final válida]"
            tool_name = action.group("tool")
            notify(f"[{self.name} Executing Tool: {tool_name}]")
            observation = await self._run_tool(tool_name, action.group("input").strip())
            notify(f"[{self.name} Reflecting]")
            scratch += f"{output[: action.end()]}\nObservation: {observation}\n"
        return last
