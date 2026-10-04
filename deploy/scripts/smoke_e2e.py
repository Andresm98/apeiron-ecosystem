"""Smoke test E2E: Nginx -> auth -> chat SSE (LLM real) -> Chroma -> historial -> LangSmith.

Se ejecuta dentro del contenedor api (trae chromadb y langsmith) pero entra por Nginx,
igual que el navegador. Detecta el proveedor de identidad con /v1/auth/config:

  - local: crea un usuario aleatorio y prueba registro/login de la API.
  - supabase: inicia sesión en Supabase Auth con un usuario existente (y confirmado):

    docker compose -f deploy/docker-compose.yml exec -T \\
      -e SMOKE_EMAIL=tu@correo.com -e SMOKE_PASSWORD='...' \\
      api python - < deploy/scripts/smoke_e2e.py

Variables opcionales: SMOKE_BASE_URL (default http://web/api), SMOKE_QUESTION, SMOKE_MODE.
"""

import base64
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings

BASE = os.environ.get("SMOKE_BASE_URL", "http://web/api")
QUESTION = os.environ.get("SMOKE_QUESTION", "En una frase: ¿qué es el ápeiron?")
MODE = os.environ.get("SMOKE_MODE", "single")
failures: list[str] = []
warnings.filterwarnings("ignore", category=DeprecationWarning)


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"[{'OK' if ok else 'FAIL'}] {label}{f' -> {detail}' if detail else ''}")
    if not ok:
        failures.append(label)


