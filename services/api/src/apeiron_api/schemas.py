import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

from apeiron_core.domain.value_objects.mode import Mode


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=72)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


AGENT_PATTERN = r"^[a-z][a-z0-9_]{1,40}$"


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    mode: Mode | None = None
    max_rounds: int | None = Field(default=None, ge=1, le=4)
    simulate: bool = False  # LLM determinista: recorre todo el grafo con 0 tokens
    # Interlocutor elegido (ADR-013): fuerza el modo `single`. La ruta lo valida contra la topología.
    agent: str | None = Field(default=None, pattern=AGENT_PATTERN)
    # Mesa del debate, en orden de palabra (ADR-014): fuerza el modo `debate`. La ruta la valida contra la topología.
    participants: list[Annotated[str, Field(pattern=AGENT_PATTERN)]] | None = Field(
        default=None, min_length=1, max_length=6
    )
    # Hilo de la consola (ADR-014): los agentes ven los intercambios previos del mismo usuario en esa conversación.
    conversation_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _coherent(self) -> "ChatRequest":
        if self.agent is not None and (self.mode == "debate" or self.participants):
            raise ValueError("agent solo aplica en modo single")
        if self.participants is not None and self.mode == "single":
            raise ValueError("participants solo aplica en modo debate")
        if self.participants is not None and len(set(self.participants)) != len(self.participants):
            raise ValueError("participants no admite repetidos")
        return self


class SessionRequest(BaseModel):
    """Deliberación de la Polis (ADR-013, fase 2). Los nombres se validan contra la topología en la ruta."""

    question: str = Field(min_length=1, max_length=4000)
    mode: Mode | None = None
    agent: str | None = Field(default=None, pattern=AGENT_PATTERN)
    participants: list[Annotated[str, Field(pattern=AGENT_PATTERN)]] | None = Field(
        default=None, min_length=1, max_length=6
    )
    max_rounds: int | None = Field(default=None, ge=1, le=4)
    open_ended: bool = False
    time_budget_s: int | None = Field(default=None, ge=60, le=1800)
    pace: Literal["auto", "step"] = "auto"
    turn_delay_s: float = Field(default=0, ge=0, le=30)
    human_turn_timeout_s: int = Field(default=240, ge=30, le=600)
    simulate: bool = False

    @model_validator(mode="after")
    def _coherent(self) -> "SessionRequest":
        if self.agent is not None and (self.mode == "debate" or self.participants):
            raise ValueError("agent solo aplica en modo single")
        if self.participants is not None and len(set(self.participants)) != len(self.participants):
            raise ValueError("participants no admite repetidos")
        if self.open_ended and self.agent is not None:
            raise ValueError("open_ended solo aplica a debates")
        return self


class TurnRequest(BaseModel):
    text: str = Field(default="", max_length=4000)  # vacío = el usuario pasa su turno


class InviteRequest(BaseModel):
    agent: str = Field(pattern=AGENT_PATTERN)


class ChatResponse(BaseModel):
    answer: str
    mode: str
    turns: list[dict[str, Any]]
    trace: list[str]
    usage: dict[str, int] = Field(default_factory=dict)
