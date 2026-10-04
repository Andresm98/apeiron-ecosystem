"""Contexto de petición propagado por ContextVar (user, sesión, trace)."""
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class RequestContext:
    user_id: str = "anonymous"
    session_id: str = "default"
    trace_id: str = "-"


request_ctx: ContextVar[RequestContext] = ContextVar("request_ctx", default=RequestContext())  # noqa: B039 (dataclass frozen)
