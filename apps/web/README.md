# apps/web — scaffold Angular

Aquí solo viven el **contrato con el API** y los servicios base; la UI (dashboard, consola, state viewer) la construyes en local.

```
npx @angular/cli@latest new apeiron-web --standalone --routing --style=scss --directory=. --skip-git
# luego copia/mezcla src/app/core/* y proxy.conf.json de este scaffold
ng serve --proxy-config proxy.conf.json      # API en http://localhost:8000 (make run)
```
En `app.config.ts` añade `provideHttpClient()`. El build de producción debe llamarse `apeiron-web` (ver `deploy/docker/web.Dockerfile`).

* `core/models.ts` — tipos de eventos SSE (`trace | turn | answer | error`).
* `core/auth.service.ts` — register/login, token JWT en memoria.
* `core/chat-stream.service.ts` — SSE sobre `fetch` (EventSource no permite POST ni cabecera Authorization).
* `core/agent-state.store.ts` — estado reactivo (signals) para el Agent State Viewer: `trace`, `turns`, `answer`.
* `core/use-cases.ts` — los 10 casos de uso precargados del dashboard.
* Sugerido para la UI: `ngx-markdown` + `katex` (Markdown/LaTeX).
