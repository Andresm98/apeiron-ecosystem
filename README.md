# Ápeiron Ecosystem

Plataforma multi-agente (Ápeiron supervisor · Anaximandro · Heráclito) con debate dialéctico, ReAct y tools.
**Monorepo modular**: fronteras impuestas por CI, un único backend desplegable, front independiente.

```
packages/core/    dominio + orquestación LangGraph   (sin web, sin proveedores)
packages/infra/   adaptadores: LLM, resiliencia, logging JSON, JWT, tools, memoria vectorial
services/api/     FastAPI + composition root (REST + SSE)  <- único servicio desplegable
apps/web/         scaffold Angular (contrato + servicios); la app la construyes en local
deploy/           Dockerfiles multistage, compose, nginx
docs/             ADRs y guía de despliegue
```
Dependencias: `api -> infra -> core` (verificado por `lint-imports`).

## Local
```
python -m venv .venv && . .venv/bin/activate && make install
APEIRON_LLM_PROVIDER=fake make run      # sin API key; /docs para Swagger
make check && make test
```
Flujo: `POST /v1/auth/register` -> `POST /v1/auth/token` -> `POST /v1/chat/stream` (SSE: `trace`, `turn`, `answer`, `error`).

## Extender
* **Nuevo agente**: `AgentFactory` en `core/domain/agents/factories.py` + `registry.register(...)` en `api/container.py`.
* **Nueva tool**: clase con `name/description/run` en `infra/tools/`, añadirla al dict de tools del container.
* **Otro proveedor LLM**: `APEIRON_LLM_PROVIDER` (vía `init_chat_model`) o un nuevo adaptador de `LLMPort`.
