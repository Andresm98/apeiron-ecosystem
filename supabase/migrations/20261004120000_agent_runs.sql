-- Ápeiron: ejecuciones de agentes por usuario (ADR-010).
-- Se aplica con la CLI: `supabase db push` (ver supabase/README.md). Es idempotente.

create table if not exists public.agent_runs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trace_id    text not null default '-',
  question    text not null check (char_length(question) <= 4000),
  mode        text not null default '',
  simulate    boolean not null default false,
  status      text not null check (status in ('completed', 'error')),
  answer      text not null default '',
  turns       jsonb not null default '[]'::jsonb,
  trace       jsonb not null default '[]'::jsonb,
  usage       jsonb not null default '{}'::jsonb,
  model       text not null default '',
  duration_ms integer not null default 0 check (duration_ms >= 0),
  error       text
);

comment on table public.agent_runs is 'Ejecuciones del grafo Ápeiron (pregunta, turnos, síntesis, traza y consumo).';

create index if not exists agent_runs_user_created_idx
  on public.agent_runs (user_id, created_at desc);

-- RLS: cada usuario solo ve e inserta sus ejecuciones. La API escribe con el JWT del
-- usuario, así que no necesita la service_role key. Sin UPDATE: el registro es inmutable.
alter table public.agent_runs enable row level security;

drop policy if exists "agent_runs_select_own" on public.agent_runs;
create policy "agent_runs_select_own" on public.agent_runs
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "agent_runs_insert_own" on public.agent_runs;
create policy "agent_runs_insert_own" on public.agent_runs
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "agent_runs_delete_own" on public.agent_runs;
create policy "agent_runs_delete_own" on public.agent_runs
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, delete on public.agent_runs to authenticated;
revoke all on public.agent_runs from anon;
