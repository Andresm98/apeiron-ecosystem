# AGENTS.md — Ápeiron Ecosystem

Contexto compartido para todo agente de código (Claude Code y compatibles) que trabaje en este repositorio. Los agentes especializados están en [`agents/`](agents/) y **todos parten de este fichero**.

> **Fuente de verdad, en orden:** el código, los tests, los [ADRs](docs/adr/) y el [README](README.md). Si este fichero contradice al código, gana el código y hay que corregir este fichero en el mismo cambio.

---

## 1. Qué es el sistema

Plataforma multiagente de razonamiento filosófico-científico:

- **Ápeiron**: el orquestador. Es un grafo LangGraph que enruta la pregunta (`single` o `debate`), supervisa los turnos y sintetiza.
- **Workers ReAct**: `anaximandro` y `heraclito`. Cada uno es un subgrafo LangGraph `reason ⇄ act` que llama a un LLM y a herramientas.
- **Herramientas**: `formal_logic_calculator` (lógica proposicional propia), `scholarly_search` (literatura con DOI vía el servidor MCP propio `apeiron-scholar` → OpenAlex), `mcp_public_api_tool` (arXiv) y `vector_memory_retriever` (Chroma con rerank híbrido BM25).
- **Simulación a 0 tokens**: `FakeLLM` determinista recorre el grafo completo con evidencia real de la memoria. Es la forma por defecto de probar cualquier cambio.
- **Identidad e historial**: Supabase Auth (JWT verificado por JWKS) y Postgres con RLS (`agent_runs`, `agents`, `agent_executions`). Hay un modo `local` alternativo (SQLite y JWT HS256) sin historial.
- **Observabilidad**: logs JSON con `trace_id`/`user_id`, trazas en LangSmith, uso de tokens por ejecución y el observatorio `/v1/system` + `/sistema` (salud de componentes, actividad del proceso, A2A y límites).
- **A2A 1.0 y guardrails** (ADR-011): Ápeiron es servidor A2A (`/a2a`, Agent Card) y puede sumar workers remotos A2A al debate. Los guardrails deterministas protegen la entrada, las observaciones, los turnos y la síntesis.
- **Entrega**: Docker Compose (api, chroma, web/Nginx, studio) y GitHub Actions → GHCR → EC2 por SSH.

## 2. Stack y versiones

| Área | Tecnología | Dónde se fija |
|---|---|---|
| Backend | Python ≥ 3.12 (CI 3.12/3.13/3.14; imagen 3.14; Studio 3.13) | `pyproject.toml` de cada paquete, `api.Dockerfile`, `langgraph.json` |
| API | FastAPI ≥ 0.115, Uvicorn, pydantic-settings ≥ 2.4 | `services/api/pyproject.toml` |
| Orquestación | **LangGraph** (`StateGraph`, `get_stream_writer`, `astream` con `subgraphs=True`) | `packages/core` (única lib de terceros permitida en `application`) |
| LLM | **LangChain** `init_chat_model` (≥ 0.3) + `langchain-openai` / `langchain-anthropic` | `packages/infra[llm]` |
| Trazas | **LangSmith** (variables de entorno que LangChain/LangGraph leen solas) | `infra/observability/langsmith.py` |
| Memoria | **ChromaDB** 1.5.9 (`chromadb-client`, HTTP) + BM25 propio | `packages/infra[chroma]`, compose |
| Integraciones | **MCP** SDK ≥ 1.0 (streamable HTTP), arXiv por httpx | `packages/infra[mcp]` |
| Resiliencia | tenacity (retry + jitter), circuit breaker propio | `infra/resilience/` |
| Auth | PyJWT[crypto] (HS256 / ES256 / RS256 / EdDSA vía JWKS), bcrypt | `infra/security/` |
| Datos | **Supabase** Postgres 17 + Auth + PostgREST, gestionado con la Supabase CLI (`npx supabase`) | `supabase/` |
| Frontend | Angular 22 standalone + signals, TypeScript ~6.0, rxjs 7.8, `@supabase/supabase-js` 2.x | `apps/web/package.json` |
| Tests | pytest + pytest-asyncio (`asyncio_mode=auto`), `node --test` con `--experimental-strip-types` | `pyproject.toml`, `apps/web/package.json` |
| Calidad | ruff (`E,F,I,UP,B,ASYNC`, línea 120), mypy estricto, import-linter | `pyproject.toml`, `.importlinter`, `Makefile` |
| Entrega | Docker, Nginx 1.27, GitHub Actions, GHCR, EC2 (Amazon Linux, `ec2-user`) | `deploy/`, `.github/workflows/` |

## 3. Mapa del monorepo

