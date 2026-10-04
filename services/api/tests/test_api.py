import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from apeiron_api.main import create_app
from apeiron_api.settings import Settings


@pytest.fixture
def client():
    settings = Settings(
        _env_file=None,
        simulation_pace_s=0,
        llm_provider="fake",
        vector_backend="memory",
        jwt_secret="test-secret-test-secret-test-secret-0000",
    )
    with TestClient(create_app(settings)) as c:
        yield c


def auth_headers(client: TestClient) -> dict[str, str]:
    client.post(
        "/v1/auth/register",
        json={"username": "santiago", "password": "clave-larga-123"},
    )
    r = client.post(
        "/v1/auth/token", data={"username": "santiago", "password": "clave-larga-123"}
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_health_and_trace_header(client):
    r = client.get("/healthz", headers={"x-trace-id": "abc123"})
    assert r.json() == {"status": "ok"} and r.headers["x-trace-id"] == "abc123"


def test_auth_required_and_bad_credentials(client):
    assert client.post("/v1/chat", json={"question": "hola"}).status_code == 401
    assert (
        client.post(
            "/v1/auth/token", data={"username": "x", "password": "y"}
        ).status_code
        == 401
    )


def test_duplicate_registration_conflicts(client):
    body = {"username": "dup-user", "password": "clave-larga-123"}
    assert client.post("/v1/auth/register", json=body).status_code == 201
    assert client.post("/v1/auth/register", json=body).status_code == 409


def test_chat_debate_returns_turns_and_trace(client):
    r = client.post(
        "/v1/chat",
        json={"question": "tres cuerpos", "mode": "debate", "max_rounds": 1},
        headers=auth_headers(client),
    )
    body = r.json()
    assert r.status_code == 200 and body["mode"] == "debate" and len(body["turns"]) == 2
    assert (
        body["trace"][0] == "[Ápeiron Routing]" and body["trace"][-1] == "[Synthesis]"
    )


def test_chat_stream_sse_contract(client):
    with client.stream(
        "POST",
        "/v1/chat/stream",
        json={"question": "Debate: Fermi", "max_rounds": 1},
        headers=auth_headers(client),
    ) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        frames = [f for f in r.read().decode().split("\n\n") if f]
    events = [f.splitlines()[0].removeprefix("event: ") for f in frames]
    assert events[0] == "node" and events[-1] == "answer" and events.count("turn") == 2
    assert "trace" in events
    assert (
        json.loads(frames[-1].splitlines()[1].removeprefix("data: "))["mode"]
        == "debate"
    )


def test_simulated_stream_walks_full_graph_without_tokens(client):
    with client.stream(
        "POST",
        "/v1/chat/stream",
        json={"question": "Debate: Fermi", "mode": "debate", "max_rounds": 1, "simulate": True},
        headers=auth_headers(client),
    ) as r:
        frames = [f for f in r.read().decode().split("\n\n") if f]
    parsed = [
        (f.splitlines()[0].removeprefix("event: "), json.loads(f.splitlines()[1][6:]))
        for f in frames
    ]
    nodes = {data["node"] for kind, data in parsed if kind == "node"}
    assert {"apeiron_router", "apeiron_supervisor", "apeiron_synthesis"} <= nodes
    assert {"anaximandro/act", "heraclito/act"} <= nodes  # ciclo ReAct con tool
    answer = parsed[-1][1]
    assert answer["simulate"] is True and answer["usage"]["total_tokens"] == 0
    assert answer["usage"]["calls"] == 5  # 2 pasos x 2 workers + síntesis


def test_agents_endpoint_describes_topology(client):
    body = client.get("/v1/agents", headers=auth_headers(client)).json()
    assert body["orchestrator"] == "apeiron"
    assert [a["name"] for a in body["agents"]] == ["anaximandro", "heraclito"]
    assert body["debate_participants"] == ["anaximandro", "heraclito"]


def test_validation_rejects_bad_rounds(client):
    r = client.post(
        "/v1/chat",
        json={"question": "x", "max_rounds": 99},
        headers=auth_headers(client),
    )
    assert r.status_code == 422


@pytest.mark.parametrize(
    "override",
    [
        {"default_rounds": 0},
        {"default_rounds": 5},
        {"node_timeout_s": 301},
        {"max_react_steps": 9},
        {"tool_timeout_s": 121},
        {"debate_participants": []},
    ],
)
def test_runtime_settings_enforce_hard_limits(override):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **override)
