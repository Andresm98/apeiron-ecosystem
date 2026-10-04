# syntax=docker/dockerfile:1
# Multistage: build de dependencias -> runtime ligero, usuario no-root.
# Objetivo 3.14 (ADR-002); por defecto 3.13 hasta validar wheels. Cambiar con --build-arg PYTHON_VERSION=3.14
ARG PYTHON_VERSION=3.13

FROM python:${PYTHON_VERSION}-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /src
COPY packages/core packages/core
COPY packages/infra packages/infra
COPY services/api services/api
RUN pip install --prefix=/install ./packages/core "./packages/infra[llm,chroma,mcp]" ./services/api

FROM python:${PYTHON_VERSION}-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN groupadd --system app && useradd --system --gid app --no-create-home app
COPY --from=builder /install /usr/local
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/healthz')" || exit 1
CMD ["uvicorn", "apeiron_api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