```text
packages/core/src/apeiron_core/            # NÚCLEO (sin SDKs de proveedor)
  domain/
    entities/agent_turn.py                 # AgentTurn TypedDict: agent, round, text, degraded, responds_to
    value_objects/mode.py                  # Mode = Literal["single", "debate"]
    value_objects/guardrail.py             # GuardrailVerdict (allow|redact|block), GuardrailRecord (sin texto)
    services/routing.py                    # decide_mode (DEBATE_HINTS), decide_agent (AGENT_HINTS por agente)
    services/guardrails.py                 # políticas deterministas: inyección, secretos/PII, protocolo, citas
  application/
    agents/base.py                         # dialogue_block (última posición de cada interlocutor), stream_emitter, emit_step
    agents/react.py                        # ReActAgent: subgrafo reason⇄act, regex Action/Final Answer, política de evidencia
    agents/factories.py                    # personas + AgentFactory (name, role, tools, create)
    agents/registry.py                     # AgentRegistry: register / describe / build_all
    orchestration/state.py                 # ApeironInput, ApeironState (reducers operator.add en turns/trace)
    orchestration/graph.py                 # build_graph: router → worker → supervisor → … → synthesis
    use_cases/chat.py                      # ApeironFacade: ask / stream, memoriza, registra la ejecución
    use_cases/execution.py                 # ExecutionCollector: stream LangGraph → ChatEvent + AgentExecution
    ports/inbound/chat.py                  # ChatUseCasePort
    ports/outbound/{llm,tools,memory,runs,agents,events,guardrails}.py
    guardrails.py                          # RuleGuardrails por etapa + apply_guardrail (política de fallo, traza)
    dto/{chat,runs}.py                     # ChatEvent, AgentRun, AgentExecution
    context.py                             # RequestContext (user_id, session_id, trace_id, channel, a2a_task_id, a2a_hops, access_token oculto)
    metrics.py                             # RuntimeMetrics: agregados en memoria por instancia (estados, canales, guardrails, latencia)
    usage.py                               # TokenUsage + usage_meter (ContextVar) + record_usage()
packages/infra/src/apeiron_infra/          # ADAPTADORES DE SALIDA
  llm/{langchain_llm,resilient,fake}.py
  memory/{vector,hybrid}.py                # ChromaVectorStore, InMemoryVectorStore, PRESOCRATIC_SEED, bm25 + hybrid_rerank
  tools/{formal_logic,public_api,scholarly,vector_memory}.py
  security/{supabase,tokens,users,rate_limit}.py
  persistence/supabase_runs.py             # SupabaseRunRepository (PostgREST + RPC, JWT delegado)
  resilience/{circuit_breaker,policies}.py
  observability/{logging,langsmith}.py
services/api/src/apeiron_api/              # ADAPTADOR DE ENTRADA + COMPOSITION ROOT
  main.py (create_app, middleware trace_id) · deps.py (current_user, rate limits) · settings.py
  routes/{auth,chat,memory,runs,system,a2a}.py · schemas.py · container.py · studio.py
  a2a/{card,tasks}.py                      # Agent Card y A2ATaskStore + run_task (ChatEvent -> eventos A2A)
services/mcp-scholar/src/apeiron_mcp_scholar/  # servidor MCP OpenAlex (independiente: no importa apeiron_*)
apps/web/src/app/                          # Angular: <contexto>/{domain,application,infrastructure,presentation}
  auth/ · research/ · observatory/ (/sistema) · shared/ · app.{ts,config.ts,routes.ts} · architecture.spec.ts
supabase/{config.toml,migrations/,README.md}
deploy/{docker/,nginx/,scripts/{deploy-ec2.sh,render_env.py,smoke_e2e.py},tests/,docker-compose.yml}
.github/workflows/{ci.yml,deploy-ec2.yml}
docs/{adr/0001…0011,DEPLOY.md}
langgraph.json · Makefile · .importlinter · pyproject.toml (config de herramientas, no es un paquete)
```

## 4. Flujo de una petición de punta a punta

```text
Angular (SseChatStreamAdapter, fetch POST + Bearer)
  → Nginx /api/ (proxy_buffering off, read_timeout 300s)
  → FastAPI middleware: trace_id (cabecera x-trace-id o uuid) en request_ctx
  → deps.current_user: tokens.decode en asyncio.to_thread → request_ctx(user_id, access_token)
  → deps.enforce_chat_rate (SlidingWindowLimiter, en memoria)
  → routes/chat.chat_stream → ApeironFacade.stream(question, mode, max_rounds, simulate)
       usage_meter.set(TokenUsage())
       graph.astream(inputs, config{run_name, tags, metadata}, stream_mode=["tasks","updates","custom"], subgraphs=True)
         apeiron_router → <worker> (subgraph.ainvoke: reason ⇄ act) → apeiron_supervisor → … → apeiron_synthesis
       ExecutionCollector.consume(namespace, kind, chunk) → ChatEvent(node|trace|step|turn)
       → ChatEvent(answer, usage) → _memorize (solo si no es simulación) → _record (RunRepositoryPort.save)
  → SSE: "event: <tipo>\ndata: <json>\n\n"; una excepción emite `error` {message:"internal_error", trace_id}
  ← Angular: parseFrame → reduceRunEvent (reducer puro) → ResearchStore (signals) → workspace / agent-graph / turn-card
```

