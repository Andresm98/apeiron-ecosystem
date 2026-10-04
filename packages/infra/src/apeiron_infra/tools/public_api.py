"""mcp_public_api_tool: ciencia en tiempo real vía MCP (si hay servidor) o arXiv (httpx)."""

import logging
import xml.etree.ElementTree as ET
from typing import Protocol

import httpx

from apeiron_infra.resilience import CircuitBreaker, call_with_retry

log = logging.getLogger("apeiron.tools")
_ATOM = "{http://www.w3.org/2005/Atom}"


class McpGateway(Protocol):
    async def call(self, tool: str, args: dict[str, str]) -> str: ...


class McpSdkGateway:
    """Cliente MCP (streamable HTTP). Requiere el extra [mcp]."""

    def __init__(self, url: str) -> None:
        self._url = url

    async def call(self, tool: str, args: dict[str, str]) -> str:
        from mcp import ClientSession  # import diferido
        from mcp.client.streamable_http import streamable_http_client
        from mcp.types import TextContent

        async with streamable_http_client(self._url) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool, args)
                return "\n".join(
                    content.text
                    for content in result.content
                    if isinstance(content, TextContent)
                )


class ArxivClient:
    def __init__(
        self,
        client: httpx.AsyncClient,
        base_url: str = "https://export.arxiv.org/api/query",
    ) -> None:
        self._client, self._url = client, base_url

    async def search(self, query: str, max_results: int = 3) -> list[dict[str, str]]:
        resp = await self._client.get(
            self._url,
            params={
                "search_query": f"all:{query}",
                "max_results": max_results,
                "sortBy": "submittedDate",
            },
        )
        resp.raise_for_status()
        out = []
        for entry in ET.fromstring(resp.text).findall(f"{_ATOM}entry"):
            out.append(
                {
                    "title": " ".join((entry.findtext(f"{_ATOM}title") or "").split()),
                    "published": (entry.findtext(f"{_ATOM}published") or "")[:10],
                    "url": entry.findtext(f"{_ATOM}id") or "",
                    "summary": " ".join(
                        (entry.findtext(f"{_ATOM}summary") or "").split()
                    )[:240],
                }
            )
        return out


class McpPublicApiTool:
    name = "mcp_public_api_tool"
    description = (
        "Obtiene literatura y datos científicos recientes (arXiv / servidor MCP). "
        "Entrada: consulta breve en inglés, p. ej. 'three-body problem chaos'."
    )

    def __init__(
        self,
        arxiv: ArxivClient,
        breaker: CircuitBreaker | None = None,
        mcp: McpGateway | None = None,
        mcp_tool_name: str = "search",
        timeout_s: float = 15.0,
    ) -> None:
        self._arxiv, self._mcp, self._mcp_tool = arxiv, mcp, mcp_tool_name
        self._breaker, self._timeout = breaker or CircuitBreaker(), timeout_s

    async def _fetch(self, query: str) -> str:
        if self._mcp is not None:
            return await self._mcp.call(self._mcp_tool, {"query": query})
        items = await self._arxiv.search(query)
        if not items:
            return "Sin resultados."
        return "\n".join(
            f"- {i['title']} ({i['published']}) {i['url']}\n  {i['summary']}"
            for i in items
        )

    async def run(self, tool_input: str) -> str:
        try:
            return await self._breaker.call(
                lambda: call_with_retry(
                    lambda: self._fetch(tool_input), attempts=2, timeout_s=self._timeout
                )
            )
        except Exception as exc:  # fallback: la observación informa, el agente continúa
            log.warning("public_api_unavailable", extra={"error": type(exc).__name__})
            return "Fuente externa no disponible ahora; responde con conocimiento previo e indícalo."
