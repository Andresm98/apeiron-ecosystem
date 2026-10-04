"""Intención -> modo. Heurística inicial sustituible por otra política."""

from apeiron_core.domain.value_objects.mode import Mode

DEBATE_HINTS = ("debate", "contrasta", "compara", " vs ", "versus", "ambos")


def decide_mode(question: str) -> Mode:
    normalized_question = f" {question.lower()} "
    return (
        "debate"
        if any(hint in normalized_question for hint in DEBATE_HINTS)
        else "single"
    )