## 5. Reglas no negociables

1. **Dirección de dependencias**: `apeiron_api → apeiron_infra → apeiron_core`; dentro de core, `application → domain`. Lo verifican los 4 contratos de [`.importlinter`](.importlinter) con `lint-imports`.
2. **Core sin proveedores**: `apeiron_core` no importa `fastapi`, `httpx`, `jwt`, `bcrypt`, `chromadb`, `langchain`, `mcp` ni `tenacity`. `langgraph` solo se permite en `application`, nunca en `domain`.
3. **Puertos como `typing.Protocol`** en `application/ports/`. Solo [`container.py`](services/api/src/apeiron_api/container.py) (y `studio.py`, que lo reutiliza) instancia clases concretas.
4. **Angular por capas** (lo verifica [`architecture.spec.ts`](apps/web/src/app/architecture.spec.ts)): `domain` no importa frameworks ni nada no relativo; `application` no importa `infrastructure` ni `presentation`; `presentation` no importa `infrastructure`.
5. **Identidad**: `user_id` sale siempre del token verificado (`deps.current_user`), nunca del body. El `access_token` viaja en `RequestContext` con `repr=False` y nunca se registra en logs.
6. **Supabase**: el esquema solo cambia con migraciones nuevas de la CLI, que deben ser idempotentes, con RLS por `(select auth.uid())`, sin acceso para `anon` y con RPC `security invoker` y `search_path = ''`. La app usa solo la **publishable key** más el JWT del usuario. Nunca se usa `service_role` ni SQL a mano en el dashboard.
7. **Contrato SSE estable** (§7): cualquier cambio toca a la vez backend, `sse-frame.parser`, `domain/chat.ts`, reducers, tests y README.
8. **Cotas duras**: rondas 1–4, participantes 1–4, pasos ReAct 1–8, timeout de nodo ≤ 300 s, timeout de herramienta ≤ 120 s, `recursion_limit` 100, pregunta ≤ 4000 caracteres. Se validan en `Settings`, `schemas.ChatRequest`, `_validate` del grafo y `ReActAgent.__init__`.
9. **Degradar, no caer**: si un worker o la síntesis falla, el turno se marca `degraded` o se devuelve una síntesis determinista. Un fallo de memoria o de Supabase solo deja un warning (`memorize_failed`, `run_persist_failed`). El evento `error` del SSE nunca expone detalles internos.
10. **El razonamiento privado no sale**: el `Thought` del ReAct nunca aparece en `answer`, `turn`, `step`, logs persistidos ni `agent_runs.steps`.
11. **Simulación primero**: todo cambio de agentes o del grafo debe funcionar con `FakeLLM`. La simulación no escribe en la memoria del usuario, pero sí guarda la ejecución (con `simulate=true`).
12. **Secretos**: `.env` nunca se versiona. Toda variable nueva usa el prefijo `APEIRON_` (salvo las claves de proveedor) y se añade a `.env.example`, que es la **plantilla del `.env` de producción** (ver `render_env.py`). Si una variable queda vacía, no lleva comentario en la misma línea.

## 6. Integraciones en detalle

### LangGraph (orquestación)
- **Grafo raíz** (`graph.py`): `StateGraph(ApeironState, input_schema=ApeironInput)` → `compile(name="apeiron").with_config(recursion_limit=100)`. Los nodos reservados son `apeiron_router`, `apeiron_supervisor` y `apeiron_synthesis`. Ningún agente puede llamarse `apeiron_*` ni `__*`.
- **Workers**: hay un nodo por agente registrado y aristas condicionales generadas desde `agents`. Si el agente expone `.graph`, el nodo hace `subgraph.ainvoke(...)` y Studio y el stream ven `reason`/`act`.
- **Estado**: `turns` y `trace` son listas con reducer `operator.add`, así que cada nodo devuelve solo lo nuevo. `speaker` es el índice dentro de `participants`.
- **Stream**: `stream_mode=["tasks","updates","custom"]` con `subgraphs=True` produce tuplas `(namespace, kind, chunk)`. `tasks` se convierte en eventos `node` (`anaximandro/act`). `updates` del grafo raíz se convierte en `turn`/`trace`/`answer`. `custom` (de `get_stream_writer`) se convierte en `trace` y `step`.
- **Studio**: `langgraph.json` expone `apeiron` (LLM real) y `apeiron_demo` (simulación), construidos por `studio.py` con la misma composición que la API (sin JWT; usuario `anonymous`; grafo cacheado por event loop).
- **Sin checkpointer**: no hay memoria conversacional implícita entre invocaciones (pendiente en ADR-009).