def call(method: str, url: str, body: bytes | None = None, headers: dict[str, str] | None = None):
    target = url if url.startswith("http") else BASE + url
    req = urllib.request.Request(target, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def as_json(payload: dict) -> tuple[bytes, dict[str, str]]:
    return json.dumps(payload).encode(), {"Content-Type": "application/json"}


def jwt_sub(token: str) -> str:
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"]


def local_login() -> str:
    user = f"smoke-{secrets.token_hex(3)}"
    password = secrets.token_urlsafe(12)
    status, _ = call("POST", "/v1/auth/register", *as_json({"username": user, "password": password}))
    check(status == 201, "registro", f"{user} {status}")
    status, _ = call("POST", "/v1/auth/register", *as_json({"username": user, "password": password}))
    check(status == 409, "registro duplicado rechazado", str(status))
    form_type = {"Content-Type": "application/x-www-form-urlencoded"}
    bad = urllib.parse.urlencode({"username": user, "password": "incorrecta"}).encode()
    status, _ = call("POST", "/v1/auth/token", bad, form_type)
    check(status == 401, "password incorrecta rechazada", str(status))
    good = urllib.parse.urlencode({"username": user, "password": password}).encode()
    status, raw = call("POST", "/v1/auth/token", good, form_type)
    check(status == 200, "login local", str(status))
    if status != 200:
        sys.exit(f"login falló: {raw}")
    return json.loads(raw)["access_token"]


def supabase_login(cfg: dict) -> str:
    email, password = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
    if not (email and password):
        sys.exit("Modo supabase: define SMOKE_EMAIL y SMOKE_PASSWORD de un usuario confirmado.")
    status, _ = call("POST", "/v1/auth/register", *as_json({"username": "x", "password": "y" * 8}))
    check(status == 404, "registro local deshabilitado", str(status))
    endpoint = f"{cfg['supabase_url'].rstrip('/')}/auth/v1/token?grant_type=password"
    headers = {"Content-Type": "application/json", "apikey": cfg["supabase_key"]}
    status, _ = call("POST", endpoint, json.dumps({"email": email, "password": "incorrecta-123"}).encode(), headers)
    check(status == 400, "Supabase rechaza password incorrecta", str(status))
    status, raw = call("POST", endpoint, json.dumps({"email": email, "password": password}).encode(), headers)
    check(status == 200, "login en Supabase Auth", f"{email} {status}")
    if status != 200:
        sys.exit(f"login Supabase falló: {raw[:300]}")
    return json.loads(raw)["access_token"]


# 1. Autenticación
status, _ = call("GET", "/healthz")
check(status == 200, "healthz vía Nginx", str(status))
status, raw = call("GET", "/v1/auth/config")
cfg = json.loads(raw)
print(f"       proveedor de identidad: {cfg['provider']} · historial: {cfg['runs_enabled']}")
status, _ = call("POST", "/v1/chat", *as_json({"question": "hola"}))
check(status == 401, "chat sin token rechazado", str(status))
token = supabase_login(cfg) if cfg["provider"] == "supabase" else local_login()
user = jwt_sub(token)
auth = {"Authorization": f"Bearer {token}"}
status, _ = call("GET", "/v1/agents", headers={"Authorization": f"Bearer {token}x"})
check(status == 401, "token alterado rechazado", str(status))
status, _ = call("GET", "/v1/agents", headers=auth)
check(status == 200, "API acepta el token", f"user_id={user}")

# 2. Chat por SSE con el LLM configurado
body, headers = as_json({"question": QUESTION, "mode": MODE, "max_rounds": 1})
started = time.perf_counter()
status, stream = call("POST", "/v1/chat/stream", body, {**headers, **auth})
events = [line[7:] for line in stream.splitlines() if line.startswith("event: ")]
answer = ""
for block in stream.split("\n\n"):
    if block.startswith("event: answer"):
        answer = json.loads(block.split("data: ", 1)[1])["answer"]
check(status == 200 and "error" not in events, "stream SSE", f"{status} eventos={sorted(set(events))}")
check(bool(answer.strip()), "respuesta no vacía", f"{time.perf_counter() - started:.1f}s: {answer[:160]!r}")

# 3. Memoria del usuario en Chroma
import chromadb  # noqa: E402

col = chromadb.HttpClient(
    host=os.environ.get("APEIRON_CHROMA_HOST", "chroma"),
    port=int(os.environ.get("APEIRON_CHROMA_PORT", "8000")),
).get_collection("apeiron_memory")
docs = col.get(where={"user_id": user}, include=["documents"])["documents"] or []
check(any(QUESTION in d for d in docs), "memoria guardada en Chroma", f"{len(docs)} docs de {user}")

# 4. Historial de ejecuciones (Supabase)
if cfg["runs_enabled"]:
    status, raw = call("GET", "/v1/runs?limit=5", headers=auth)
    runs = json.loads(raw) if status == 200 else []
    latest = runs[0] if runs else {}
    check(
        status == 200 and latest.get("question") == QUESTION,
        "ejecución guardada en Supabase",
        f"{status} {latest.get('id', '-')}",
    )
    if latest:
        status, raw = call("GET", f"/v1/runs/{latest['id']}", headers=auth)
        check(status == 200 and json.loads(raw)["answer"] == answer, "detalle de la ejecución", str(status))
else:
    print("[SKIP] historial deshabilitado (requiere APEIRON_AUTH_PROVIDER=supabase)")

# 5. Traza en LangSmith
if os.environ.get("APEIRON_LANGSMITH_ENABLED", "").lower() == "true":
    from langsmith import Client

    project = os.environ.get("APEIRON_LANGSMITH_PROJECT", "apeiron-ecosystem").strip('"')
    client = Client(api_key=os.environ["APEIRON_LANGSMITH_API_KEY"])
    found = None
    for _ in range(10):  # la ingesta de LangSmith es asíncrona
        for run in client.list_runs(project_name=project, is_root=True, limit=20):
            if (run.extra or {}).get("metadata", {}).get("user_id") == user:
                found = run
                break
        if found:
            break
        time.sleep(3)
    check(found is not None, "traza en LangSmith", f"{project}: {found.name if found else 'no encontrada'}")
else:
    print("[SKIP] LangSmith deshabilitado (APEIRON_LANGSMITH_ENABLED != true)")

print("\nRESULTADO:", "OK" if not failures else f"FALLOS {failures}")
sys.exit(1 if failures else 0)
