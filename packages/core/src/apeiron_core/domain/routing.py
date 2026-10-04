"""Intención -> modo. Heurística inicial; sustituible por router LLM con el mismo contrato."""
DEBATE_HINTS = ("debate", "contrasta", "compara", " vs ", "versus", "ambos")


def decide_mode(question: str) -> str:
    q = f" {question.lower()} "
    return "debate" if any(h in q for h in DEBATE_HINTS) else "single"
