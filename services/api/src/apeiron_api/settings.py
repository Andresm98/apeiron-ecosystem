from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-insecure-secret-change-me-before-prod-0000"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APEIRON_", env_file=".env", extra="ignore"
    )

    env: str = "dev"
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:4200"]

    jwt_secret: str = DEV_SECRET
    jwt_ttl_minutes: int = 60

    llm_provider: str = "fake"  # fake | anthropic | openai | ...
    llm_model: str = "claude-sonnet-5-5"
    llm_fallback_model: str | None = None
    llm_timeout_s: float = 30.0
    llm_retries: int = 3
    breaker_failures: int = 5
    breaker_recovery_s: float = 30.0
    node_timeout_s: float = Field(default=90.0, gt=0, le=300)
    default_rounds: int = Field(default=2, ge=1, le=4)
    max_react_steps: int = Field(default=4, ge=1, le=8)
    tool_timeout_s: float = Field(default=20.0, gt=0, le=120)
    debate_participants: list[str] = Field(
        default_factory=lambda: ["anaximandro", "heraclito"], min_length=1, max_length=4
    )

    vector_backend: str = "memory"  # memory | chroma
    chroma_host: str = "chroma"
    chroma_port: int = 8000
    mcp_server_url: str | None = None

    langsmith_enabled: bool = False
    langsmith_api_key: str | None = None
    langsmith_project: str = "apeiron-ecosystem"

    @model_validator(mode="after")
    def _no_dev_secret_in_prod(self) -> "Settings":
        if self.env == "prod" and self.jwt_secret == DEV_SECRET:
            raise ValueError("APEIRON_JWT_SECRET es obligatorio en prod")
        return self
