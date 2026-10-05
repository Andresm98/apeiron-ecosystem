"""Cliente A2A 1.0 y worker remoto (ADR-011, fase 3).

`A2ARemoteAgent` implementa `SpecialistAgent`: el grafo lo trata como cualquier worker
(timeout del nodo, degradación y guardrail de turno). Seguridad:
- solo hosts de la allowlist, con https (http solo para localhost): sin SSRF por la Agent Card;
- credencial propia por agente; el JWT del usuario nunca sale hacia el agente remoto;
- respuesta acotada en tamaño; enviar un mensaje no se reintenta (no es idempotente).
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator, Sequence
from typing import Any
from urllib.parse import urlsplit

import httpx

from apeiron_core.application.agents.base import dialogue_block
from apeiron_core.application.context import request_ctx
from apeiron_core.application.ports.outbound.events import Emit
from apeiron_core.domain.entities.agent_turn import AgentTurn
from apeiron_infra.a2a import wire
from apeiron_infra.resilience import CircuitBreaker, call_with_retry

log = logging.getLogger("apeiron.a2a")
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
HOPS_KEY = "apeironHops"  # metadata propia: saltos A2A acumulados en la cadena de delegación
MAX_ANSWER_CHARS = 6000
PREVIEW_CHARS = 160


class A2AClientError(RuntimeError):
    """Fallo del agente remoto o respuesta fuera de protocolo (mensaje sin datos sensibles)."""


def check_endpoint(url: str, allowed_hosts: Sequence[str]) -> str:
    """Valida esquema y host; devuelve el host. Se usa al configurar y con cada URL de la card."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if not host or host not in {h.lower() for h in allowed_hosts}:
        raise A2AClientError(f"host A2A no permitido: {host or url!r}")
    if parts.scheme != "https" and not (parts.scheme == "http" and host in LOCAL_HOSTS):
        raise A2AClientError(f"A2A exige https: {host}")
    return host


