-- Ápeiron: la Polis (ADR-013, fases 2 a 4). Se aplica con la CLI: `supabase db push`. Es idempotente.
--
--   1. Catálogo: el participante humano (kind 'human') y los nuevos ciudadanos Nietzsche, Feynman y Epicuro.
--   2. agent_runs: canal 'session', configuración de la deliberación y cronología pública para el replay.
--   3. agent_executions: llamadas y tokens atribuidos a cada agente.
--   4. record_agent_run: escribe todo lo anterior en la misma transacción.

-- 1. Catálogo ------------------------------------------------------------------------------
alter table public.agents drop constraint if exists agents_kind_check;
alter table public.agents
  add constraint agents_kind_check check (kind in ('orchestrator', 'worker', 'remote', 'human'));

insert into public.agents (id, display_name, kind, role, tools) values
  ('human', 'Ciudadano', 'human',
   'El usuario autenticado cuando participa en una deliberación (ssanax es su nombre visible).', '{}'),
  ('nietzsche', 'Nietzsche', 'worker',
   'Crítica genealógica: origen de los valores, supuestos ocultos y contradicciones.',
   '{vector_memory_retriever,scholarly_search}'),
  ('feynman', 'Feynman', 'worker',
   'Verificación: mecanismo causal, experimentos y comprobación de hipótesis.',
   '{formal_logic_calculator,mcp_public_api_tool,scholarly_search,vector_memory_retriever}'),
  ('epicuro', 'Epicuro', 'worker',
   'Prudencia: consecuencias, coste, utilidad y sufrimiento innecesario.',
   '{vector_memory_retriever,formal_logic_calculator}')
on conflict (id) do update set
  display_name = excluded.display_name,
  kind         = excluded.kind,
  role         = excluded.role,
  tools        = excluded.tools,
  updated_at   = now();

-- 2. Ejecuciones -----------------------------------------------------------------------------
alter table public.agent_runs drop constraint if exists agent_runs_channel_check;
alter table public.agent_runs
  add constraint agent_runs_channel_check check (channel in ('web', 'a2a', 'session'));

alter table public.agent_runs
  add column if not exists config jsonb not null default '{}'::jsonb;
alter table public.agent_runs
  add column if not exists events jsonb not null default '[]'::jsonb;

comment on column public.agent_runs.config is
  'Configuración de la deliberación: participantes, ritmo, rondas o debate abierto, presupuesto de tiempo.';
comment on column public.agent_runs.events is
  'Cronología pública {t, type, data} para reproducir la ejecución. Nunca contiene el Thought.';

-- 3. Tokens por agente -------------------------------------------------------------------------
alter table public.agent_executions
  add column if not exists llm_calls integer not null default 0 check (llm_calls >= 0);
alter table public.agent_executions
  add column if not exists input_tokens integer not null default 0 check (input_tokens >= 0);
alter table public.agent_executions
  add column if not exists output_tokens integer not null default 0 check (output_tokens >= 0);

-- 4. Escritura atómica: igual que en 20261005130000_a2a_channel.sql, más config, events y tokens.
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
    user_id, trace_id, channel, a2a_task_id, question, mode, simulate, status, answer,
    turns, trace, steps, guardrails, usage, model, duration_ms, error, config, events
  ) values (
    auth.uid(),
    coalesce(p_run ->> 'trace_id', '-'),
    coalesce(p_run ->> 'channel', 'web'),
    p_run ->> 'a2a_task_id',
    p_run ->> 'question',
    coalesce(p_run ->> 'mode', ''),
    coalesce((p_run ->> 'simulate')::boolean, false),
    p_run ->> 'status',
    coalesce(p_run ->> 'answer', ''),
    coalesce(p_run -> 'turns', '[]'::jsonb),
    coalesce(p_run -> 'trace', '[]'::jsonb),
    coalesce(p_run -> 'steps', '[]'::jsonb),
    coalesce(p_run -> 'guardrails', '[]'::jsonb),
    coalesce(p_run -> 'usage', '{}'::jsonb),
    coalesce(p_run ->> 'model', ''),
    coalesce((p_run ->> 'duration_ms')::integer, 0),
    p_run ->> 'error',
    coalesce(p_run -> 'config', '{}'::jsonb),
    coalesce(p_run -> 'events', '[]'::jsonb)
  )
  returning id into v_run_id;

  insert into public.agent_executions (
    run_id, agent_id, user_id, invocations, reasoning_steps,
    tool_calls, tools_used, degraded, duration_ms, llm_calls, input_tokens, output_tokens
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
    coalesce((a ->> 'duration_ms')::integer, 0),
    coalesce((a ->> 'llm_calls')::integer, 0),
    coalesce((a ->> 'input_tokens')::integer, 0),
    coalesce((a ->> 'output_tokens')::integer, 0)
  from jsonb_array_elements(coalesce(p_agents, '[]'::jsonb)) as a
  -- Agentes no catalogados se ignoran: la ejecución se guarda igualmente.
  where exists (select 1 from public.agents g where g.id = a ->> 'agent_id');

  return v_run_id;
end;
$$;

revoke all on function public.record_agent_run(jsonb, jsonb) from public, anon;
grant execute on function public.record_agent_run(jsonb, jsonb) to authenticated;
