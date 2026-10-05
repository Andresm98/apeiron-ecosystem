"""Servidor MCP apeiron-scholar: formato OpenAlex, cliente y protocolo MCP real en proceso (sin red)."""

import httpx
import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from apeiron_mcp_scholar.openalex import OpenAlexClient, abstract_from_index, format_works, parse_work
from apeiron_mcp_scholar.server import build_app

WORK = {
    "id": "https://openalex.org/W1",
    "doi": "https://doi.org/10.1111/j.1468-0149.1963.tb00782.x",
    "display_name": "THE  APEIRON OF ANAXIMANDER",
    "publication_year": 1963,
    "authorships": [{"author": {"display_name": f"Autor {i}"}} for i in range(4)],
    "primary_location": {"source": {"display_name": "Philosophical Books"}},
    "cited_by_count": 1,
    "abstract_inverted_index": {"apeiron": [1], "The": [0], "is": [2], "boundless": [3]},
}


class OpenAlexStub:
    def __init__(self, status: int = 200) -> None:
        self.status, self.requests = status, []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, json={"results": [WORK]})


def client(stub: OpenAlexStub, mailto: str | None = None) -> OpenAlexClient:
    return OpenAlexClient(httpx.AsyncClient(transport=httpx.MockTransport(stub)), mailto=mailto)


def test_abstract_is_rebuilt_from_the_inverted_index():
    assert abstract_from_index(WORK["abstract_inverted_index"]) == "The apeiron is boundless"
    assert abstract_from_index(None) == ""


def test_format_keeps_the_literal_doi_for_citation_grounding():
    text = format_works([parse_work(WORK)])
    assert text.startswith("- THE APEIRON OF ANAXIMANDER (1963) — Autor 0, Autor 1, Autor 2 et al.")
    assert "Philosophical Books · citado 1 vez" in text
    assert "doi:10.1111/j.1468-0149.1963.tb00782.x · https://doi.org/10.1111/j.1468-0149.1963.tb00782.x" in text
    assert text.endswith("The apeiron is boundless")
    assert format_works([]) == "Sin resultados en OpenAlex."


async def test_client_bounds_the_query_and_uses_the_polite_pool():
    stub = OpenAlexStub()
    await client(stub, mailto="ops@example.org").search("  Anaximander   apeiron " + "x" * 400, limit=50)
    params = stub.requests[0].url.params
    assert params["per-page"] == "5" and params["mailto"] == "ops@example.org"
    assert params["search"].startswith("Anaximander apeiron") and len(params["search"]) == 300
    assert await client(stub).search("   ") == [] and len(stub.requests) == 1


async def _call(app, host: str = "mcp-scholar:8080", **arguments: object) -> tuple[list[str], str]:
    async with app.router.lifespan_context(app):
        http = httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app))
        async with streamable_http_client(f"http://{host}/mcp", http_client=http) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = [t.name for t in (await session.list_tools()).tools]
                result = await session.call_tool("search", arguments)
                return tools, result.content[0].text


async def test_search_tool_over_the_real_mcp_protocol():
    tools, text = await _call(build_app(client(OpenAlexStub()), ["mcp-scholar:*"]), query="apeiron")
    assert tools == ["search"] and "doi:10.1111/j.1468-0149.1963.tb00782.x" in text


async def test_openalex_failures_become_controlled_text():
    _, text = await _call(build_app(client(OpenAlexStub(status=503)), ["mcp-scholar:*"]), query="apeiron")
    assert text == "Error: OpenAlex no disponible (HTTP 503)."


async def test_dns_rebinding_protection_rejects_foreign_hosts():
    app = build_app(client(OpenAlexStub()), ["mcp-scholar:*"])
    async with app.router.lifespan_context(app):
        http = httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://evil.example.com")
        res = await http.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            headers={"accept": "application/json, text/event-stream"},
        )
        health = await httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app)).get("http://mcp-scholar:8080/healthz")
    assert res.status_code == 421
    assert health.json() == {"status": "ok"}
