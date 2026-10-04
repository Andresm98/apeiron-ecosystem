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

## Módulos

- `core/models.ts`: contrato tipado de requests, turnos y eventos SSE.
- `core/auth.service.ts`: registro y JWT en memoria.
- `core/chat-stream.service.ts`: SSE autenticado sobre `fetch` con cancelación.
- `core/agent-state.store.ts`: estado reactivo de answer, turns, trace y errores.
- `core/use-cases.ts`: casos precargados del dashboard.
