"""scholarly_search: literatura académica con DOI vía el servidor MCP `apeiron-scholar` (OpenAlex).

Las referencias llegan con su DOI literal, así que el guardrail de citas (ADR-011) puede
verificar lo que el agente cite. La descripción que ve el LLM es la nuestra, fija, no la que
anuncie el servidor MCP: un servidor comprometido no puede reescribir las instrucciones.
"""

import logging

from apeiron_infra.resilience import CircuitBreaker, call_with_retry
from apeiron_infra.tools.public_api import McpGateway

log = logging.getLogger("apeiron.tools")
UNAVAILABLE = "Fuente académica no disponible ahora; responde con conocimiento previo e indícalo."


class ScholarlySearchTool:
    name = "scholarly_search"
    description = (
        "Literatura académica verificable (OpenAlex vía MCP): artículos y libros de filosofía y ciencia "
        "con año, autores, revista y DOI. Entrada: consulta breve, mejor en inglés, p. ej. "
        "'Anaximander apeiron'. Si citas, copia el DOI exactamente como aparece."
    )

    def __init__(
        self,
        gateway: McpGateway,
        breaker: CircuitBreaker | None = None,
        limit: int = 3,
        timeout_s: float = 15.0,
    ) -> None:
        self._gateway, self._limit, self._timeout = gateway, limit, timeout_s
        self.breaker = breaker or CircuitBreaker()

    async def run(self, tool_input: str) -> str:
        query = " ".join(tool_input.split())[:300]
        if not query:
            return "Error: la consulta está vacía."
        try:
            return await self.breaker.call(
                lambda: call_with_retry(
                    lambda: self._gateway.call("search", {"query": query, "limit": self._limit}),
                    attempts=2,
                    timeout_s=self._timeout,
                )
            )
        except Exception as exc:  # la observación informa y el agente continúa
            log.warning("scholarly_unavailable", extra={"error": type(exc).__name__})
            return UNAVAILABLE
