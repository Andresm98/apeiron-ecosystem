# syntax=docker/dockerfile:1
# Multistage: build de dependencias -> runtime ligero, usuario no-root.
# Python 3.14 es el runtime de CI y producción (ADR-002).

ARG PYTHON_VERSION=3.14

FROM python:${PYTHON_VERSION}-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /src

COPY packages/core packages/core
COPY packages/infra packages/infra
COPY services/api services/api

RUN pip install \
    --prefix=/install \
    ./packages/core \
    "./packages/infra[llm,chroma,mcp]" \
    ./services/api


FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/home/app

RUN groupadd --system app \
    && useradd --system --gid app --create-home app

COPY --from=builder /install /usr/local

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/healthz')" || exit 1

CMD ["uvicorn", "apeiron_api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
