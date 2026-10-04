"""Intención -> modo. Heurística inicial sustituible por otra política."""

import unicodedata
from collections.abc import Collection

from apeiron_core.domain.value_objects.mode import Mode

DEBATE_HINTS = ("debate", "contrasta", "compara", " vs ", "versus", "ambos")
AGENT_HINTS = {
    "anaximandro": ("anaximandro", "apeiron", "arché"),
    "heraclito": ("heraclito", "devenir", "logos"),
}


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


def decide_agent(
    question: str, available_agents: Collection[str], default_agent: str
) -> str:
    normalized_question = _normalize(question)
    enabled = set(available_agents)
    for agent, hints in AGENT_HINTS.items():
        if agent in enabled and any(
            _normalize(hint) in normalized_question for hint in hints
        ):
            return agent
    return default_agent
