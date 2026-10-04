# ADR-001: Monorepo modular y arquitectura limpia

**Estado:** Aceptada como baseline de arquitectura  
**Fecha:** 2026-10-03

## Contexto

Ápeiron combina dominio filosófico-científico, varios agentes, orquestación cíclica, proveedores externos y una aplicación web. Se necesita poder reemplazar modelos, memoria y APIs sin filtrar sus SDK al dominio, así como añadir agentes sin modificar el grafo central. La entrega inicial debe ser operable por un equipo pequeño, sin asumir la carga distribuida de microservicios prematuros.

## Alternativas

1. Monolito en un único paquete, con límites convencionales.
2. Microservicios separados desde el inicio.
3. Monorepo modular con contratos explícitos y límites verificados automáticamente.

## Decisión

Se adopta la alternativa 3. La dirección de dependencias del backend es `services/api -> packages/infra -> packages/core`; la API también consume contratos públicos de `core`. No se permiten dependencias desde `core` hacia `infra`, `api` o la web.

- `packages/core`: dominio, puertos, agentes/fábricas, registro, estado, grafo LangGraph y facade. Puede depender de LangGraph para la orquestación, pero no de FastAPI, HTTP, JWT, SDKs de proveedores ni una base de datos concreta.
- `packages/infra`: adaptadores para LLM/LangChain, MCP y HTTP, memoria vectorial, seguridad, logging, LangSmith y políticas de resiliencia. Implementa los puertos definidos por `core`.
- `services/api`: presentación FastAPI, esquemas/validación, autenticación de requests, composición de dependencias y ciclo de vida de recursos. Es el único servicio desplegable del backend inicialmente.
- `apps/web`: cliente Angular standalone, separado del backend y consumidor exclusivo del contrato HTTP/SSE público.
- `deploy`: imágenes, Compose y configuración de Nginx; `docs`: ADR, operación y guía de despliegue.

La estructura objetivo es:

```text
packages/core/src/apeiron_core/
	domain/{__init__.py,context.py,ports.py,routing.py,agents/{__init__.py,base.py,factories.py,react.py}}
	orchestration/{__init__.py,facade.py,graph.py,registry.py,state.py}
packages/core/tests/
packages/infra/src/apeiron_infra/
	llm/ memory/ observability/ resilience/ security/ tools/
packages/infra/tests/
services/api/src/apeiron_api/{routes/{auth.py,chat.py},container.py,deps.py,main.py,schemas.py,settings.py}
services/api/tests/
apps/web/src/app/{core/,features/{dashboard/,chat/,agent-state/},app.config.ts,app.routes.ts}
apps/web/public/  apps/web/tests/
deploy/{docker/{api.Dockerfile,web.Dockerfile},nginx/,docker-compose.yml}
.github/workflows/ci.yml
```

`container.py` es el composition root: construye adaptadores, fábricas, registro, grafo y facade. `AgentFactory` crea cada especialista con persona, modelo y conjunto permitido de tools. `ApeironFacade` es la fachada consumida por la API y oculta el grafo y sus detalles de ejecución. Se añade un agente mediante una fábrica registrada y pruebas de contrato, no mediante condicionales por nombre en el supervisor.

`import-linter` comprobará las fronteras en CI. Los contratos de dominio son Protocols tipados; las implementaciones de infraestructura son reemplazables por doubles en tests. La extracción de un adaptador a otro proceso requerirá un puerto estable y no debe alterar el dominio.

## Consecuencias

Se mantiene un único despliegue de API y se obtiene aislamiento lógico sin coste operativo de microservicios. Las capas y adaptadores pueden evolucionar por separado. Hay que mantener contratos y reglas de importación; la modularidad no elimina el acoplamiento accidental si se exponen tipos concretos fuera de su capa. Chroma es un servicio complementario en producción, no una dependencia importada por `core`.

## Estado actual y brechas

El monorepo y la dirección de dependencias ya existen. La API es el composition root; hay fábricas para Anaximandro y Heráclito. `apps/web` aún contiene contratos y servicios scaffold, no una aplicación Angular instalable. Los nuevos agentes mencionados en el producto (Sócrates, Anaxágoras, entre otros) son extensiones futuras.
