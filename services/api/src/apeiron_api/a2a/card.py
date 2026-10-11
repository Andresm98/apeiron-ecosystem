"""Agent Cards A2A 1.0: la de Ápeiron (orquestador) y una por agente del catálogo con `a2a = true` (ADR-013)."""

from collections.abc import Iterable
from typing import Any

from apeiron_api.settings import Settings
from apeiron_core.domain.entities.agent_spec import AgentSpec
from apeiron_infra.a2a import wire

API_VERSION = "0.3.0"
AGENTS_PATH = "/a2a/agents"

_SECURITY: dict[str, Any] = {
    "securitySchemes": {
        "bearer": {
            "httpAuthSecurityScheme": {
                "scheme": "Bearer",
                "bearerFormat": "JWT",
                "description": "Access token de Supabase Auth (o JWT local en desarrollo).",
            }
        }
    },
    "securityRequirements": [{"schemes": {"bearer": {"list": []}}}],
}


def _public_base(s: Settings, base_url: str) -> str:
    return (s.a2a_public_url or base_url).rstrip("/")


def rpc_url(s: Settings, base_url: str, agent: str | None = None) -> str:
    """URL pública del endpoint JSON-RPC: `APEIRON_A2A_PUBLIC_URL` o la de la propia petición."""
    base = _public_base(s, base_url)
    return f"{base}{AGENTS_PATH}/{agent}" if agent else f"{base}/a2a"


def _interface(url: str) -> dict[str, Any]:
    return {"url": url, "protocolBinding": wire.BINDING, "protocolVersion": wire.PROTOCOL_VERSION}


def worker_card(s: Settings, spec: AgentSpec, base_url: str) -> dict[str, Any]:
    """Card de un agente del catálogo: se le habla directamente, sin debate (modo single con ese agente).

    Se sirve en `/a2a/agents/<nombre>/.well-known/agent-card.json`, así que otro Ápeiron puede sumarlo como
    worker remoto con `APEIRON_A2A_REMOTE_AGENTS` apuntando a `/a2a/agents/<nombre>`.
    """
    return {
        "name": spec.display_name,
        "description": f"{spec.card.description} Rol en Ápeiron: {spec.role}",
        "supportedInterfaces": [_interface(rpc_url(s, base_url, spec.name))],
        "provider": {"organization": "Ápeiron", "url": _public_base(s, base_url)},
        "version": spec.version,
        "capabilities": {"streaming": True, "pushNotifications": False},
        **_SECURITY,
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain", "application/json"],
        "skills": [
            {
                "id": spec.name,
                "name": spec.display_name,
                "description": spec.card.description,
                "tags": list(spec.card.tags),
                "examples": list(spec.card.examples),
            }
        ],
    }


def agent_card(
    s: Settings, topology: dict[str, Any], base_url: str, catalog: Iterable[AgentSpec] = ()
) -> dict[str, Any]:
    workers = ", ".join(str(a["name"]) for a in topology["agents"])
    return {
        "name": "Ápeiron",
        "description": (
            "Orquestador multiagente de razonamiento filosófico-científico. Delega en workers ReAct "
            f"({workers}) con lógica formal, literatura científica y memoria vectorial, y sintetiza."
        ),
        "supportedInterfaces": [_interface(rpc_url(s, base_url))],
        "version": API_VERSION,
        "capabilities": {"streaming": True, "pushNotifications": False},
        **_SECURITY,
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain", "application/json"],
        "skills": [
            {
                "id": "apeiron_single",
                "name": "Consulta",
                "description": (
                    "Ápeiron elige al worker más adecuado y responde con evidencia. "
                    "metadata: {mode: 'single', simulate?: bool}."
                ),
                "tags": ["filosofía", "ciencia", "react"],
                "examples": ["¿Qué es el ápeiron de Anaximandro?"],
            },
            {
                "id": "apeiron_debate",
                "name": "Debate dialéctico",
                "description": (
                    "Los workers debaten por turnos y Ápeiron sintetiza acuerdos y desacuerdos. "
                    "metadata: {mode: 'debate', maxRounds?: 1-4, simulate?: bool}."
                ),
                "tags": ["debate", "multiagente", "síntesis"],
                "examples": ["Debate: ¿el cambio es la sustancia del cosmos?"],
            },
            # Cada agente publicado tiene además su propia card y endpoint (ADR-013, catálogo de agentes).
            *(
                {
                    "id": f"agent_{spec.name}",
                    "name": spec.display_name,
                    "description": f"{spec.card.description} Card propia: {AGENTS_PATH}/{spec.name}{wire.CARD_PATH}",
                    "tags": list(spec.card.tags),
                    "examples": list(spec.card.examples),
                }
                for spec in catalog
                if spec.a2a
            ),
        ],
    }
