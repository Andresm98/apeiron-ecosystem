import json
import time
from dataclasses import replace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from apeiron_core.application.context import request_ctx
from apeiron_infra.persistence.supabase_runs import RunPersistenceError, SupabaseRunRepository
from apeiron_infra.security.supabase import SupabaseTokenVerifier
from apeiron_infra.security.tokens import InvalidTokenError

URL = "https://demo.supabase.co"
SECRET = "super-secret-jwt-token-with-at-least-32-characters"
USER = "8f14e45f-ceea-467f-a8f5-0c7f2a3d9b10"


def claims(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "sub": USER,
        "aud": "authenticated",
        "iss": f"{URL}/auth/v1",
        "exp": int(time.time()) + 300,
        "role": "authenticated",
    }
    return {**base, **overrides}


def test_supabase_verifier_hs256_accepts_project_tokens_only():
    verifier = SupabaseTokenVerifier(URL, jwt_secret=SECRET)
    assert verifier.decode(jwt.encode(claims(), SECRET, algorithm="HS256")) == USER
    for bad in (
        claims(aud="anon"),
        claims(iss="https://otro.supabase.co/auth/v1"),
        claims(exp=int(time.time()) - 10),
    ):
        with pytest.raises(InvalidTokenError):
            verifier.decode(jwt.encode(bad, SECRET, algorithm="HS256"))
    with pytest.raises(InvalidTokenError):
        verifier.decode(jwt.encode(claims(), "otro-secreto-de-al-menos-32-caracteres!!", algorithm="HS256"))


def test_supabase_verifier_es256_uses_jwks_public_key():
    private = ec.generate_private_key(ec.SECP256R1())

    class StubJwks:
        def get_signing_key_from_jwt(self, token: str):
            return type("Key", (), {"key": private.public_key()})()

    verifier = SupabaseTokenVerifier(URL, jwk_client=StubJwks())
    assert verifier.decode(jwt.encode(claims(), private, algorithm="ES256")) == USER
    with pytest.raises(InvalidTokenError):  # HS256 no se acepta en modo JWKS
        verifier.decode(jwt.encode(claims(), SECRET, algorithm="HS256"))


async def test_supabase_runs_repository_uses_user_token_for_rls():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "POST":
            return httpx.Response(201)
        return httpx.Response(200, json=[{"id": "r1", "question": "q"}])

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    repo = SupabaseRunRepository(URL, "sb_publishable_x", client)

    with pytest.raises(RunPersistenceError):  # sin credencial delegada no se escribe
        await repo.list_recent()

    token = request_ctx.set(replace(request_ctx.get(), user_id=USER, access_token="user-jwt"))
    try:
        await repo.save(
            {"user_id": USER, "question": "q", "agents": [{"agent_id": "apeiron"}]}  # type: ignore[typeddict-item]
        )
        rows = await repo.list_recent(5)
        one = await repo.get("r1")
    finally:
        request_ctx.reset(token)

    insert, listing = seen[0], seen[1]
    assert str(insert.url) == f"{URL}/rest/v1/rpc/record_agent_run"  # transacción única
    assert insert.headers["apikey"] == "sb_publishable_x"
    assert insert.headers["authorization"] == "Bearer user-jwt"
    body = json.loads(insert.content)
    assert body["p_agents"] == [{"agent_id": "apeiron"}]
    assert "user_id" not in body["p_run"]  # la RPC usa auth.uid(), nunca el payload
    assert listing.url.params["user_id"] == f"eq.{USER}"
    assert listing.url.params["order"] == "created_at.desc"
    assert listing.url.params["limit"] == "5"
    assert rows == [{"id": "r1", "question": "q"}] and one == {"id": "r1", "question": "q"}


async def test_supabase_runs_repository_surfaces_http_errors():
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401, text="jwt expired")))
    repo = SupabaseRunRepository(URL, "k", client)
    token = request_ctx.set(replace(request_ctx.get(), access_token="t"))
    try:
        with pytest.raises(RunPersistenceError, match="401"):
            await repo.save({"question": "q", "agents": []})  # type: ignore[typeddict-item]
    finally:
        request_ctx.reset(token)
