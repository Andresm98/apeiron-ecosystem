"""Estado compartido del grafo de aplicación Ápeiron."""

import operator
from typing import Annotated, TypedDict

from apeiron_core.domain.entities.agent_turn import AgentTurn
from apeiron_core.domain.value_objects.mode import Mode


class ApeironState(TypedDict, total=False):
    question: str
    mode: Mode
    participants: list[str]
    round: int
    max_rounds: int
    turns: Annotated[list[AgentTurn], operator.add]
    trace: Annotated[list[str], operator.add]
    answer: str
