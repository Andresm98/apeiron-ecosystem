"""LLM determinista para desarrollo, pruebas y modo simulación (0 tokens).

No razona: compone respuestas a partir de lo que realmente recibe en el prompt, para
que la simulación demuestre la mecánica agéntica con datos reales del grafo:
  1. pide una herramienta (memoria vectorial) con la consulta de su escuela y espera
     la Observation real;
  2. cita esa evidencia en su respuesta;
  3. si hay interlocutor, cita su tesis y le objeta desde su escuela;
  4. como moderador, contrasta las tesis del transcript.

No conoce a ningún agente: la postura de cada uno (`query`, `thesis`, `objection`) y su nombre visible llegan
de su manifiesto (ADR-013, catálogo de agentes). Un agente sin postura usa `DEFAULT_STANCE`.
"""

import asyncio
import re
from collections.abc import Mapping

from apeiron_core.application.usage import record_usage

DEMO_TOOL = "vector_memory_retriever"

DEFAULT_STANCE = {
    "query": "",
    "thesis": "admite una lectura filosófica precisa",
    "objection": "esa posición deja sin justificar su principio",
}

# Solo la línea bajo «Tu interlocutor…» (`dialogue_block`): el resto de la mesa es contexto, no a quién responde.
_INTERLOCUTOR_RE = re.compile(r"Tu interlocutor acaba de sostener:\n- (?P<agent>\w+) \(ronda \d+\): (?P<text>.+)")
_OBSERVATION_RE = re.compile(r"Observation: (?P<obs>.+?)(?:\n\n|\nThought|\Z)", re.S)
_TRANSCRIPT_RE = re.compile(r"^r\d+ (?P<agent>\w+): (?P<text>.+)$", re.M)
_COMMAND_RE = re.compile(r"^\s*(debate|contrasta|compara)\s*:\s*", re.I)
_SIM_RE = re.compile(r"\[simulación\]\s*")
_CLAIM_PREFIX_RE = re.compile(r"^Sostengo que «[^»]*»\s*")
_PERSONA_RE = re.compile(r"\beres ([a-z][a-z0-9_]+)")


def _excerpt(text: str, limit: int = 110) -> str:
    clean = re.sub(r"\s+", " ", _SIM_RE.sub("", text)).strip()
    return clean if len(clean) <= limit else clean[: limit - 1].rsplit(" ", 1)[0] + "…"


def _topic(user: str) -> str:
    first = user.strip().splitlines()[0] if user.strip() else ""
    return _excerpt(_COMMAND_RE.sub("", first), 90)


def _claim(text: str) -> str:
    """La tesis de una intervención, sin el prefijo que repite la pregunta ni la evidencia."""
    clean = _CLAIM_PREFIX_RE.sub("", _SIM_RE.sub("", text).strip())
    return _excerpt(clean.split(". Evidencia")[0].split(". Respondo")[0], 120)


def _evidence(user: str) -> str:
    match = _OBSERVATION_RE.search(user)
    if not match:
        return ""
    first = match.group("obs").strip().splitlines()[0].lstrip("- ")
    return _excerpt(re.sub(r"^\[source=\w+\]\s*", "", first), 150)


class FakeLLM:
    """`pace_s` añade una pausa por llamada para que la UI muestre el grafo avanzando.

    `stances` y `labels` (nombre -> postura / nombre visible) salen del catálogo de agentes.
    """

    def __init__(
        self,
        pace_s: float = 0.0,
        stances: Mapping[str, Mapping[str, str]] | None = None,
        labels: Mapping[str, str] | None = None,
    ) -> None:
        self._pace_s = pace_s
        self._stances = dict(stances or {})
        self._labels = {"human": "el ciudadano", **(labels or {})}
        # «Eres Heráclito» -> heraclito: el nombre visible identifica al hablante en su persona.
        self._personas = {f"eres {label.casefold()}": name for name, label in (labels or {}).items()}

    def _speaker(self, system: str) -> str:
        lowered = system.casefold()
        for marker, name in self._personas.items():
            if marker in lowered:
                return name
        if "moderador" in lowered:
            return "moderador"
        # Cualquier otro worker (p. ej. el sustituto simulado de un agente A2A remoto).
        persona = _PERSONA_RE.search(lowered)
        return persona.group(1) if persona else "moderador"

    def _label(self, agent: str) -> str:
        return self._labels.get(agent, agent.capitalize())

    def _stance(self, agent: str) -> Mapping[str, str]:
        return self._stances.get(agent) or DEFAULT_STANCE

    async def complete(self, system: str, user: str) -> str:
        record_usage()
        if self._pace_s:
            await asyncio.sleep(self._pace_s)
        speaker = self._speaker(system)
        if speaker == "moderador":
            return self._synthesis(user)
        if "Action Input:" not in system:  # worker sin tools: respuesta directa
            return self._answer(speaker, user)
        if DEMO_TOOL in system and "Observation:" not in user:
            query = f"{self._stance(speaker)['query']} {_topic(user)}".strip()
            return (
                "Thought: busco evidencia antes de tomar posición\n"
                f"Action: {DEMO_TOOL}\nAction Input: {query}"
            )
        answer = self._answer(speaker, user)
        return f"Thought: tengo evidencia y la posición del otro\nFinal Answer: {answer}"

    def _answer(self, speaker: str, user: str) -> str:
        stance = self._stance(speaker)
        parts = [f"[simulación] Sostengo que «{_topic(user)}» {stance['thesis']}."]
        if evidence := _evidence(user):
            parts.append(f"Evidencia recuperada ({DEMO_TOOL}): «{evidence}».")
        if other := _INTERLOCUTOR_RE.search(user):
            parts.append(
                f"Respondo a {self._label(other.group('agent'))}: cuando afirma que "
                f"{_claim(other.group('text'))}, reconozco lo que aporta, "
                f"pero objeto que {stance['objection']}."
            )
        return " ".join(parts)

    def _synthesis(self, transcript: str) -> str:
        positions: dict[str, str] = {}
        for match in _TRANSCRIPT_RE.finditer(transcript):
            positions.setdefault(match.group("agent"), match.group("text"))
        if not positions:
            return f"[simulación] Síntesis de Ápeiron sobre: {_excerpt(transcript, 120)}"
        summary = "; ".join(f"{self._label(a)} sostuvo que {_claim(t)}" for a, t in positions.items())
        closing = (
            f"Son {len(positions)} perspectivas distintas sobre la misma pregunta; ninguna la agota y "
            "cada una señala lo que las demás dejan sin examinar."
        )
        return f"[simulación] Síntesis de Ápeiron. {summary}. {closing}"