class A2AClient:
    def __init__(
        self,
        base_url: str,
        http: httpx.AsyncClient,
        allowed_hosts: Sequence[str],
        token: str | None = None,
        timeout_s: float = 90.0,
    ) -> None:
        check_endpoint(base_url, allowed_hosts)
        self._base = base_url.rstrip("/")
        self._http, self._allowed, self._token = http, list(allowed_hosts), token
        self._timeout = httpx.Timeout(timeout_s, connect=10.0)
        self._card: dict[str, Any] | None = None
        self._rpc_url = ""

    def _headers(self, stream: bool = False) -> dict[str, str]:
        headers = {wire.VERSION_HEADER: wire.PROTOCOL_VERSION}
        if stream:
            headers["Accept"] = "text/event-stream"
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    async def card(self) -> dict[str, Any]:
        """Agent Card cacheada y validada: interfaz JSON-RPC 1.x en un host permitido."""
        if self._card is not None:
            return self._card

        async def fetch() -> dict[str, Any]:
            res = await self._http.get(self._base + wire.CARD_PATH, timeout=self._timeout)
            res.raise_for_status()
            data: dict[str, Any] = res.json()
            return data

        card = await call_with_retry(fetch, attempts=2, timeout_s=15.0)
        interface = next(
            (
                i
                for i in card.get("supportedInterfaces", [])
                if i.get("protocolBinding") == wire.BINDING
                and wire.supports_version(str(i.get("protocolVersion", "")))
            ),
            None,
        )
        if interface is None:
            raise A2AClientError("la Agent Card no ofrece JSON-RPC 1.x")
        check_endpoint(interface["url"], self._allowed)
        self._rpc_url, self._card = interface["url"], card
        return card

    def _request(self, method: str, text: str, metadata: dict[str, Any]) -> dict[str, Any]:
        msg = wire.message(wire.ROLE_USER, [wire.text_part(text)], uuid.uuid4().hex)
        return {
            "jsonrpc": "2.0",
            "id": uuid.uuid4().hex,
            "method": method,
            "params": {"message": msg, "metadata": metadata},
        }

    @staticmethod
    def _result(payload: dict[str, Any]) -> dict[str, Any]:
        if "error" in payload:
            error = payload["error"] or {}
            raise A2AClientError(f"JSON-RPC {error.get('code')}: {str(error.get('message', ''))[:120]}")
        result: dict[str, Any] = payload.get("result") or {}
        return result

    async def send(self, text: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        await self.card()
        res = await self._http.post(
            self._rpc_url,
            json=self._request("SendMessage", text, metadata or {}),
            headers=self._headers(),
            timeout=self._timeout,
        )
        res.raise_for_status()
        return self._result(res.json())

    async def stream(self, text: str, metadata: dict[str, Any] | None = None) -> AsyncIterator[dict[str, Any]]:
        """`StreamResponse` uno a uno ({task} | {message} | {statusUpdate} | {artifactUpdate})."""
        await self.card()
        async with self._http.stream(
            "POST",
            self._rpc_url,
            json=self._request("SendStreamingMessage", text, metadata or {}),
            headers=self._headers(stream=True),
            timeout=self._timeout,
        ) as res:
            res.raise_for_status()
            data: list[str] = []
            async for line in res.aiter_lines():
                if line.startswith("data:"):
                    data.append(line[5:].strip())
                elif not line and data:
                    yield self._result(json.loads("\n".join(data)))
                    data = []
            if data:
                yield self._result(json.loads("\n".join(data)))


class _Outcome:
    """Acumula artefactos y estado de una tarea remota."""

    def __init__(self) -> None:
        self.state = wire.SUBMITTED
        self.status_text = ""
        self.artifacts: dict[str, dict[str, Any]] = {}
        self.direct = ""  # respuesta como Message (sin tarea)

    def task(self, task: dict[str, Any]) -> None:
        self.status(task.get("status") or {})
        for artifact in task.get("artifacts") or []:
            self.artifacts[artifact.get("artifactId", "")] = artifact

    def status(self, status: dict[str, Any]) -> None:
        self.state = status.get("state", self.state)
        self.status_text = wire.text_of((status.get("message") or {}).get("parts"))

    def artifact(self, update: dict[str, Any]) -> None:
        artifact = update.get("artifact") or {}
        key = artifact.get("artifactId", "")
        if update.get("append") and key in self.artifacts:
            self.artifacts[key].setdefault("parts", []).extend(artifact.get("parts") or [])
        else:
            self.artifacts[key] = artifact

    def answer(self) -> str:
        if self.direct:
            return self.direct
        named = [a for a in self.artifacts.values() if a.get("name") == "answer"]
        texts = [wire.text_of(a.get("parts")) for a in named or self.artifacts.values()]
        return "\n".join(t for t in texts if t) or self.status_text


class A2ARemoteAgent:
    """Worker remoto: envía la pregunta y la última posición de cada interlocutor.

    Bucles (A -> B -> A, o un agente que se llama a sí mismo): cada petición lleva
    `apeironHops`; si esta ejecución ya viene de `max_hops` saltos, no delega más.
    """

    def __init__(
        self,
        name: str,
        client: A2AClient,
        breaker: CircuitBreaker | None = None,
        metadata: dict[str, Any] | None = None,
        max_hops: int = 1,
    ) -> None:
        self.name, self.client = name, client
        self.breaker = breaker or CircuitBreaker(failure_threshold=3, recovery_timeout_s=60.0)
        self._metadata = metadata or {}
        self._max_hops = max_hops

    async def respond(self, question: str, history: list[AgentTurn], emit: Emit | None = None) -> str:
        notify: Emit = emit or (lambda _message: None)
        hops = request_ctx.get().a2a_hops
        if hops >= self._max_hops:  # no cuenta como fallo del remoto: no abre el breaker
            raise A2AClientError(f"límite de saltos A2A alcanzado ({hops}); posible bucle de delegación")
        return await self.breaker.call(lambda: self._respond(question, history, notify))

    async def _respond(self, question: str, history: list[AgentTurn], notify: Emit) -> str:
        prompt = question + dialogue_block(self.name, history)
        card = await self.client.card()
        notify(f"[{self.name} A2A → {card.get('name', 'agente remoto')}]")
        outcome = _Outcome()
        metadata = {**self._metadata, HOPS_KEY: request_ctx.get().a2a_hops + 1}
        if (card.get("capabilities") or {}).get("streaming"):
            async for event in self.client.stream(prompt, metadata):
                self._apply(outcome, event, notify)
        else:
            self._apply(outcome, await self.client.send(prompt, metadata), notify)
        if outcome.state in (wire.FAILED, wire.CANCELED, wire.REJECTED):
            raise A2AClientError(f"tarea remota en estado {outcome.state}")
        answer = outcome.answer().strip()
        if not answer:
            raise A2AClientError("el agente remoto no devolvió texto")
        return answer[:MAX_ANSWER_CHARS]

    def _apply(self, outcome: _Outcome, event: dict[str, Any], notify: Emit) -> None:
        if "task" in event:
            outcome.task(event["task"])
        elif "message" in event:
            outcome.direct = wire.text_of(event["message"].get("parts"))
        elif "statusUpdate" in event:
            outcome.status(event["statusUpdate"].get("status") or {})
            if outcome.status_text and outcome.state == wire.WORKING:
                notify(f"[{self.name} A2A: {outcome.status_text[:PREVIEW_CHARS]}]")
        elif "artifactUpdate" in event:
            outcome.artifact(event["artifactUpdate"])
