"""Decorador de resiliencia: breaker( retry( timeout(primary) ) ) -> fallback."""

import logging

from apeiron_core.application.ports.outbound.llm import LLMPort
from apeiron_infra.resilience import CircuitBreaker, call_with_retry

log = logging.getLogger("apeiron.llm")


class ResilientLLM:
    def __init__(
        self,
        primary: LLMPort,
        fallback: LLMPort | None = None,
        breaker: CircuitBreaker | None = None,
        attempts: int = 3,
        base_delay_s: float = 0.5,
        timeout_s: float = 30.0,
    ) -> None:
        self._primary, self._fallback = primary, fallback
        self._breaker = breaker or CircuitBreaker()
        self._attempts, self._base_delay, self._timeout = (
            attempts,
            base_delay_s,
            timeout_s,
        )

    async def complete(self, system: str, user: str) -> str:
        try:
            return await self._breaker.call(
                lambda: call_with_retry(
                    lambda: self._primary.complete(system, user),
                    attempts=self._attempts,
                    base_delay_s=self._base_delay,
                    timeout_s=self._timeout,
                )
            )
        except Exception as exc:
            log.warning(
                "llm_primary_failed",
                extra={
                    "error": type(exc).__name__,
                    "breaker_state": self._breaker.state,
                },
            )
            if self._fallback is None:
                raise
            return await self._fallback.complete(system, user)
