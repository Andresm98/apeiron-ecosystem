import time

import jwt
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from apeiron_api.main import create_app
from apeiron_api.settings import Settings

URL = "https://demo.supabase.co"
SECRET = "super-secret-jwt-token-with-at-least-32-characters"
USER = "8f14e45f-ceea-467f-a8f5-0c7f2a3d9b10"


class MemoryRuns:
    def __init__(self) -> None:
        self.saved: list[dict] = []

    async def save(self, run) -> None:
        self.saved.append(dict(run))

    async def list_recent(self, limit: int = 20):
        return [{"id": "11111111-1111-1111-1111-111111111111", "question": r["question"]} for r in self.saved]

    async def get(self, run_id: str):
        return {"id": run_id, **self.saved[0]} if self.saved else None


def supabase_token(**overrides: object) -> str:
    claims = {"sub": USER, "aud": "authenticated", "iss": f"{URL}/auth/v1", "exp": int(time.time()) + 300}
    return jwt.encode({**claims, **overrides}, SECRET, algorithm="HS256")


@pytest.fixture
def client():
    settings = Settings(
        _env_file=None,
        auth_provider="supabase",
        supabase_url=URL,
        supabase_publishable_key="sb_publishable_test",
        supabase_jwt_secret=SECRET,
        llm_provider="fake",
        vector_backend="memory",
        simulation_pace_s=0,
    )
    with TestClient(create_app(settings)) as c:
        c.app.state.container.facade._runs = MemoryRuns()  # sin red: repositorio en memoria
        c.app.state.container.runs = c.app.state.container.facade._runs
        yield c


def test_config_exposes_public_supabase_settings_only(client):
    body = client.get("/v1/auth/config").json()
    assert body == {
        "provider": "supabase",
        "public_register": True,
        "runs_enabled": True,
        "supabase_url": URL,
        "supabase_key": "sb_publishable_test",
    }


def test_local_auth_endpoints_are_disabled(client):
    assert client.post("/v1/auth/register", json={"username": "ana", "password": "clave-larga-123"}).status_code == 404
    assert client.post("/v1/auth/token", data={"username": "ana", "password": "x"}).status_code == 404


def test_supabase_jwt_authorizes_and_rejects(client):
    ok = {"Authorization": f"Bearer {supabase_token()}"}
    assert client.get("/v1/agents", headers=ok).status_code == 200
    for bad in (supabase_token(aud="anon"), supabase_token(exp=int(time.time()) - 5), "basura"):
        assert client.get("/v1/agents", headers={"Authorization": f"Bearer {bad}"}).status_code == 401


def test_chat_run_is_persisted_and_listed_for_the_user(client):
    headers = {"Authorization": f"Bearer {supabase_token()}"}
    r = client.post("/v1/chat", json={"question": "¿Qué es el ápeiron?", "simulate": True}, headers=headers)
    assert r.status_code == 200
    saved = client.app.state.container.runs.saved
    assert saved[0]["user_id"] == USER and saved[0]["simulate"] is True
    listing = client.get("/v1/runs", headers=headers).json()
    assert listing[0]["question"] == "¿Qué es el ápeiron?"
    detail = client.get(f"/v1/runs/{listing[0]['id']}", headers=headers)
    assert detail.status_code == 200 and detail.json()["status"] == "completed"
    assert client.get("/v1/runs/no-es-uuid", headers=headers).status_code == 422


def test_supabase_provider_requires_url_and_key():
    with pytest.raises(ValidationError, match="APEIRON_SUPABASE_URL"):
        Settings(_env_file=None, auth_provider="supabase")
