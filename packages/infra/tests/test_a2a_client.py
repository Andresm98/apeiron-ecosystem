"""Cliente A2A y worker remoto (ADR-011, fase 3), con un servidor simulado (sin red)."""

import json

import httpx
import pytest

from apeiron_infra.a2a import wire
from apeiron_infra.a2a.client import A2AClient, A2AClientError, A2ARemoteAgent, check_endpoint

BASE = "https://sophos.example.org"
RPC = f"{BASE}/a2a"


def card(streaming: bool = True, url: str = RPC) -> dict:
    return {
        "name": "Sophos",
        "supportedInterfaces": [{"url": url, "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}],
        "capabilities": {"streaming": streaming},
    }


def sse(*results: dict) -> str:
    return "".join(f"data: {json.dumps({'jsonrpc': '2.0', 'id': '1', 'result': r})}\n\n" for r in results)


def status(state: str, text: str = "") -> dict:
    msg = {"messageId": "m", "role": wire.ROLE_AGENT, "parts": [{"text": text}]} if text else None
    return {"statusUpdate": {"taskId": "t", "contextId": "c", "status": wire.status(state, msg)}}


def artifact(name: str, text: str, append: bool = False) -> dict:
    return {
        "artifactUpdate": {
            "taskId": "t",
            "contextId": "c",
            "artifact": {"artifactId": name, "name": name, "parts": [{"text": text}]},
            "append": append,
        }
    }


class Remote:
    """Servidor A2A falso: registra las peticiones y responde con lo programado."""

    def __init__(self, agent_card: dict, stream_body: str = "", send_result: dict | None = None) -> None:
        self.card, self.stream_body, self.send_result = agent_card, stream_body, send_result
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == wire.CARD_PATH:
            return httpx.Response(200, json=self.card)
        body = json.loads(request.content)
        if body["method"] == "SendStreamingMessage":
            return httpx.Response(200, text=self.stream_body, headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": self.send_result})


def agent(remote: Remote, token: str | None = "tok-sophos") -> A2ARemoteAgent:
    http = httpx.AsyncClient(transport=httpx.MockTransport(remote))
    return A2ARemoteAgent("sophos", A2AClient(BASE, http, ["sophos.example.org"], token=token))


def test_endpoint_policy_blocks_ssrf_and_plain_http():
    assert check_endpoint(BASE, ["sophos.example.org"]) == "sophos.example.org"
    assert check_endpoint("http://localhost:9000", ["localhost"]) == "localhost"
    with pytest.raises(A2AClientError, match="no permitido"):
        check_endpoint("https://evil.example.com", ["sophos.example.org"])
    with pytest.raises(A2AClientError, match="https"):
        check_endpoint("http://sophos.example.org", ["sophos.example.org"])


async def test_streaming_turn_uses_answer_artifact_and_own_credentials():
    remote = Remote(
        card(),
        sse(
            {"task": {"id": "t", "contextId": "c", "status": wire.status(wire.SUBMITTED)}},
            status(wire.WORKING, "consultando fuentes"),
            artifact("notes", "borrador interno"),
            artifact("answer", "La virtud es conocimiento."),
            status(wire.COMPLETED, "La virtud es conocimiento."),
        ),
    )
    trace: list[str] = []
    history = [{"agent": "anaximandro", "round": 0, "text": "Todo surge del ápeiron.", "degraded": False}]
    answer = await agent(remote).respond("¿Qué es la virtud?", history, trace.append)  # type: ignore[arg-type]
    assert answer == "La virtud es conocimiento."
    assert trace == ["[sophos A2A → Sophos]", "[sophos A2A: consultando fuentes]"]
    rpc = remote.requests[-1]
    assert rpc.headers["authorization"] == "Bearer tok-sophos" and rpc.headers[wire.VERSION_HEADER] == "1.0"
    sent = json.loads(rpc.content)
    assert sent["method"] == "SendStreamingMessage"
    assert "Todo surge del ápeiron." in sent["params"]["message"]["parts"][0]["text"]  # le llega el diálogo


async def test_non_streaming_agent_uses_send_message():
    task = {
        "id": "t",
        "contextId": "c",
        "status": wire.status(wire.COMPLETED),
        "artifacts": [{"artifactId": "a", "name": "answer", "parts": [{"text": "Conócete a ti mismo."}]}],
    }
    remote = Remote(card(streaming=False), send_result={"task": task})
    assert await agent(remote, token=None).respond("¿Qué hacer?", []) == "Conócete a ti mismo."
    assert "authorization" not in remote.requests[-1].headers


async def test_card_pointing_to_another_host_is_rejected():
    remote = Remote(card(url="https://attacker.example.com/a2a"))
    with pytest.raises(A2AClientError, match="no permitido"):
        await agent(remote).respond("q", [])
    assert all(r.url.host == "sophos.example.org" for r in remote.requests)


async def test_failed_remote_task_raises_and_opens_the_breaker():
    remote = Remote(card(), sse(status(wire.FAILED, "sin cuota")))
    worker = agent(remote)
    for _ in range(3):
        with pytest.raises(A2AClientError, match="TASK_STATE_FAILED"):
            await worker.respond("q", [])
    assert worker.breaker.state == "open"


async def test_jsonrpc_error_is_reported_without_crashing_the_parser():
    error = json.dumps({"jsonrpc": "2.0", "id": "1", "error": {"code": -32602, "message": "texto vacío"}})
    remote = Remote(card(), f"data: {error}\n\n")
    with pytest.raises(A2AClientError, match="-32602"):
        await agent(remote).respond("q", [])


async def test_hop_limit_stops_delegation_loops_without_calling_the_remote():
    from dataclasses import replace

    from apeiron_core.application.context import request_ctx

    remote = Remote(card(), sse(artifact("answer", "ok"), status(wire.COMPLETED)))
    worker = agent(remote)
    assert await worker.respond("q", []) == "ok"
    assert json.loads(remote.requests[-1].content)["params"]["metadata"] == {"apeironHops": 1}

    token = request_ctx.set(replace(request_ctx.get(), a2a_hops=1))  # esta ejecución ya llegó por A2A
    try:
        sent = len(remote.requests)
        with pytest.raises(A2AClientError, match="saltos"):
            await worker.respond("q", [])
        assert len(remote.requests) == sent and worker.breaker.state == "closed"
    finally:
        request_ctx.reset(token)
