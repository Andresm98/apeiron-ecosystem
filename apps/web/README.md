# Angular web

Cliente standalone Angular 22 para la API Ápeiron. Incluye registro/inicio de sesión, diez casos de estudio, consulta individual o debate, streaming SSE y visualización de las transiciones del grafo.

## Desarrollo

```sh
npm ci
npm start -- --proxy-config proxy.conf.json
```

Con la API en `http://localhost:8000` (`APEIRON_LLM_PROVIDER=fake make run` desde la raíz), abre `http://localhost:4200`.

## Build

```sh
npm run build -- --configuration production
```

El artefacto queda en `dist/apeiron-web/browser`, que es la ruta servida por Nginx en `deploy/docker/web.Dockerfile`. Angular 22 requiere Node `^22.22.3` o `^24.15.0`; CI y Docker usan Node 24.

## Arquitectura

Clean Architecture + Hexagonal, organizada por contexto (bounded context) y, dentro de cada uno, por capa:

```
src/app/
├── app.ts · app.config.ts · app.routes.ts   raíz de composición
├── shared/
│   ├── infrastructure/api.config.ts         base URL de la API
│   └── presentation/sanitize-markdown.ts
├── auth/
│   ├── domain/            credentials, access-token (exp del JWT), AuthError
│   ├── application/       ports/auth.gateway · SessionStore (persistente con Supabase, en memoria en local) · AuthService
│   ├── infrastructure/    RuntimeAuthGateway → SupabaseAuthGateway | HttpAuthGateway · auth.interceptor · provideAuth()
│   └── presentation/      login page · guards
└── research/
    ├── domain/            chat (eventos SSE), topology, graph-run, case-studies
    ├── application/       ports (ChatStreamPort, TopologyRepository) · run-state (reducer puro) · ResearchStore
    ├── infrastructure/    SseChatStreamAdapter · sse-frame.parser · HttpTopologyRepository · provideResearch()
    ├── presentation/      workspace page · agent-graph · agent-label
    └── research.routes.ts raíz de composición del contexto (adaptadores en el chunk lazy)
```

Regla de dependencias (la verifica `architecture.spec.ts`):

| Capa | Puede depender de |
| --- | --- |
| `domain` | nada: TypeScript puro, sin Angular ni rxjs |
| `application` | `domain`; los puertos son clases abstractas usadas como token de DI |
| `infrastructure` | `application`, `domain` (implementa los puertos) |
| `presentation` | `application`, `domain` (nunca adaptadores) |

Los puertos se enlazan con sus adaptadores en `provideAuth()` (global) y `provideResearch()` (a nivel de ruta). Para sustituir un adaptador (p. ej. un stream simulado en tests) basta con otro `{ provide: ChatStreamPort, useClass: ... }`.

## Tests

```sh
npm test
```

Ejecuta con `node --test` todos los `*.spec.ts`: dominio, reducer de aplicación, parsers de infraestructura y la regla de arquitectura. Los módulos sin framework importan con extensión `.ts` (`allowImportingTsExtensions`) para poder ejecutarse en Node sin Angular.
