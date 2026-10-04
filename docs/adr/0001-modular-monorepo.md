# ADR-001: Monorepo modular y arquitectura limpia

**Estado:** COMPLETADO  
**Fecha:** 2026-10-03

## Contexto

Ápeiron combina dominio filosófico-científico, varios agentes, orquestación cíclica, proveedores externos y una aplicación web. Se necesita poder reemplazar modelos, memoria y APIs sin filtrar sus SDK al dominio, así como añadir agentes sin modificar el grafo central. La entrega inicial debe ser operable por un equipo pequeño, sin asumir la carga distribuida de microservicios prematuros.

## Alternativas

1. Monolito en un único paquete, con límites convencionales.
2. Microservicios separados desde el inicio.
3. Monorepo modular con contratos explícitos y límites verificados automáticamente.

## Decisión

Se adopta la alternativa 3 y Clean Architecture con puertos y adaptadores. Las dependencias entre paquetes externos se dirigen al núcleo: `services/api -> packages/infra -> packages/core`. Dentro de `core`, la aplicación depende del dominio; el dominio no conoce aplicación, frameworks ni adaptadores. En términos de compilación, la regla completa es `API -> Infra -> Application -> Domain`.

- `packages/core/domain`: entidades, value objects y servicios con reglas puras; no importa `application`, LangGraph, FastAPI ni adaptadores.
- `packages/core/application`: casos de uso, DTOs, agentes/fábricas, registro, estado y grafo LangGraph. Declara puertos de entrada y salida; puede usar LangGraph, pero no importa `infra` ni presentación.
- `packages/infra`: adaptadores de salida para LLM/LangChain, MCP y HTTP, memoria vectorial, seguridad, logging, LangSmith y resiliencia. Implementa los puertos definidos por `application`.
- `services/api`: adaptador de entrada FastAPI, rutas, esquemas/validación, autenticación de requests y composition root/ciclo de vida. Es el único servicio desplegable del backend inicialmente y llama a casos de uso a través de su puerto de entrada.
- `apps/web`: cliente Angular standalone, separado del backend y consumidor exclusivo del contrato HTTP/SSE público.
- `deploy`: imágenes, Compose y configuración de Nginx; `docs`: ADR, operación y guía de despliegue.

La estructura objetivo es:

```text
packages/core/src/apeiron_core/
  domain/{entities/,value_objects/,services/}
  application/{agents/,context.py,dto/,orchestration/,ports/{inbound/,outbound/},use_cases/}
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

Los puertos se separan en `application/ports/inbound` y `application/ports/outbound` (`inbound/outbound` se usan porque `in` y `out` son palabras reservadas de Python). La API implementa el puerto de entrada de chat; los adaptadores de `infra` implementan puertos de salida. `container.py` es el composition root: construye adaptadores, fábricas, registro, grafo y facade/caso de uso. `AgentFactory` crea cada especialista con persona, modelo y conjunto permitido de tools. Se añade un agente mediante una fábrica registrada y pruebas de contrato, no mediante condicionales por nombre en el supervisor.

`import-linter` comprobará las fronteras en CI: `api -> infra -> core`, `application -> domain`, sin `domain -> application` y sin importar adaptadores desde `application`. Los puertos son Protocols tipados; las implementaciones de infraestructura son reemplazables por doubles en tests. La extracción de un adaptador a otro proceso requerirá un puerto estable y no debe alterar el dominio.

## Consecuencias

Se mantiene un único despliegue de API y se obtiene aislamiento lógico sin coste operativo de microservicios. Las capas y adaptadores pueden evolucionar por separado. Hay que mantener contratos y reglas de importación; la modularidad no elimina el acoplamiento accidental si se exponen tipos concretos fuera de su capa. Chroma es un servicio complementario en producción, no una dependencia importada por `core`.

## Estado actual y brechas

Contrastado con el código: paquetes `packages/core`, `packages/infra` y `services/api`, composition root en `container.py`, puertos inbound/outbound y `.importlinter` con los cuatro contratos. CI ejecuta `lint-imports`. `apps/web` es Angular standalone; dashboard, chat y Agent State Viewer viven en un único componente raíz (`app.ts`), no en `features/`. No hay `apps/web/tests/`. Agentes adicionales (Sócrates, Anaxágoras) siguen siendo extensiones de producto.
