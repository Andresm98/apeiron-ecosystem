# syntax=docker/dockerfile:1
# Servidor local de LangGraph (`langgraph dev`, runtime en memoria) para LangGraph Studio.
# Solo desarrollo: no es parte del despliegue de producción (ADR-009).
# Studio (UI web) se abre en: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024

ARG PYTHON_VERSION=3.13

FROM python:${PYTHON_VERSION}-slim

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/home/app

RUN groupadd --system app \
    && useradd --system --gid app --create-home app

WORKDIR /app

COPY packages/core packages/core
COPY packages/infra packages/infra
COPY services/api services/api

RUN pip install \
    ./packages/core \
    "./packages/infra[llm,chroma,mcp]" \
    ./services/api \
    "langgraph-cli[inmem]>=0.4,<0.5"

COPY langgraph.json langgraph.json
RUN touch .env && chown -R app:app /app

USER app

EXPOSE 2024

# LangSmith toma la clave de APEIRON_LANGSMITH_API_KEY si no hay LANGSMITH_API_KEY explícita.
CMD ["sh", "-c", "export LANGSMITH_API_KEY=\"${LANGSMITH_API_KEY:-$APEIRON_LANGSMITH_API_KEY}\"; exec langgraph dev --host 0.0.0.0 --port 2024 --no-browser --no-reload"]
