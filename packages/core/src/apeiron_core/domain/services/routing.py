"""Intención -> modo y agente. Heurística inicial sustituible por otra política."""

import unicodedata
from collections.abc import Collection, Mapping

from apeiron_core.domain.value_objects.mode import Mode

DEBATE_HINTS = ("debate", "contrasta", "compara", " vs ", "versus", "ambos")


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def decide_mode(question: str) -> Mode:
    normalized_question = f" {_normalize(question)} "
    return (
        "debate"
        if any(hint in normalized_question for hint in DEBATE_HINTS)
        else "single"
    )


def decide_agent(question: str, hints: Mapping[str, Collection[str]], default_agent: str) -> str:
    """Primer agente (en orden del catálogo) con alguna pista en la pregunta; si no, `default_agent`.

    Las pistas las declara cada agente en su manifiesto (ADR-013, catálogo de agentes): el dominio no conoce a ninguno.
    """
    normalized_question = _normalize(question)
    for agent, agent_hints in hints.items():
        if any(_normalize(hint) in normalized_question for hint in agent_hints):
            return agent
    return default_agent