### LangChain (LLM)
- `LangChainLLM` usa `init_chat_model(model, model_provider=provider, temperature=0.2, max_tokens, reasoning_effort?)` con import diferido. Lee `msg.usage_metadata` y llama a `record_usage()` y a `log.info("llm_call", …)`.
- `ResilientLLM` envuelve en este orden: `breaker( retry( timeout(primary) ) )` → si falla, `fallback` (`APEIRON_LLM_FALLBACK_MODEL`).
- El puerto es mínimo: `LLMPort.complete(system, user) -> str`. El núcleo no conoce mensajes, herramientas nativas ni structured output de LangChain. ReAct usa un **protocolo de texto** (`Thought/Action/Action Input/Observation/Reflect/Final Answer`) parseado con regex tolerantes.
- Proveedores: `fake` | `openai` | `anthropic`, con claves `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`. El modelo por defecto en `Settings` es `claude-sonnet-5`, y `.env.example` usa `openai`/`gpt-5.6-luna` con `reasoning_effort=low`.

### LangSmith (trazas)
- `configure_langsmith` activa `LANGSMITH_*` y `LANGCHAIN_*` (tracing v2) por entorno. No hay SDK en el núcleo.
- `ApeironFacade._config` fija `run_name="apeiron_chat"`, `tags=["apeiron", "live"|"simulation"]` y `metadata={trace_id, user_id, session_id, simulate}`. El `X-Trace-Id` correlaciona HTTP, logs y traza.

### Supabase (identidad, sesiones, historial)
- **Auth (navegador)**: `RuntimeAuthGateway` lee `/v1/auth/config` y, si el proveedor es `supabase`, carga de forma diferida `@supabase/supabase-js` con `persistSession`, `autoRefreshToken` y `detectSessionInUrl`. La sesión vive en `localStorage`, así que un XSS es crítico.
- **Verificación (API)**: `SupabaseTokenVerifier` usa el JWKS en `<url>/auth/v1/.well-known/jwks.json` (caché de 1 h; ES256/RS256/EdDSA) o HS256 legacy con `APEIRON_SUPABASE_JWT_SECRET`. Exige `aud=authenticated`, `iss=<url>/auth/v1`, `exp` y `sub`. `user_id` = `sub` (UUID).
- **Persistencia**: `SupabaseRunRepository` envía `POST /rest/v1/rpc/record_agent_run` con `{p_run, p_agents}` y cabeceras `apikey: <publishable>` y `Authorization: Bearer <JWT del usuario>`. Las lecturas van a `GET /rest/v1/agent_runs` con filtro explícito `user_id=eq.` además de RLS. El detalle embebe `agent_executions(...)`.
- **Esquema** (`supabase/migrations/`):
  - `agent_runs`: inmutable (sin UPDATE). Columnas jsonb `turns`, `trace`, `steps` y `usage`; `status ∈ {completed, error}`.
  - `agents`: catálogo de solo lectura, con `id ~ '^[a-z][a-z0-9_]{1,40}$'` y `kind ∈ {orchestrator, worker}`. Se carga con upsert.
  - `agent_executions`: clave primaria `(run_id, agent_id)`; el insert se permite solo si el run es propio.
  - `record_agent_run`: transacción atómica. Fuerza `auth.uid()` e ignora agentes que no estén en el catálogo.
- **Modo `local`**: no hay historial (`/v1/runs` → 404, `runs_enabled=false`).

### ChromaDB (memoria vectorial)
- Colección `apeiron_memory`. Los ids son `sha1(user_id:text)` con upsert idempotente. Metadatos: `user_id` y `created_at`.
- Búsqueda: `where user_id ∈ {usuario, "global"}`, combinando una consulta semántica (`k*4`) con un `get` léxico, y después `hybrid_rerank` (pesos 0.6/0.4, que deben sumar 1). Cada fragmento lleva `[source=global|user]`.
- Retención: `APEIRON_MEMORY_MAX_DOCS_PER_USER` (200) se aplica por `created_at`. `PRESOCRATIC_SEED` se siembra al arrancar. El cliente es síncrono y se aísla con `asyncio.to_thread`.
- `InMemoryVectorStore` es el double que se usa en desarrollo y tests (`APEIRON_VECTOR_BACKEND=memory`).

### Guardrails (ADR-011)
- `GuardrailPort.check(stage, text, evidence)` con etapas `input` (router), `observation` (`ReActAgent._act`), `turn` (nodo del worker) y `output` (síntesis). No hay nodos extra: el SSE y el SVG no cambian.
- `RuleGuardrails` (núcleo, 0 tokens, activo con `APEIRON_GUARDRAILS_ENABLED=true`, también en simulación):
  - `input`: bloquea la inyección directa y la suplantación de rol. Una pregunta bloqueada llega a la síntesis con `BLOCKED_ANSWER`, se guarda con `status='blocked'` y no se memoriza.
  - `observation`: neutraliza la inyección indirecta.
  - En todas las etapas redacta secretos y PII. En `input` solo secretos.
  - `turn` y `output`: remedian citas (URL, arXiv o DOI) que no estén en `evidence`, que son las observaciones reales acumuladas en `WorkerState`/`ApeironState`.
