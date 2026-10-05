-- Ápeiron: herramienta scholarly_search (OpenAlex vía el servidor MCP apeiron-scholar; ADR-011).
-- Se aplica con la CLI: `supabase db push` (ver supabase/README.md). Es idempotente.
-- Mantiene el catálogo alineado con las fábricas (AnaximandroFactory, HeraclitoFactory).

update public.agents
set tools      = '{formal_logic_calculator,scholarly_search,mcp_public_api_tool,vector_memory_retriever}',
    updated_at = now()
where id = 'anaximandro';

update public.agents
set tools      = '{vector_memory_retriever,scholarly_search,mcp_public_api_tool}',
    updated_at = now()
where id = 'heraclito';
