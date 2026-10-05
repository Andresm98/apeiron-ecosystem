"""Agent Card A2A 1.0 de Ápeiron, derivada de la topología publicada."""

from typing import Any

from apeiron_api.settings import Settings
from apeiron_infra.a2a import wire

API_VERSION = "0.3.0"


def rpc_url(s: Settings, base_url: str) -> str:
    """URL pública del endpoint JSON-RPC: `APEIRON_A2A_PUBLIC_URL` o la de la propia petición."""
    return (s.a2a_public_url or base_url).rstrip("/") + "/a2a"


def agent_card(s: Settings, topology: dict[str, Any], base_url: str) -> dict[str, Any]:
    workers = ", ".join(str(a["name"]) for a in topology["agents"])
    return {
        "name": "Ápeiron",
        "description": (
            "Orquestador multiagente de razonamiento filosófico-científico. Delega en workers ReAct "
            f"({workers}) con lógica formal, literatura científica y memoria vectorial, y sintetiza."
        ),
        "supportedInterfaces": [
            {"url": rpc_url(s, base_url), "protocolBinding": wire.BINDING, "protocolVersion": wire.PROTOCOL_VERSION}
        ],
        "version": API_VERSION,
        "capabilities": {"streaming": True, "pushNotifications": False},
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
        ],
    }
