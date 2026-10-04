GitHub Actions separa CI y CD: CI ejecuta lint, tipos, contratos de arquitectura, tests y build web; en `main` publica imágenes API/web con tags inmutables en ECR. CD despliega la release validada en EC2 por SSH. No hay publicación desde pull requests.
# Ápeiron Ecosystem

Plataforma multi-agente de razonamiento filosófico-científico. Ápeiron coordina a Anaximandro y Heráclito en consultas individuales o debates; los especialistas pueden usar herramientas de lógica, fuentes públicas, MCP y memoria.

El backend es un monorepo modular con un único servicio API desplegable. Los límites entre paquetes se verifican con `import-linter`. La arquitectura y sus decisiones están documentadas en los [ADR](docs/adr/).

## Estado

- Backend funcional: Python, FastAPI, LangGraph, autenticación Bearer, REST y streaming SSE.
- Agentes actuales: Anaximandro y Heráclito. El registro/fábricas permite incorporar especialistas adicionales.
- Adaptadores disponibles: proveedor LLM configurable, tool lógica, cliente de API pública/MCP opcional y memoria in-memory o Chroma.
- Web: app Angular standalone instalable con acceso, diez casos precargados, chat SSE, modos consulta/debate y visor de traza.
- Producción: antes de exponer el servicio públicamente hay que reemplazar el repositorio in-memory de usuarios y completar los controles operativos descritos en los ADR y en la [guía de despliegue](docs/DEPLOY.md).

## Arquitectura

```text
apps/web --HTTP/SSE--> services/api
                            |  \
                            v   v
                         packages/core <-- packages/infra
                         domain + app    adaptadores de salida:
                                         LLM, MCP, memoria,
                                         seguridad y observabilidad

deploy/           Docker, Compose y Nginx
docs/             ADR y operación
```

La dependencia entre paquetes externos va hacia el núcleo: `services/api -> packages/infra -> packages/core`. Dentro de `core`, `application -> domain`; el dominio no importa aplicación, frameworks ni adaptadores. Los puertos de entrada/salida pertenecen a aplicación. `services/api` implementa el adaptador de entrada HTTP/SSE; `packages/infra` implementa puertos de salida. La API es el composition root que construye e inyecta adaptadores. `ApeironFacade` implementa el puerto de entrada de chat y `AgentFactory` configura cada especialista.

Estructura interna principal:

```text
packages/core/src/apeiron_core/
  domain/{entities/,value_objects/,services/}
  application/
    agents/                  # especialistas, factories y registry
    dto/                     # eventos/DTOs de aplicación
    orchestration/           # estado y grafo LangGraph
    ports/inbound/           # contratos implementados por casos de uso
    ports/outbound/          # LLM, tools, agentes, memoria y eventos
    use_cases/               # facade/casos de uso
packages/infra/src/apeiron_infra/
  llm/ memory/ observability/ resilience/ security/ tools/
services/api/src/apeiron_api/
  routes/                    # adaptadores HTTP de entrada
  schemas.py deps.py         # validación y middleware/dependencias
```

`inbound/outbound` expresan los puertos de entrada/salida; se usan estos nombres porque `in` y `out` son palabras reservadas de Python. Los contratos de importación viven en `.importlinter` y se ejecutan mediante `make check`/CI.

## Requisitos

- Python `>=3.12`; CI prueba 3.12, 3.13 y 3.14 como gates obligatorios, y la imagen de producción usa Python 3.14. Consulta [ADR-002](docs/adr/0002-python-runtime.md).
- `pip`; `make` es necesario para los atajos documentados.
- Docker y Docker Compose para levantar API con Chroma.
- Node.js `^22.22.3` o `^24.15.0` para Angular 22; CI y Docker usan Node 24.

## Desarrollo local

Desde la raíz del repositorio:

```sh
python -m venv .venv
# Linux/macOS
. .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
make install
```

`make install` instala los paquetes del monorepo y las dependencias opcionales de LLM, Chroma y MCP. Para iniciar sin credenciales de proveedor:

