"""Timeout por intento + retries con exponential backoff y jitter."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

T = TypeVar("T")


async def call_with_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    base_delay_s: float = 0.5,
    max_delay_s: float = 8.0,
    timeout_s: float = 30.0,
    retry_on: tuple[type[BaseException], ...] = (Exception,),
) -> T:
    async for attempt in AsyncRetrying(
        stop=stop_after_attempt(attempts),
        wait=wait_exponential_jitter(initial=base_delay_s, max=max_delay_s),
        retry=retry_if_exception_type(retry_on),
        reraise=True,
    ):
        with attempt:
            async with asyncio.timeout(timeout_s):
                return await fn()
    raise RuntimeError("unreachable")
