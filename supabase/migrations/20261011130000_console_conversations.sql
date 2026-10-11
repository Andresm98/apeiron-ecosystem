-- Ápeiron: conversaciones de la consola (ADR-014). Se aplica con la CLI: `supabase db push`. Es idempotente.
--
--   1. agent_runs.conversation_id: hilo de la consola al que pertenece cada ejecución (null fuera de la consola).
--   2. Índice por usuario y conversación: la API lee el hilo en orden y los últimos intercambios para el contexto.
--   3. record_agent_run: guarda el conversation_id en la misma transacción.
--
-- Sin políticas nuevas: las de agent_runs (select/insert propios por `(select auth.uid())`) cubren la columna.

-- 1. Columna ----------------------------------------------------------------------------------
alter table public.agent_runs
  add column if not exists conversation_id uuid;

comment on column public.agent_runs.conversation_id is
  'Conversación de la consola (ADR-014). Lo genera el cliente; solo agrupa ejecuciones del mismo usuario.';

-- 2. Índice -----------------------------------------------------------------------------------
create index if not exists agent_runs_user_conversation_idx
  on public.agent_runs (user_id, conversation_id, created_at)
  where conversation_id is not null;

-- 3. Escritura atómica: igual que en 20261011120000_polis_sessions.sql, más conversation_id.
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
    turns, trace, steps, guardrails, usage, model, duration_ms, error, config, events, conversation_id
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
    coalesce(p_run -> 'events', '[]'::jsonb),
    nullif(p_run ->> 'conversation_id', '')::uuid
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
