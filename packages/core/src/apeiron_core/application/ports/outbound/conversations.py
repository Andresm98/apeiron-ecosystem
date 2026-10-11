"""Puerto de salida: intercambios previos de una conversación de la consola (ADR-014)."""

from typing import Protocol, TypedDict


class ConversationExchange(TypedDict):
    """Una pregunta del usuario y la respuesta final de Ápeiron (síntesis o turno único)."""

    question: str
    answer: str
    mode: str


class ConversationPort(Protocol):
    async def exchanges(self, conversation_id: str, limit: int = 6) -> list[ConversationExchange]:
        """Últimos `limit` intercambios del usuario actual en esa conversación, del más antiguo al más reciente."""
        ...

    async def append(self, conversation_id: str, exchange: ConversationExchange) -> None:
        """Registra un intercambio completado. Un adaptador durable puede no hacer nada (ya lo guarda el run)."""
        ...
