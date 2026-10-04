"""Adaptador LangChain (provider-agnóstico vía init_chat_model). Registra latencia y tokens."""
import logging
import time
from typing import Any

from apeiron_core.application.usage import record_usage

log = logging.getLogger("apeiron.llm")


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    return "".join(b.get("text", "") for b in content if isinstance(b, dict))


class LangChainLLM:
    def __init__(
        self,
        model: str,
        provider: str,
        temperature: float = 0.2,
        max_tokens: int = 1500,
        reasoning_effort: str | None = None,  # modelos de razonamiento (p. ej. OpenAI gpt-5*)
        chat_model: Any = None,  # inyectable para pruebas
    ) -> None:
        self._label = f"{provider}:{model}"
        if chat_model is None:
            from langchain.chat_models import init_chat_model  # import diferido (extra [llm])

            extra: dict[str, Any] = (
                {"reasoning_effort": reasoning_effort} if reasoning_effort else {}
            )
            chat_model = init_chat_model(
                model,
                model_provider=provider,
                temperature=temperature,
                max_tokens=max_tokens,
                **extra,
            )
        self._chat = chat_model

    async def complete(self, system: str, user: str) -> str:
        started = time.perf_counter()
        msg = await self._chat.ainvoke([("system", system), ("human", user)])
        usage = getattr(msg, "usage_metadata", None) or {}
        record_usage(usage.get("input_tokens", 0), usage.get("output_tokens", 0))
        log.info(
            "llm_call",
            extra={
                "model": self._label,
                "execution_time_ms": round((time.perf_counter() - started) * 1000, 1),
                "token_usage": usage or None,
            },
        )
        return _text(msg.content)