- Política de fallo: `input` falla cerrado (`guardrail_unavailable`); el resto falla abierto con `guardrail_failed`. Los registros (`GuardrailRecord`) y los logs nunca llevan el texto.
- Un patrón nuevo va en `domain/services/guardrails.py` con casos positivos **y** negativos en `test_guardrails.py`. Una pregunta filosófica legítima no puede bloquearse.

### A2A 1.0 (ADR-011, fases 2 y 3)
- **Implementación propia** del binding JSON-RPC (sin `a2a-sdk`, que en 1.x arrastra protobuf y google-api-core): `apeiron_infra/a2a/wire.py` es la única fuente del formato (proto3 JSON camelCase, `TASK_STATE_*`, `ROLE_*`, respuestas `{task}|{statusUpdate}|{artifactUpdate}`). Al cambiar algo, revalidar contra los protobuf del SDK (ver ADR-011).
- **Servidor** (`routes/a2a.py`, desactivado por defecto):
  - La card es pública; `/a2a` usa el mismo Bearer y rate limit que el chat.
  - Cada tarea corre en una `asyncio.Task` con **contexto limpio** (`contextvars.Context()` + `request_ctx` con `channel="a2a"`, `a2a_task_id` y `a2a_hops`) y sobrevive a la desconexión del cliente.
  - El `A2ATaskStore` vive en memoria y está acotado. Una tarea ajena es `TaskNotFound`.
- **Cliente** (`A2ARemoteAgent`):
  - Credencial propia por agente (`token_env`), nunca el JWT del usuario.
  - Allowlist y `https` (salvo localhost), validadas también sobre la URL que anuncia la card.
  - Breaker por agente y respuesta acotada.
  - `metadata.apeironHops` y `APEIRON_A2A_MAX_HOPS` cortan bucles de delegación.
  - En simulación, `RemoteAgentFactory` sin adaptador crea un ReAct local del mismo nombre.

### Observatorio (`GET /v1/system`)
- Lo construye `routes/system.py` desde el `Container`: breakers con nombre (`llm`, `external_sources`, uno por remoto), sondas (`probes["memory"]` = `store.size()` con timeout de 2 s), `RuntimeMetrics.snapshot()`, `A2ATaskStore` (conteos y tareas **propias**) y el cupo `SlidingWindowLimiter.remaining`.
- Solo agregados del proceso y datos del propio usuario: nunca preguntas ajenas, secretos ni detalles de error.
- Un componente nuevo con estado (otra dependencia externa) debe aparecer aquí con `ok|degraded|down|disabled|simulated`.

### MCP académico (`apeiron-scholar`)
- Servidor propio (`services/mcp-scholar`, SDK MCP **2.x** `MCPServer`, streamable HTTP sin estado): herramienta `search(query, limit 1–5)` → obras de OpenAlex con **DOI literal**. Viaja en la imagen de la API (`python -m apeiron_mcp_scholar`), servicio `mcp-scholar` de Compose sin puerto publicado, protección DNS rebinding (`APEIRON_SCHOLAR_ALLOWED_HOSTS`).
- Cliente: `ScholarlySearchTool` (`scholarly_search`) sobre `McpSdkGateway` + breaker `scholarly_sources`; activo si `APEIRON_SCHOLAR_MCP_URL`. La descripción que ve el LLM es la nuestra (nunca la del servidor: anti *tool poisoning*).
- Tests por el protocolo MCP real en proceso (`httpx2.ASGITransport` + `app.router.lifespan_context`), sin red.

### MCP y arXiv
- `McpPublicApiTool`: si existe el legado `APEIRON_MCP_SERVER_URL`, usa `McpSdkGateway` (streamable HTTP, herramienta `search` con `{"query": ...}`) en lugar de arXiv. Si no, usa `ArxivClient` (`all:a AND all:b…`, ordenado por relevancia, reintenta con 2 términos).
- Usa `CircuitBreaker` y `call_with_retry(attempts=2, timeout_s=15)`. Si falla, devuelve como observación el texto *"Fuente externa no disponible…"* y el agente continúa.

## 7. Contrato público

**REST** (`/healthz` y `/v1/auth/*` son públicos; el resto requiere Bearer):

| Método | Ruta | Notas |
|---|---|---|
| GET | `/healthz` | Lo usan Docker, el deploy y el smoke |
| GET | `/v1/auth/config` | `{provider, public_register, runs_enabled[, supabase_url, supabase_key]}` |
| POST | `/v1/auth/register`, `/v1/auth/token` | Solo en modo local (404 en supabase); rate limit por IP |
| GET | `/v1/agents` | Topología: `orchestrator`, `agents[{name, role, tools}]`, `debate_participants`, `modes`, `llm`, `limits` |
| POST | `/v1/chat`, `/v1/chat/stream` | Body `{question ≤4000, mode?, max_rounds? 1–4, simulate?}`; rate limit por usuario |
| DELETE | `/v1/memory` | Borra la memoria del usuario (204) |
| GET | `/v1/runs?limit=1..100`, `/v1/runs/{uuid}` | 404 sin Supabase, 502 si Supabase falla |
| GET | `/v1/system` | Observatorio: `service`, `components[]`, `activity`, `a2a{server_enabled, card_url, tasks, my_tasks}`, `limits` |
| GET | `/.well-known/agent-card.json` | Pública; 404 si `APEIRON_A2A_SERVER_ENABLED=false` |
| POST | `/a2a` | JSON-RPC A2A 1.0 (`SendMessage`, `SendStreamingMessage`, `GetTask`, `CancelTask`); cabecera `A2A-Version` 1.x |

