"""LLM determinista para desarrollo, pruebas y modo simulación (0 tokens).

No razona: compone respuestas a partir de lo que realmente recibe en el prompt, para
que la simulación demuestre la mecánica agéntica con datos reales del grafo:
  1. pide una herramienta (memoria vectorial) con la consulta de su escuela y espera
     la Observation real;
  2. cita esa evidencia en su respuesta;
  3. si hay interlocutor, cita su tesis y le objeta desde su escuela;
  4. como moderador, contrasta las tesis del transcript.
"""

import asyncio
import re

from apeiron_core.application.usage import record_usage

DEMO_TOOL = "vector_memory_retriever"

STANCES = {
    "anaximandro": {
        "query": "Anaximandro ápeiron indeterminado principio de los opuestos",
        "thesis": "se explica desde el ápeiron: un fondo indeterminado del que surgen los "
        "opuestos y al que regresan, pagando su injusticia según el orden del tiempo",
        "objection": "un flujo sin fondo no explica de dónde surgen los opuestos; el cambio "
        "necesita un principio ilimitado que lo preceda",
    },
    "heraclito": {
        "query": "Heráclito todo fluye logos tensión de opuestos",
        "thesis": "se explica desde el devenir: todo fluye y lo real es la tensión de opuestos "
        "medida por el logos, no una reserva inmóvil",
        "objection": "un fondo indeterminado no explica nada; la unidad está en la lucha "
        "misma de los contrarios, como en el arco y la lira",
    },
}
DEFAULT_STANCE = {
    "query": "",
    "thesis": "admite una lectura filosófica precisa",
    "objection": "esa posición deja sin justificar su principio",
}

_INTERLOCUTOR_RE = re.compile(r"^- (?P<agent>\w+) \(ronda \d+\): (?P<text>.+)$", re.M)
_OBSERVATION_RE = re.compile(r"Observation: (?P<obs>.+?)(?:\n\n|\nThought|\Z)", re.S)
_TRANSCRIPT_RE = re.compile(r"^r\d+ (?P<agent>\w+): (?P<text>.+)$", re.M)
_COMMAND_RE = re.compile(r"^\s*(debate|contrasta|compara)\s*:\s*", re.I)
_SIM_RE = re.compile(r"\[simulación\]\s*")
_CLAIM_PREFIX_RE = re.compile(r"^Sostengo que «[^»]*»\s*")


def _speaker(system: str) -> str:
    lowered = system.lower()
    if "eres anaximandro" in lowered:
        return "anaximandro"
    if "eres heráclito" in lowered or "eres heraclito" in lowered:
        return "heraclito"
    return "moderador"


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


def _label(agent: str) -> str:
    return "Heráclito" if agent == "heraclito" else agent.capitalize()


class FakeLLM:
    """`pace_s` añade una pausa por llamada para que la UI muestre el grafo avanzando."""

    def __init__(self, pace_s: float = 0.0) -> None:
        self._pace_s = pace_s

    async def complete(self, system: str, user: str) -> str:
        record_usage()
        if self._pace_s:
            await asyncio.sleep(self._pace_s)
        speaker = _speaker(system)
        if speaker == "moderador":
            return self._synthesis(user)
        if "Action Input:" not in system:  # worker sin tools: respuesta directa
            return self._answer(speaker, user)
        if DEMO_TOOL in system and "Observation:" not in user:
            query = f"{STANCES.get(speaker, DEFAULT_STANCE)['query']} {_topic(user)}".strip()
            return (
                "Thought: busco evidencia antes de tomar posición\n"
                f"Action: {DEMO_TOOL}\nAction Input: {query}"
            )
        answer = self._answer(speaker, user)
        return f"Thought: tengo evidencia y la posición del otro\nFinal Answer: {answer}"

    @staticmethod
    def _answer(speaker: str, user: str) -> str:
        stance = STANCES.get(speaker, DEFAULT_STANCE)
        parts = [f"[simulación] Sostengo que «{_topic(user)}» {stance['thesis']}."]
        if evidence := _evidence(user):
            parts.append(f"Evidencia recuperada ({DEMO_TOOL}): «{evidence}».")
        if other := _INTERLOCUTOR_RE.search(user):
            parts.append(
                f"Respondo a {_label(other.group('agent'))}: cuando afirma que "
                f"{_claim(other.group('text'))}, coincido en que los opuestos se ordenan, "
                f"pero objeto que {stance['objection']}."
            )
        return " ".join(parts)

    @staticmethod
    def _synthesis(transcript: str) -> str:
        positions: dict[str, str] = {}
        for match in _TRANSCRIPT_RE.finditer(transcript):
            positions.setdefault(match.group("agent"), match.group("text"))
        if not positions:
            return f"[simulación] Síntesis de Ápeiron sobre: {_excerpt(transcript, 120)}"
        summary = "; ".join(f"{_label(a)} sostuvo que {_claim(t)}" for a, t in positions.items())
        return (
            f"[simulación] Síntesis de Ápeiron. {summary}. "
            "Coinciden en que los opuestos no son caos sino un orden; difieren en el fundamento: "
            "un principio indeterminado previo (ápeiron) frente al devenir medido por el logos."
        )
