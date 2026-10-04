# ADR-010: Supabase para identidad, sesiones persistentes y ejecuciones de agentes

**Estado:** COMPLETADO (reemplaza en ADR-005 el repositorio SQLite y el token solo en memoria)  
**Fecha:** 2026-10-04

## Contexto

La identidad vivía en SQLite dentro de un volumen Docker y el JWT del navegador solo en memoria. Recargar la página cerraba la sesión, no había refresh tokens y los usuarios quedaban ligados a un único host. Las ejecuciones de los agentes no se guardaban: solo quedaban la memoria vectorial (Q/A) y las trazas de LangSmith. Se pidió persistir la sesión y, si no implicaba un refactor crítico, también las ejecuciones.

## Alternativas

1. Mantener auth propia y añadir refresh tokens y tablas de sesiones en Postgres: reimplementa lo que ya ofrece un proveedor de identidad.
2. **Supabase Auth** para identidad y sesiones, y **Postgres de Supabase con RLS** para las ejecuciones.
3. Guardar las ejecuciones con un checkpointer de LangGraph sobre Postgres: acopla el formato de almacenamiento al runtime y guarda estado intermedio que no necesitamos.

## Decisión

Se adopta la alternativa 2, detrás de `APEIRON_AUTH_PROVIDER=supabase|local`.

- **Sesiones:** el frontend usa `@supabase/supabase-js`, que persiste la sesión en el navegador, renueva el access token antes de que caduque y sincroniza pestañas. El SDK se carga en un chunk lazy solo cuando la API anuncia `provider=supabase` en `GET /v1/auth/config`; el mismo build sirve para ambos modos. Los usuarios se identifican por correo; el registro puede exigir confirmación por email.
- **API:** `SupabaseTokenVerifier` valida el access token con el JWKS del proyecto (claves asimétricas, caché de 1 h) o con `SUPABASE_JWT_SECRET` en proyectos legacy HS256. Exige `aud=authenticated` e `iss=<url>/auth/v1`. El `sub` (UUID) pasa a ser el `user_id` de logs, trazas, memoria y ejecuciones. En este modo, `/v1/auth/register` y `/v1/auth/token` responden 404.
- **Ejecuciones:** nuevo puerto de salida `RunRepositoryPort`, que es opcional: sin él, la facade se comporta igual que antes. `ApeironFacade` registra cada ejecución, completada o con error: pregunta, modo, simulación, turnos, traza, síntesis, uso de tokens, modelo, duración y `trace_id`. Si el guardado falla, solo se registra un warning y nunca se interrumpe el chat. `SupabaseRunRepository` escribe en `public.agent_runs` vía PostgREST **con el JWT del propio usuario** (credencial delegada en `RequestContext.access_token`, que no aparece en repr ni en logs). RLS (`auth.uid() = user_id`) impide leer o escribir ejecuciones ajenas, así que el backend no necesita la `service_role` key. Lectura: `GET /v1/runs` y `GET /v1/runs/{uuid}`.
- **Configuración mínima:** `APEIRON_SUPABASE_URL` y `APEIRON_SUPABASE_PUBLISHABLE_KEY` (pública por diseño). La migración está en `deploy/supabase/migrations/0001_agent_runs.sql`.
- **Modo `local`:** se conserva (SQLite y JWT propio en memoria) para tests y desarrollo sin red. No tiene historial.
- **Chroma** sigue siendo la memoria vectorial; migrarla a pgvector queda fuera de alcance.

## Consecuencias

La sesión sobrevive a recargas y reinicios del contenedor, y la identidad deja de depender del host. A cambio, la sesión vive en `localStorage` (patrón estándar de Supabase), lo que aumenta el impacto de un XSS. Por eso hay que mantener el escape de Angular, no inyectar HTML y considerar una CSP. Supabase pasa a ser una dependencia crítica para entrar, aunque no para ejecutar el grafo. Las memorias guardadas en modo local (con clave de nombre de usuario) no se migran a los UUID de Supabase. El rate limiting de login lo aplica Supabase; el de chat sigue en la API.

## Estado actual y brechas

Implementado y cubierto por tests: verificación HS256 y ES256 (aud, iss, exp, algoritmo), repositorio con RLS delegado (cabeceras y filtros), registro de ejecuciones completadas, con error y en simulación, aislamiento ante fallos de persistencia, y endpoints `/v1/runs` y de config en modo Supabase. El frontend se verificó en navegador en modo local completo y en modo Supabase hasta la llamada a `/auth/v1/token`. Pendiente: prueba E2E contra un proyecto real (`smoke_e2e.py` con `SMOKE_EMAIL`/`SMOKE_PASSWORD`), CSP en Nginx y retención/borrado del historial desde la UI.
