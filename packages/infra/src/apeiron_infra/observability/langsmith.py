"""LangSmith se activa por variables de entorno; LangGraph/LangChain las leen solos."""
import os


def configure_langsmith(enabled: bool, api_key: str | None, project: str) -> bool:
    if not (enabled and api_key):
        os.environ["LANGSMITH_TRACING"] = "false"
        return False
    os.environ.update(
        {
            "LANGSMITH_TRACING": "true",
            "LANGSMITH_API_KEY": api_key,
            "LANGSMITH_PROJECT": project,
            "LANGCHAIN_TRACING_V2": "true",
            "LANGCHAIN_API_KEY": api_key,
            "LANGCHAIN_PROJECT": project,
        }
    )
    return True
