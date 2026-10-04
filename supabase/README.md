# Supabase: esquema versionado

El esquema de Postgres se gestiona **solo con migraciones** de la Supabase CLI
(`supabase/migrations/<timestamp>_<nombre>.sql`). No se ejecuta SQL a mano en el dashboard.

| Migración | Contenido |
|---|---|
| `20261004120000_agent_runs.sql` | `agent_runs`: ejecuciones por usuario, con RLS (select/insert/delete propios; sin UPDATE) |
| `20261004130000_agent_registry.sql` | `agents` (catálogo de identidades, solo lectura para la app), `agent_executions` (agentes que actuaron en cada ejecución), columna `agent_runs.steps` y RPC `record_agent_run()` (escritura atómica con RLS) |

## Uso con el proyecto en la nube

La CLI se usa con `npx`, sin instalación global:

```sh
npx supabase login                                  # abre el navegador una vez
npx supabase link --project-ref <project-ref>       # el ref es el subdominio de APEIRON_SUPABASE_URL
npx supabase migration list                         # local vs remoto
npx supabase db push                                # aplica las migraciones pendientes
```

`link` pide la contraseña de la base de datos (*Project Settings → Database*). No se guarda en el repositorio.

### Si ya ejecutaste `agent_runs` a mano en el SQL Editor

La tabla existe, pero la CLI no lo sabe. Antes del primer `db push`, márcala como aplicada:

```sh
npx supabase migration repair --status applied 20261004120000
npx supabase db push        # aplica solo 20261004130000_agent_registry
```

Las migraciones son idempotentes (`if not exists`, `on conflict`, `drop policy if exists`), así que volver a aplicarlas no rompe nada.

## Añadir un cambio

```sh
npx supabase migration new <nombre>   # crea supabase/migrations/<timestamp>_<nombre>.sql
# edita el SQL, pruébalo y luego:
npx supabase db push
```

**Un agente nuevo** (por ejemplo, Sócrates) necesita una migración que lo inserte en `public.agents`. Hasta que exista esa fila, sus ejecuciones se guardan igualmente, pero `record_agent_run` omite su fila en `agent_executions`.

## Seguridad

- La app solo usa la **publishable key** y el JWT del usuario. Todo pasa por RLS (`auth.uid()`).
- `record_agent_run` es `security invoker` y fuerza `user_id = auth.uid()`: ignora cualquier `user_id` que venga en el payload.
- `anon` no tiene acceso a ninguna tabla ni a la RPC.
