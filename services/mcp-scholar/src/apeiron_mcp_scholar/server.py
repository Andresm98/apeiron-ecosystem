"""Servidor MCP `apeiron-scholar` (streamable HTTP): literatura académica de OpenAlex con DOI.

Servicio interno de Compose (sin puerto publicado): lo consume la herramienta
`scholarly_search` de Ápeiron (ADR-011). Sin estado; errores como texto controlado.
"""

import logging
import os

import httpx
import uvicorn
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse

from apeiron_mcp_scholar.openalex import OpenAlexClient, format_works

log = logging.getLogger("apeiron.mcp_scholar")
DEFAULT_ALLOWED_HOSTS = "mcp-scholar:*,localhost:*,127.0.0.1:*"
SEARCH_DESCRIPTION = (
    "Busca artículos y libros académicos (filosofía, historia de la ciencia, física...) en OpenAlex. "
    "Devuelve título, año, autores, revista, citas, DOI y un extracto del resumen. "
    "Entrada: consulta breve (inglés da más resultados); limit de 1 a 5."
)


def build_server(client: OpenAlexClient) -> MCPServer:
    server = MCPServer("apeiron-scholar", instructions="Literatura académica verificable (OpenAlex, con DOI).")

    @server.tool(name="search", description=SEARCH_DESCRIPTION)
    async def search(query: str, limit: int = 3) -> str:
        try:
            return format_works(await client.search(query, limit))
        except httpx.HTTPStatusError as exc:
            log.warning("openalex_failed", extra={"status": exc.response.status_code})
            return f"Error: OpenAlex no disponible (HTTP {exc.response.status_code})."
        except httpx.HTTPError as exc:
            log.warning("openalex_failed", extra={"error": type(exc).__name__})
            return "Error: OpenAlex no disponible (sin conexión)."

    return server


async def healthz(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


def build_app(client: OpenAlexClient, allowed_hosts: list[str]) -> Starlette:
    """App ASGI: `/mcp` (streamable HTTP sin estado, respuestas JSON) y `/healthz`."""
    app = build_server(client).streamable_http_app(
        stateless_http=True,
        json_response=True,
        # Protección DNS rebinding: solo los nombres con los que se le llama dentro de Compose.
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True, allowed_hosts=allowed_hosts, allowed_origins=[]
        ),
        host="0.0.0.0",
    )
    app.add_route("/healthz", healthz, methods=["GET"])
    return app


def main() -> None:
    logging.basicConfig(level=os.environ.get("APEIRON_LOG_LEVEL", "INFO"))
    http = httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "apeiron-scholar/0.1"})
    client = OpenAlexClient(http, mailto=os.environ.get("APEIRON_OPENALEX_MAILTO") or None)
    hosts = os.environ.get("APEIRON_SCHOLAR_ALLOWED_HOSTS", DEFAULT_ALLOWED_HOSTS).split(",")
    app = build_app(client, [h.strip() for h in hosts if h.strip()])
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("APEIRON_SCHOLAR_PORT", "8080")))
