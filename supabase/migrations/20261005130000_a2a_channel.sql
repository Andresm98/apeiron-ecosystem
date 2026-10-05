-- Ápeiron: A2A en el registro de ejecuciones y en el catálogo de agentes (ADR-011, fases 2 y 3).
-- Se aplica con la CLI: `supabase db push` (ver supabase/README.md). Es idempotente.

-- 1. Canal de origen de cada ejecución y correlación con la tarea A2A.
alter table public.agent_runs
  add column if not exists channel text not null default 'web';
alter table public.agent_runs drop constraint if exists agent_runs_channel_check;
alter table public.agent_runs
  add constraint agent_runs_channel_check check (channel in ('web', 'a2a'));
alter table public.agent_runs
  add column if not exists a2a_task_id text check (a2a_task_id is null or char_length(a2a_task_id) <= 64);

comment on column public.agent_runs.channel is 'Origen: web (API propia) o a2a (otro agente vía protocolo A2A).';
comment on column public.agent_runs.a2a_task_id is 'Id de la tarea A2A que originó la ejecución (solo channel=a2a).';

-- 2. Workers remotos (A2A) en el catálogo. Cada despliegue añade sus filas en su propia
--    migración; sin fila, agent_executions omite al agente (la ejecución se guarda igual).
alter table public.agents drop constraint if exists agents_kind_check;
alter table public.agents
  add constraint agents_kind_check check (kind in ('orchestrator', 'worker', 'remote'));

-- 3. Escritura atómica: igual que en 20261005120000_run_guardrails.sql, más canal y tarea A2A.
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
    turns, trace, steps, guardrails, usage, model, duration_ms, error
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
