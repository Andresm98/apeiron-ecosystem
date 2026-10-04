from typing import Any

from pydantic import BaseModel, Field

from apeiron_core.domain.value_objects.mode import Mode


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=72)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    mode: Mode | None = None
    max_rounds: int | None = Field(default=None, ge=1, le=4)


class ChatResponse(BaseModel):
    answer: str
    mode: str
    turns: list[dict[str, Any]]
    trace: list[str]
