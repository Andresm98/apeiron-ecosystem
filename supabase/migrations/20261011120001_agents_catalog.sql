-- Ápeiron: catálogo de agentes generado desde los manifiestos (ADR-013, catálogo de agentes). NO editar a mano:
--   python -m apeiron_agents migration --write supabase/migrations
-- Se aplica con la CLI (`supabase db push`). Es idempotente.
-- apeiron-agents-catalog: c768a0939bdc7517

insert into public.agents (id, display_name, kind, role, tools, active) values
  ('anaximandro', 'Anaximandro', 'worker',
   'Worker principal: tesis desde el ápeiron, lógica formal y evidencia.',
   '{formal_logic_calculator,scholarly_search,mcp_public_api_tool,vector_memory_retriever}', true),
  ('epicuro', 'Epicuro', 'worker',
   'Prudencia: consecuencias, coste, utilidad y sufrimiento innecesario.',
   '{vector_memory_retriever,formal_logic_calculator}', true),
  ('feynman', 'Feynman', 'worker',
   'Verificación: mecanismo causal, experimentos y comprobación de hipótesis.',
   '{formal_logic_calculator,mcp_public_api_tool,scholarly_search,vector_memory_retriever}', true),
  ('heraclito', 'Heráclito', 'worker',
   'Worker dialéctico: devenir, tensión de opuestos y logos.',
   '{vector_memory_retriever,scholarly_search,mcp_public_api_tool}', true),
  ('nietzsche', 'Nietzsche', 'worker',
   'Crítica genealógica: origen de los valores, supuestos ocultos y contradicciones.',
   '{vector_memory_retriever,scholarly_search}', true)
on conflict (id) do update set
  display_name = excluded.display_name,
  kind         = excluded.kind,
  role         = excluded.role,
  tools        = excluded.tools,
  active       = true,
  updated_at   = now();

-- Un worker que ya no tiene carpeta queda inactivo: sus ejecuciones pasadas conservan la referencia.
update public.agents set active = false, updated_at = now()
where kind = 'worker' and active and id not in ('anaximandro', 'epicuro', 'feynman', 'heraclito', 'nietzsche');
