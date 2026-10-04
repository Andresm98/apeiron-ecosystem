-- Ápeiron: identidad de agentes y agentes ejecutados en cada ejecución (ADR-010).
--
--   agents            catálogo versionado por migraciones (solo lectura para la app)
--   agent_executions  una fila por agente participante en cada agent_run
--   record_agent_run  inserta ejecución + agentes en una transacción, con RLS del usuario

-- 1. Catálogo de identidades -------------------------------------------------------------
create table if not exists public.agents (
  id           text primary key check (id ~ '^[a-z][a-z0-9_]{1,40}$'),
  display_name text not null,
  kind         text not null check (kind in ('orchestrator', 'worker')),
  role         text not null default '',
  tools        text[] not null default '{}',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.agents is 'Identidad de los agentes del grafo Ápeiron. Se modifica solo por migración.';

insert into public.agents (id, display_name, kind, role, tools) values
  ('apeiron', 'Ápeiron', 'orchestrator',
   'Orquestador: enruta, supervisa cada turno y sintetiza.', '{}'),
  ('anaximandro', 'Anaximandro', 'worker',
   'Worker principal: tesis desde el ápeiron, lógica formal y evidencia.',
   '{formal_logic_calculator,mcp_public_api_tool,vector_memory_retriever}'),
  ('heraclito', 'Heráclito', 'worker',
   'Worker dialéctico: replica a Anaximandro desde el devenir y el logos.',
   '{vector_memory_retriever,mcp_public_api_tool}')
on conflict (id) do update set
  display_name = excluded.display_name,
  kind         = excluded.kind,
  role         = excluded.role,
  tools        = excluded.tools,
  updated_at   = now();

alter table public.agents enable row level security;

drop policy if exists "agents_read" on public.agents;
create policy "agents_read" on public.agents
  for select to authenticated
  using (true);

grant select on public.agents to authenticated;
revoke all on public.agents from anon;

-- 2. Evidencia observable de cada ejecución --------------------------------------------
alter table public.agent_runs
  add column if not exists steps jsonb not null default '[]'::jsonb;

comment on column public.agent_runs.steps is
  'Pasos ReAct públicos: herramienta, entrada y observación truncada (nunca el Thought).';

-- 3. Agentes ejecutados por ejecución ---------------------------------------------------
create table if not exists public.agent_executions (
  run_id          uuid not null references public.agent_runs (id) on delete cascade,
  agent_id        text not null references public.agents (id),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  invocations     integer not null default 0 check (invocations >= 0),
  reasoning_steps integer not null default 0 check (reasoning_steps >= 0),
  tool_calls      integer not null default 0 check (tool_calls >= 0),
  tools_used      text[] not null default '{}',
  degraded        boolean not null default false,
  duration_ms     integer not null default 0 check (duration_ms >= 0),
  created_at      timestamptz not null default now(),
  primary key (run_id, agent_id)
);

comment on table public.agent_executions is 'Qué agentes actuaron en cada ejecución y con qué esfuerzo.';

create index if not exists agent_executions_user_agent_idx
  on public.agent_executions (user_id, agent_id, created_at desc);

alter table public.agent_executions enable row level security;

drop policy if exists "agent_executions_select_own" on public.agent_executions;
create policy "agent_executions_select_own" on public.agent_executions
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Solo se insertan filas de ejecuciones propias.
drop policy if exists "agent_executions_insert_own" on public.agent_executions;
create policy "agent_executions_insert_own" on public.agent_executions
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.agent_runs r
      where r.id = run_id and r.user_id = (select auth.uid())
    )
  );

grant select, insert on public.agent_executions to authenticated;
revoke all on public.agent_executions from anon;

-- 4. Escritura atómica --------------------------------------------------------------------
-- security invoker: se ejecuta con los permisos y RLS del usuario que llama.
create or replace function public.record_agent_run(p_run jsonb, p_agents jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if auth.uid() is null then
    raise exception 'record_agent_run requiere un usuario autenticado' using errcode = '42501';
  end if;

  insert into public.agent_runs (
    user_id, trace_id, question, mode, simulate, status, answer,
    turns, trace, steps, usage, model, duration_ms, error
  ) values (
    auth.uid(),
    coalesce(p_run ->> 'trace_id', '-'),
    p_run ->> 'question',
    coalesce(p_run ->> 'mode', ''),
    coalesce((p_run ->> 'simulate')::boolean, false),
    p_run ->> 'status',
    coalesce(p_run ->> 'answer', ''),
    coalesce(p_run -> 'turns', '[]'::jsonb),
    coalesce(p_run -> 'trace', '[]'::jsonb),
    coalesce(p_run -> 'steps', '[]'::jsonb),
    coalesce(p_run -> 'usage', '{}'::jsonb),
    coalesce(p_run ->> 'model', ''),
    coalesce((p_run ->> 'duration_ms')::integer, 0),
    p_run ->> 'error'
  )
  returning id into v_run_id;

  insert into public.agent_executions (
    run_id, agent_id, user_id, invocations, reasoning_steps,
    tool_calls, tools_used, degraded, duration_ms
  )
  select
    v_run_id,
    a ->> 'agent_id',
    auth.uid(),
    coalesce((a ->> 'invocations')::integer, 0),
    coalesce((a ->> 'reasoning_steps')::integer, 0),
    coalesce((a ->> 'tool_calls')::integer, 0),
    coalesce(array(select jsonb_array_elements_text(a -> 'tools_used')), '{}'),
    coalesce((a ->> 'degraded')::boolean, false),
    coalesce((a ->> 'duration_ms')::integer, 0)
  from jsonb_array_elements(coalesce(p_agents, '[]'::jsonb)) as a
  -- Agentes no catalogados se ignoran: la ejecución se guarda igualmente.
  where exists (select 1 from public.agents g where g.id = a ->> 'agent_id');

  return v_run_id;
end;
$$;

revoke all on function public.record_agent_run(jsonb, jsonb) from public, anon;
grant execute on function public.record_agent_run(jsonb, jsonb) to authenticated;
