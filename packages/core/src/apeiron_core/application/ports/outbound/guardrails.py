"""Puerto de salida para guardrails sobre entrada, observaciones, turnos y salida."""

from collections.abc import Sequence
from typing import Protocol

from apeiron_core.domain.value_objects.guardrail import GuardrailVerdict, Stage


class GuardrailPort(Protocol):
    async def check(
        self, stage: Stage, text: str, evidence: Sequence[str] = ()
    ) -> GuardrailVerdict: ...