```sh
APEIRON_LLM_PROVIDER=fake make run
```

En Windows PowerShell, define primero la variable con `$env:APEIRON_LLM_PROVIDER="fake"` y luego ejecuta `make run`. La API queda en `http://localhost:8000`; Swagger está en `/docs` y el healthcheck en `/healthz`.

Para usar un proveedor real, copia `.env.example` a `.env`, configura el proveedor y su clave, y arranca con `make run`. No uses secretos de desarrollo ni el archivo `.env` como mecanismo de secretos en producción.

## API y streaming

El flujo habitual es registro, obtención de token y chat:

```text
POST /v1/auth/register
POST /v1/auth/token
POST /v1/chat/stream
```

Las rutas de chat requieren `Authorization: Bearer <access_token>`. También existen `GET /v1/agents` y `POST /v1/chat` para obtener la respuesta sin streaming. El body de chat admite `question`, `mode` (`single` o `debate`) y `max_rounds` de 1 a 4.

El stream SSE emite `trace` (transiciones visibles), `turn` (posición de agente), `answer` (respuesta final) y `error` (fallo público con `trace_id` cuando corresponda). El razonamiento privado del modelo no forma parte del contrato de streaming.

## Comprobaciones

```sh
make check   # Ruff, mypy estricto y límites de importación
make test    # pytest y pruebas async
```

GitHub Actions separa CI y CD: CI ejecuta lint, tipos, contratos de arquitectura, tests y build web; en `main` publica imágenes API/web en GHCR. El workflow CD despliega la release validada en EC2 por SSH usando el secret `AWS_SSH_PRIVATE_KEY` y la variable no secreta `EC2_HOST`. No hay publicación desde pull requests.

## Frontend

La aplicación vive en `apps/web`: dashboard de casos, acceso/registro, consola de chat, streaming SSE y Agent State Viewer. Los servicios en `src/app/core/` mantienen los contratos de API y estado. Comandos de desarrollo y build: [apps/web/README.md](apps/web/README.md).

## Docker y despliegue

Copia `.env.example` a `.env` para desarrollo y levanta API + Chroma con:

```sh
make up
```

En producción CI publica las imágenes y CD activa el perfil Compose `web` en EC2. Configuración de GHCR público, el secret SSH y `EC2_HOST`: [docs/DEPLOY.md](docs/DEPLOY.md). No expongas directamente Chroma ni el puerto interno de la API.

## Extender

- **Añadir un agente:** implementa su agente/factory en `packages/core/src/apeiron_core/application/agents/`, regístrala en `services/api/src/apeiron_api/container.py` y limita sus tools a las necesarias.
- **Añadir una tool:** implementa el puerto `ToolPort` de aplicación mediante un adaptador en `packages/infra/src/apeiron_infra/tools/` y añádelo al conjunto inyectado por el composition root.
- **Añadir un proveedor LLM o vectorial:** implementa el puerto correspondiente en `packages/infra`; no filtres el SDK del proveedor hacia `core`.
- **Añadir un caso de uso web:** actualiza los datos tipados en `apps/web/src/app/core/use-cases.ts` y sus pruebas al completar la aplicación Angular.

## Decisiones arquitectónicas

- [ADR-001: monorepo modular y arquitectura limpia](docs/adr/0001-modular-monorepo.md)
- [ADR-002: runtime y stack tecnológico](docs/adr/0002-python-runtime.md)
- [ADR-003: topología LangGraph y agentes ReAct](docs/adr/0003-debate-topology.md)
- [ADR-004: tools, MCP y memoria](docs/adr/0004-tools-memory-integrations.md)
- [ADR-005: seguridad y resiliencia](docs/adr/0005-security-resilience.md)
- [ADR-006: API, SSE y Angular](docs/adr/0006-api-angular-streaming.md)
- [ADR-007: observabilidad y calidad](docs/adr/0007-observability-quality.md)
- [ADR-008: contenedores, despliegue y CI/CD](docs/adr/0008-deployment-delivery.md)
