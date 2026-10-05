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
COPY services/mcp-scholar services/mcp-scholar

RUN pip install \
    --prefix=/install \
    ./packages/core \
    "./packages/infra[llm,chroma,mcp]" \
    ./services/api \
    ./services/mcp-scholar


FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/home/app

RUN groupadd --system app \
    && useradd --system --gid app --create-home app \
    && mkdir -p /app/data \
    && chown -R app:app /app

# Rutas relativas (p. ej. APEIRON_USERS_DB_PATH=data/users.db) resuelven bajo /app.
# /app/data es propiedad de `app`; un volumen nombrado montado ahí hereda ese owner.
WORKDIR /app

COPY --from=builder /install /usr/local

USER app

EXPOSE 8000

# start-period/interval: en el primer arranque Chroma descarga su modelo ONNX (~80 MB, decenas de s).
HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=120s --start-interval=2s \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/healthz')" || exit 1

CMD ["uvicorn", "apeiron_api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
