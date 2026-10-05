import re
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-insecure-secret-change-me-before-prod-0000"


AGENT_ID = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
TOKEN_ENV = re.compile(r"^APEIRON_A2A_TOKEN_[A-Z0-9_]+$")


class RemoteAgentConfig(BaseModel):
    """Worker remoto A2A (ADR-011): `token_env` nombra la variable con su credencial propia."""

    name: str
    url: str
    role: str = "Worker remoto vía A2A."
    token_env: str | None = None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APEIRON_",
        env_file=".env",
        extra="ignore",
        hide_input_in_errors=True,  # un error de arranque no debe volcar secretos al log
    )

    env: str = "dev"
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:4200"]

    # Identidad y sesiones: "supabase" (Supabase Auth) o "local" (SQLite + JWT propio).
    auth_provider: Literal["local", "supabase"] = "local"
    supabase_url: str = ""
    supabase_publishable_key: str = ""  # sb_publishable_... o anon (legacy); es pública
    supabase_jwt_secret: str | None = None  # solo proyectos con JWT HS256 legacy
    persist_runs: bool = True  # guarda ejecuciones en Supabase (requiere auth supabase)

    jwt_secret: str = DEV_SECRET
    jwt_secret_previous: str | None = None
    jwt_ttl_minutes: int = 60
    public_register: bool = True
    users_db_path: str = ""
    auth_rate_limit_per_min: int = Field(default=20, ge=0, le=1000)
    chat_rate_limit_per_min: int = Field(default=30, ge=0, le=1000)

    llm_provider: str = "fake"  # fake | anthropic | openai | ...
    llm_model: str = "claude-sonnet-5"
    llm_fallback_model: str | None = None
    llm_max_tokens: int = Field(default=1500, ge=64, le=16_000)
    llm_reasoning_effort: str | None = None  # none | minimal | low | medium | high
    simulation_pace_s: float = Field(default=0.6, ge=0, le=5)  # ritmo visible del modo simulación
    llm_timeout_s: float = 30.0
    llm_retries: int = 3
    breaker_failures: int = 5
    breaker_recovery_s: float = 30.0
    node_timeout_s: float = Field(default=90.0, gt=0, le=300)
    default_rounds: int = Field(default=2, ge=1, le=4)
    max_react_steps: int = Field(default=4, ge=1, le=8)
    tool_timeout_s: float = Field(default=20.0, gt=0, le=120)
    # Obliga a cada worker a usar al menos una tool antes de responder (+1 llamada LLM aprox.).
    require_evidence: bool = False
    # Guardrails deterministas (ADR-011): inyección, secretos/PII, fuga del Thought y citas
    # no respaldadas por la evidencia. 0 tokens; también se aplican en simulación.
    guardrails_enabled: bool = True
    debate_participants: list[str] = Field(
        default_factory=lambda: ["anaximandro", "heraclito"], min_length=1, max_length=4
    )

    vector_backend: str = "memory"  # memory | chroma
    chroma_host: str = "chroma"
    chroma_port: int = 8000
    memory_max_docs_per_user: int = Field(default=200, ge=1, le=10_000)
    memory_semantic_weight: float = Field(default=0.6, ge=0, le=1)
    memory_lexical_weight: float = Field(default=0.4, ge=0, le=1)
    mcp_server_url: str | None = None  # legado: sustituye arXiv en mcp_public_api_tool
    # Literatura académica con DOI vía el servidor MCP apeiron-scholar (OpenAlex). Vacío = sin la tool.
    scholar_mcp_url: str | None = None

    # A2A (ADR-011). Servidor: Agent Card pública + JSON-RPC con Bearer. Cliente: workers remotos.
    a2a_server_enabled: bool = False
    a2a_public_url: str = ""  # https://host público; vacío = la URL de la propia petición
    a2a_remote_agents: list[RemoteAgentConfig] = Field(default_factory=list, max_length=4)
    a2a_allowed_hosts: list[str] = Field(default_factory=list)
    # Saltos de delegación A2A permitidos (A -> B cuenta 1). Corta bucles A -> B -> A.
    a2a_max_hops: int = Field(default=1, ge=1, le=3)

    langsmith_enabled: bool = False
    langsmith_api_key: str | None = None
    langsmith_project: str = "apeiron-ecosystem"

    @model_validator(mode="after")
    def _no_dev_secret_in_prod(self) -> "Settings":
        if self.auth_provider == "supabase" and not (
            self.supabase_url and self.supabase_publishable_key
        ):
            raise ValueError(
                "APEIRON_AUTH_PROVIDER=supabase requiere APEIRON_SUPABASE_URL y "
                "APEIRON_SUPABASE_PUBLISHABLE_KEY"
            )
        if self.auth_provider == "supabase" and not self.supabase_url.startswith(
            ("https://", "http://")
        ):
            raise ValueError("APEIRON_SUPABASE_URL debe ser una URL https://<ref>.supabase.co")
        if self.env == "prod" and self.auth_provider == "local" and self.jwt_secret == DEV_SECRET:
            raise ValueError("APEIRON_JWT_SECRET es obligatorio en prod")
        if abs(self.memory_semantic_weight + self.memory_lexical_weight - 1.0) > 1e-6:
            raise ValueError("los pesos semántico y léxico deben sumar 1")
        names = [agent.name for agent in self.a2a_remote_agents]
        if len(set(names)) != len(names):
            raise ValueError("APEIRON_A2A_REMOTE_AGENTS tiene nombres repetidos")
        for agent in self.a2a_remote_agents:
            if not AGENT_ID.match(agent.name) or agent.name.startswith("apeiron_"):
                raise ValueError(f"nombre de agente remoto inválido o reservado: {agent.name!r}")
            if agent.token_env and not TOKEN_ENV.match(agent.token_env):
                raise ValueError("token_env debe llamarse APEIRON_A2A_TOKEN_<NOMBRE>")
        return self