**SSE** (`/v1/chat/stream`):

| Evento | `data` |
|---|---|
| `node` | `{node: "apeiron_router" \| "anaximandro/act", status: "start"\|"end", error: bool}` |
| `trace` | `{messages: string[]}` |
| `step` | `{agent, round, step, tool, input≤200, observation≤480, error, auto}` |
| `turn` | `{agent, round, text, degraded, responds_to}` |
| `guard` | `{stage: input\|observation\|turn\|output, action: redact\|block, rules, agent, round}` (sin texto) |
| `answer` | `{answer, mode, simulate, blocked, usage: {calls, input_tokens, output_tokens, total_tokens}}` |
| `error` | `{message: "internal_error", trace_id}` (lo emite la ruta, no `ChatEvent`) |

## 8. Recetas de extensión (todos los puntos que hay que tocar)

### Nuevo agente worker (p. ej. `socrates`)
1. **core/application**: persona y `SocratesFactory` en `agents/factories.py` (`name`, `role`, tupla `tools`).
2. **core/domain**: palabras clave en `AGENT_HINTS` de `services/routing.py` si debe poder elegirse en modo `single`.
3. **api**: `registry.register(SocratesFactory())` en `_registry()` de `container.py`. Si participa en debates, añadirlo a `APEIRON_DEBATE_PARTICIPANTS` (máximo 4).
4. **infra/simulación**: `_speaker` y `STANCES` en `llm/fake.py` (y `_label` si el nombre lleva tilde) para que la simulación sea creíble.
5. **supabase**: migración nueva que inserte el agente en `public.agents` (upsert). Sin esa fila, `agent_executions` lo omite en silencio.
6. **web**: `agentLabel` en `research/presentation/agent-label.ts`. Revisar `DEFAULT_AGENTS` (`domain/topology.ts`) y la disposición del SVG en `agent-graph`.
7. **tests**: topología (`describe()`, `/v1/agents`), orden de turnos, simulación sin tokens y routing de dominio.
8. **docs**: tablas de workers en el README y, si cambia la topología, un ADR.

### Nuevo worker remoto (A2A)
1. `APEIRON_A2A_REMOTE_AGENTS` con `{name, url, role, token_env}`, el host en `APEIRON_A2A_ALLOWED_HOSTS` y el secret `APEIRON_A2A_TOKEN_<NOMBRE>` en el `.env` de la VM (`docs/DEPLOY.md`).
2. Si debe debatir, añadirlo a `APEIRON_DEBATE_PARTICIPANTS`.
3. **supabase**: migración que inserte su fila en `public.agents` con `kind='remote'`.
4. **web**: `agentLabel` si el nombre lleva tilde. El grafo y las tarjetas lo marcan como A2A a partir de `kind`.
5. No hace falta código: el composition root construye el `A2ARemoteAgent` y la simulación usa el sustituto local.

### Nueva herramienta
1. Clase en `infra/tools/` con `name`, `description` (con instrucciones de entrada para el LLM) y `async run(tool_input: str) -> str`. Debe devolver errores como texto controlado y nunca usar `eval`.
2. Si hace I/O, usar `CircuitBreaker` + `call_with_retry` + timeout, con el `httpx.AsyncClient` compartido del container.
3. Registrarla en `_build_tools()` (también vale para Studio) y añadirla a la tupla `tools` de las fábricas que la usen, al catálogo `agents.tools` (migración) y a la tabla de herramientas del README.
4. Si cambia la política de evidencia, revisar `FALLBACK_TOOLS` en `react.py`.

### Nuevo puerto o adaptador
`Protocol` en `application/ports/outbound/` → adaptador en `infra/<área>/` → cableado en `container.py` (con `Settings`) → double en tests → contrato de import-linter en verde.

### Nuevo endpoint
Ruta en `routes/` con `Depends(current_user)` o `enforce_chat_rate`, modelos Pydantic en `schemas.py`, `include_router` en `main.py`, validación de ids (por ejemplo `uuid.UUID`) para no inyectar filtros PostgREST, test en `services/api/tests` y tabla de API en el README.

### Nueva tabla o columna en Supabase
`npx supabase migration new <nombre>` → SQL idempotente con RLS y grants explícitos (y `revoke` para `anon`) → actualizar `supabase/README.md` → adaptador en `infra/persistence` → tests de cabeceras y filtros (`test_supabase.py`).

