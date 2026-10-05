-- Ápeiron: guardrails en el registro de ejecuciones (ADR-011).
-- Se aplica con la CLI: `supabase db push` (ver supabase/README.md). Es idempotente.

-- 1. Veredictos no triviales (etapa, acción, reglas, agente, ronda). Nunca el texto evaluado.
alter table public.agent_runs
  add column if not exists guardrails jsonb not null default '[]'::jsonb;

comment on column public.agent_runs.guardrails is
  'Veredictos de guardrails distintos de allow: [{stage, action, rules, agent, round}] (ADR-011).';

-- 2. Nuevo estado: la entrada se bloqueó y ningún worker actuó.
alter table public.agent_runs drop constraint if exists agent_runs_status_check;
alter table public.agent_runs
  add constraint agent_runs_status_check check (status in ('completed', 'blocked', 'error'));

-- 3. Escritura atómica: igual que en 20261004130000_agent_registry.sql, más `guardrails`.
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
    turns, trace, steps, guardrails, usage, model, duration_ms, error
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
