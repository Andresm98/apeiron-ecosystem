import operator
from typing import Annotated, TypedDict


class ApeironState(TypedDict, total=False):
    question: str
    mode: str  # "single" | "debate"
    participants: list[str]
    round: int
    max_rounds: int
    turns: Annotated[list[dict[str, object]], operator.add]
    trace: Annotated[list[str], operator.add]  # alimenta el Agent State Viewer
    answer: str
