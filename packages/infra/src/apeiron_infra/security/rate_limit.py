"""Límite de tasa en proceso: ventana deslizante por clave."""

from __future__ import annotations

import time
from collections import defaultdict
from collections.abc import Callable


class SlidingWindowLimiter:
    def __init__(self, clock: Callable[[], float] | None = None) -> None:
        self._clock = clock or time.monotonic
        self._hits: dict[str, list[float]] = defaultdict(list)

    def allow(self, key: str, limit: int, window_s: float = 60.0) -> bool:
        if limit <= 0:
            return True
        now = self._clock()
        recent = [stamp for stamp in self._hits[key] if now - stamp < window_s]
        if len(recent) >= limit:
            self._hits[key] = recent
            return False
        recent.append(now)
        self._hits[key] = recent
        return True

    def remaining(self, key: str, limit: int, window_s: float = 60.0) -> int | None:
        """Peticiones que quedan en la ventana; None si no hay límite."""
        if limit <= 0:
            return None
        now = self._clock()
        return max(0, limit - sum(1 for stamp in self._hits.get(key, []) if now - stamp < window_s))
