"""Contexto de ejecución propagado dentro de una petición."""

from contextvars import ContextVar
from dataclasses import dataclass, field


@dataclass(frozen=True)
class RequestContext:
    user_id: str = "anonymous"
    session_id: str = "default"
    trace_id: str = "-"
    channel: str = "web"  # web (API propia) | a2a (otro agente vía protocolo A2A)
    a2a_task_id: str | None = None
    a2a_hops: int = 0  # saltos A2A que preceden a esta ejecución (protección contra bucles)
    # Credencial delegada del usuario para adaptadores que aplican RLS (Supabase).
    # Opaca para el núcleo; nunca se registra ni aparece en repr().
    access_token: str | None = field(default=None, repr=False)


request_ctx: ContextVar[RequestContext] = ContextVar(
    "request_ctx", default=RequestContext()  # noqa: B039 (dataclass frozen)
)