### Nueva feature web
`domain` (tipos y funciones puras + `*.spec.ts`) → `application` (puerto abstracto, reducer puro, store con signals) → `infrastructure` (adaptador HTTP/SSE y `*.providers.ts`) → `presentation` (componente standalone en ruta lazy).

### Nueva variable de configuración
Campo en `Settings` con `Field(ge/le)` → `.env.example` → validación en `deploy/scripts/render_env.py` si es obligatoria en producción (y su test en `deploy/tests`) → tabla de configuración del README → `docs/DEPLOY.md` si es un secret.

### Decisión arquitectónica
`docs/adr/00NN-<slug>.md` con las secciones **Estado**, **Fecha**, **Contexto**, **Alternativas**, **Decisión**, **Consecuencias** y **Estado actual y brechas**. Si reemplaza a otro ADR, se indica en ambos. Hay que añadir la fila en la tabla de ADRs del README.

## 9. Comandos

```sh
make install                 # pip -e core, infra[llm,chroma,mcp], api + pytest, ruff, mypy, import-linter
make check                   # ruff check . && mypy (3 src) && lint-imports
make test                    # pytest -q (core, infra, api, deploy/tests)
APEIRON_LLM_PROVIDER=fake APEIRON_AUTH_PROVIDER=local APEIRON_VECTOR_BACKEND=memory make run   # API sin coste en :8000
cd apps/web && npm ci && npm start -- --proxy-config proxy.conf.json                         # http://localhost:4200
cd apps/web && npm test      # node:test (reducers, parser, auth, architecture.spec)
cd apps/web && npm run build -- --configuration production
docker compose -f deploy/docker-compose.yml --profile web up --build        # stack completo en http://localhost
docker compose -f deploy/docker-compose.yml --profile studio up --build studio   # LangGraph Studio :2024
docker compose -f deploy/docker-compose.yml exec -T api python - < deploy/scripts/smoke_e2e.py
npx supabase migration new <nombre> | migration list | db push              # SOLO con confirmación del usuario si es remoto
```

**Definición de terminado**: `make check`, `make test`, `npm test` y el build de producción de Angular en verde; el cambio probado en simulación; README, ADR, `.env.example` y `supabase/README.md` alineados.

## 10. Tests existentes (dónde añadir los nuevos)

| Fichero | Cubre |
|---|---|
| `packages/core/tests/test_core.py` | Routing, topología, subgrafos, turnos, ReAct, degradación, eventos de nodo y uso de tokens |
| `packages/core/tests/test_agentic.py` | Evidencia por paso, interlocutor (`responds_to`) y métricas por agente |
| `packages/core/tests/test_eval.py` | Evals deterministas: uso de herramientas, citas, fidelidad de síntesis y sin inventar evidencia |
| `packages/core/tests/test_guardrails.py` | Guardrails: inyección directa e indirecta, falsos positivos, secretos/PII, fuga del Thought, citas, política de fallo, ejecución bloqueada |
| `packages/core/tests/test_runs.py` | Registro de ejecuciones (completadas, con error, simulación) y aislamiento de fallos |
| `packages/infra/tests/test_infra.py` | Retry/timeout, breaker (incluido el half-open concurrente), fallback LLM, adaptador LangChain con stub, lógica formal, arXiv, memoria por usuario, Chroma (cliente simulado), JWT, SQLite y JsonFormatter |
| `packages/infra/tests/test_simulation.py` | `FakeLLM` y simulación |
| `packages/infra/tests/test_supabase.py` | Verificador (HS256/ES256) y repositorio (cabeceras, filtros, RPC) |
| `services/api/tests/test_api.py`, `test_supabase_api.py` | Contrato REST/SSE, límites, simulación sin tokens, `/v1/runs`, config |
| `services/api/tests/test_a2a_api.py` | Servidor A2A (card, JSON-RPC, streaming, errores, dueño, cancelación), `/v1/system`, Ápeiron ⇄ Ápeiron por A2A y corte de bucles |
| `services/mcp-scholar/tests/test_scholar.py` | Servidor MCP: formato OpenAlex con DOI, límites, protocolo MCP real en proceso, errores controlados, DNS rebinding |
| `packages/infra/tests/test_a2a_client.py` | Cliente A2A: SSRF/https, credencial propia, streaming y SendMessage, breaker, límite de saltos |
| `deploy/tests/test_render_env.py` | Plantilla `.env` y validaciones de producción |
| `apps/web/src/app/**/*.spec.ts` | Parser SSE, reducers (incl. `guard` y eventos desconocidos), graph-run, dialogue, sanitizer, auth, guardrails, observatorio y capas |

Los doubles se escriben a mano (clases con `complete`/`run`). Nunca se llama a LLMs ni a la red reales.

## 11. Deuda conocida y hoja de ruta

Datos para planificar. Verificar contra el código antes de actuar.

