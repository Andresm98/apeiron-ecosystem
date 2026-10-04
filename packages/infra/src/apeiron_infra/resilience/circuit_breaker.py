"""Circuit Breaker asíncrono: closed -> open -> half_open -> closed."""
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

T = TypeVar("T")


class CircuitOpenError(RuntimeError):
    """El circuito está abierto: la dependencia se considera caída."""


class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout_s: float = 30.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._threshold = failure_threshold
        self._recovery = recovery_timeout_s
        self._clock = clock
        self._failures = 0
        self._opened_at: float | None = None

    @property
    def state(self) -> str:
        if self._opened_at is None:
            return "closed"
        return "half_open" if self._clock() - self._opened_at >= self._recovery else "open"

    async def call(self, fn: Callable[[], Awaitable[T]]) -> T:
        if self.state == "open":
            raise CircuitOpenError("circuit open")
        was_half_open = self.state == "half_open"
        try:
            result = await fn()
        except Exception:
            self._failures += 1
            if was_half_open or self._failures >= self._threshold:
                self._opened_at = self._clock()
            raise
        self._failures, self._opened_at = 0, None
        return result
