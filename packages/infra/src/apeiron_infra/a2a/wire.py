"""Formato de cable A2A 1.0 (binding JSON-RPC, JSON de proto3 en camelCase).

Implementación propia del subconjunto que usa Ápeiron (ADR-011): servidor y cliente
comparten estas constantes y constructores, así que un cambio del protocolo se toca aquí.
"""

from datetime import UTC, datetime
from typing import Any

PROTOCOL_VERSION = "1.0"
VERSION_HEADER = "A2A-Version"
CARD_PATH = "/.well-known/agent-card.json"
BINDING = "JSONRPC"

SUBMITTED = "TASK_STATE_SUBMITTED"
WORKING = "TASK_STATE_WORKING"
COMPLETED = "TASK_STATE_COMPLETED"
FAILED = "TASK_STATE_FAILED"
CANCELED = "TASK_STATE_CANCELED"
REJECTED = "TASK_STATE_REJECTED"
TERMINAL = frozenset({COMPLETED, FAILED, CANCELED, REJECTED})

ROLE_USER = "ROLE_USER"
ROLE_AGENT = "ROLE_AGENT"

# Códigos JSON-RPC estándar y específicos de A2A.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
TASK_NOT_FOUND = -32001
TASK_NOT_CANCELABLE = -32002
UNSUPPORTED_OPERATION = -32004
VERSION_NOT_SUPPORTED = -32009


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def text_part(text: str) -> dict[str, Any]:
    return {"text": text}


def data_part(data: Any) -> dict[str, Any]:
    return {"data": data}


def message(
    role: str,
    parts: list[dict[str, Any]],
    message_id: str,
    *,
    task_id: str | None = None,
    context_id: str | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {"messageId": message_id, "role": role, "parts": parts}
    if task_id:
        out["taskId"] = task_id
    if context_id:
        out["contextId"] = context_id
    return out


def status(state: str, msg: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"state": state, "timestamp": now()}
    if msg:
        out["message"] = msg
    return out


def text_of(parts: list[dict[str, Any]] | None) -> str:
    """Concatena las partes de texto; ignora datos y ficheros."""
    return "\n".join(p["text"] for p in parts or [] if isinstance(p.get("text"), str)).strip()


def rpc_result(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def rpc_error(request_id: Any, code: int, msg: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": msg}}


def supports_version(header: str | None) -> bool:
    """Sin cabecera se asume la versión actual; con ella, solo la línea 1.x."""
    return header is None or header.strip().split(".")[0] == PROTOCOL_VERSION.split(".")[0]