- **CI no ejecuta `npm test`** (solo `npm ci` + build). Las reglas de capas del frontend no bloquean un PR.
- **ADRs desactualizados**: ADR-001 (habla de un `app.ts` único), ADR-003 (`Send`/`round_gate`, reemplazado por 009), ADR-005 (token solo en memoria, reemplazado por 010) y una contradicción entre ADR-006 y ADR-007 sobre CRLF en SSE: `parseFrame` normaliza `\r\n`, pero `SseChatStreamAdapter` separa los frames con `\n\n`, así que un servidor que use `\r\n\r\n` no se partiría bien.
- **Pendientes declarados**: CSP en Nginx y retención/borrado de historial desde la UI (ADR-010); checkpointer persistente y síntesis que cite la evidencia (ADR-009); TLS real y backups probados de `chroma-data`/`api-data` (ADR-008).
- **Escala horizontal**: `SlidingWindowLimiter`, `A2ATaskStore` y `RuntimeMetrics` viven en memoria y aplican por instancia. Hace falta un adaptador compartido antes de tener más de una réplica.
- **A2A pendiente**: notificaciones push, `SubscribeToTask`, `ListTasks`, `input-required`, continuar tareas por `taskId`, firma de la card y un test automático contra `a2a-sdk` (hoy la validación se hizo a mano; ADR-011).
- **Puntos de acoplamiento por nombre de agente**: `AGENT_HINTS` (dominio), `STANCES`/`_speaker` (`FakeLLM`), `agentLabel` y `DEFAULT_AGENTS` (web) y las personas del catálogo SQL. Se pueden mover a datos declarados por la fábrica o la topología.
- **Candidatos de producto** ya previstos: nuevos workers (Sócrates, Anaxágoras), migrar la memoria a pgvector (fuera de alcance según ADR-010), Markdown/KaTeX en la UI y pruebas de navegador.
- `supabase/config.toml` apunta a `./seed.sql`, que no existe.
- `deploy/scripts/render_env.py` y `deploy/tests/` se citan en este fichero (§3, §5.12, §8, §10), pero no existen en el repo.

## 12. Convenciones

- **Idioma**: identificadores en inglés; docstrings, comentarios, ADRs, README, mensajes de log legibles y textos de UI en **español**. Los nombres de evento de log van en `snake_case` inglés (`llm_call`, `agent_turn`).
- **Python**: docstring de módulo de una línea, `Protocol` para puertos, `TypedDict`/`dataclass(frozen=True)` para DTOs, `async` en todo I/O, imports diferidos para extras opcionales (`langchain`, `chromadb`, `mcp`), y logs con `extra={...}` en lugar de f-strings con datos.
- **TypeScript**: los ficheros que alcanza un spec (todo `domain`, los reducers de `application` y parsers y traductores de errores de `infrastructure`) usan `import type` y la extensión explícita `.ts` (los specs se ejecutan con `node --experimental-strip-types`). Infraestructura y presentación usan imports de Angular sin extensión.
- **Commits**: pequeños, con prefijo convencional (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`). No se hace commit ni push sin que el usuario lo pida.
- **Coste**: con un LLM real hay que medirlo. Referencia con `gpt-5.6-luna` y `low`: consulta ≈ 360 tokens (1 llamada), debate de 1 ronda ≈ 2.300 tokens (3 llamadas), ≈ 6.500 con `REQUIRE_EVIDENCE`.

## 13. Agentes especializados y flujo de trabajo

| Agente | Fichero | Dominio |
|---|---|---|
| `architect` | [agents/architect.md](agents/architect.md) | Diseño transversal, ADRs, planes por fases, evolución de la topología agéntica |
| `backend` | [agents/backend.md](agents/backend.md) | Python: dominio, LangGraph, ReAct, LangChain, herramientas, Chroma, Supabase (adaptador), FastAPI |
| `frontend` | [agents/frontend.md](agents/frontend.md) | Angular 22: contextos, signals, SSE, supabase-js, grafo en vivo, historial |
| `infra` | [agents/infra.md](agents/infra.md) | Supabase (migraciones/RLS/CLI), Docker, Nginx, CI/CD, EC2, Chroma, Studio, LangSmith |
| `reviewer` | [agents/reviewer.md](agents/reviewer.md) | Revisión de diffs contra este documento; solo lectura |

**Flujo**: `architect` (plan + ADR) → `backend` / `infra` / `frontend` (en el orden de dependencia: esquema → adaptador → API → web) → `reviewer` → el usuario decide el commit.

**Traspaso entre agentes**: cada agente termina con este bloque, para que el siguiente no tenga que recuperar el contexto desde cero:

```
## Traspaso
- Hecho: <archivos por capa>
- Verificado: <comandos y resultado real>
- Contratos tocados: <SSE/REST/puertos/esquema o "ninguno">
- Pendiente para <agente>: <tareas concretas>
- Riesgos/no verificado: <lista>
```
