# ADR-011: Protocolo A2A y guardrails para la comunicación agéntica

**Estado:** IMPLEMENTADO: fase 1 (guardrails), fase 2 (servidor A2A) y fase 3 (workers remotos A2A), más el panel de sistema. Amplía ADR-009 y ADR-010 de acuerdo a lo planeado; no reemplaza a ninguno.  
**Fecha:** 2026-10-03

## Contexto

Ápeiron es hoy un sistema cerrado: los workers (`anaximandro`, `heraclito`) viven en el mismo proceso y solo se alcanzan por la API propia (`/v1/chat`, `/v1/chat/stream`), cuyo contrato SSE es específico de este proyecto. Para que otros agentes puedan consultar a Ápeiron, o para que Ápeiron incorpore especialistas externos al debate, hace falta un protocolo estándar entre agentes. **A2A (Agent2Agent)** cubre ese hueco: descubrimiento por *Agent Card*, tareas con ciclo de vida, streaming y esquemas de seguridad declarados. Es complementario a MCP (ADR-004), que conecta un agente con herramientas, no con otros agentes.

Abrir el sistema a otros agentes amplía la superficie de ataque. Hoy el contenido no confiable entra solo por las herramientas (arXiv, MCP, memoria) y llega sin filtrar al `scratch` del ReAct. Con A2A, entraría también el **texto completo de un turno** de un agente remoto, que `dialogue_block` inyecta en el prompt del siguiente orador. Por eso los **guardrails** (validación de la entrada, de las observaciones, de los turnos y de la salida) forman parte de la misma decisión y deben estar operativos antes de consumir agentes remotos.

La integración no es estructuralmente crítica: el grafo, la facade y el contrato SSE siguen igual. Aporta interoperabilidad y una capa de seguridad explícita a la arquitectura agéntica.

## Alternativas

1. **Exponer solo REST/SSE propio** y documentarlo: no es interoperable; cada cliente agéntico necesitaría un adaptador a medida.
2. **Multiagente remoto vía MCP** (cada agente como "tool" MCP): MCP modela herramientas sin estado, no tareas con ciclo de vida, cancelación ni diálogo entre pares.
3. **A2A en ambos sentidos con guardrails como puerto del núcleo** (adoptada): servidor A2A como adaptador de entrada sobre la facade, cliente A2A como adaptador de salida que implementa `SpecialistAgent` y un `GuardrailPort` que aplica el grafo.
4. **Guardrails solo con una librería externa** (NeMo Guardrails, Guardrails AI, Llama Guard) dentro del núcleo: acopla el núcleo a un proveedor (rompe `core-is-vendor-free`) y cuesta tokens incluso en simulación.

## Decisión

Se adopta la alternativa 3, en tres fases. Los guardrails están **activos por defecto**, porque son deterministas y no cuestan tokens; el servidor A2A queda desactivado por defecto y los workers remotos solo existen si se configuran.

```
                 Agent Card (/.well-known/agent-card.json)
cliente A2A ──► /a2a (JSON-RPC A2A 1.0: SendMessage · SendStreamingMessage · GetTask · CancelTask)
                 └─ A2AExecutor ──► ApeironFacade.stream() ──► ChatEvent ──► eventos A2A

START → apeiron_router[input] → <worker>[turn] → apeiron_supervisor → … → apeiron_synthesis[output] → END
            └─ bloqueada ─────────────────────────────────────────────────┘
                                 ├─ ReActAgent: act → [observation] → scratch + evidence
                                 └─ A2ARemoteAgent.respond() → [turn] → AgentTurn   (fase 3)
```

### Guardrails (fase 1)

**Modelo de amenazas.** Cada amenaza tiene un punto de control y una acción concreta:

| Amenaza | Dónde entra | Etapa | Control | Acción |
|---|---|---|---|---|
| Inyección directa de prompts (anular instrucciones, revelar el prompt del sistema, "actúa sin restricciones") | pregunta del usuario | `input` | `detect_injection` | **block**: ningún worker actúa, respuesta determinista, 0 llamadas LLM |
| Suplantación de rol (`<\|im_start\|>`, `[INST]`, líneas `System:`/`Sistema:`) | pregunta, observaciones, turnos | todas | `role_spoofing` | block en `input`; en el resto se sustituye la línea |
| Suplantación del protocolo ReAct (`Observation:` o `Final Answer:` falsos) | pregunta, observaciones | `input`, `observation` | `defang_protocol` | redact: `Observation (citado) -` ya no se lee como un paso real |
| Inyección indirecta (instrucciones dentro de arXiv, MCP o la memoria) | observaciones de las herramientas | `observation` | `neutralize_injection` + regla de sistema `DATA_RULE` (*spotlighting*) | redact: la línea se sustituye antes de entrar al `scratch`, al stream y a la persistencia |
| Inundación de contexto | observaciones | `observation` | `truncate` (4000 caracteres) | redact |
| Fuga de secretos y PII (claves `sk-`, `sb_secret_`, JWT, AWS, GitHub, `password=`; correos y teléfonos) | pregunta (solo secretos), observaciones, turnos, salida | todas | `redact_sensitive` | redact: tampoco se persiste ni se memoriza la pregunta original |
| Fuga del razonamiento privado (regla 10) | turnos y salida | `turn`, `output` | `drop_private_reasoning` | redact: se quitan las líneas `Thought`/`Action`/`Reflect` |
| **Alucinación de citas** (URL, id de arXiv o DOI que no salen de ninguna herramienta) | turnos y síntesis | `turn`, `output` | `ground_citations` contra la **evidencia real** de la ejecución | **remediación**: la cita se sustituye por `[cita no verificada]`; en la síntesis se añade una nota de Ápeiron |
| Evidencia afirmada sin consulta ("según la memoria", `[source=…]` sin observaciones) | turnos | `turn` | `claims_evidence` sin evidencia | remediación: se añade un aviso de "opinión sin respaldo" |

**Diseño:**

- **Dominio** (Python puro, sin dependencias):
  - `domain/value_objects/guardrail.py`:
    - `GuardrailVerdict(stage, action: allow|redact|block, text, rules)`.
    - `GuardrailRecord` (`stage`, `action`, `rules`, `agent`, `round`), que **nunca incluye el texto**.
  - `domain/services/guardrails.py`: las políticas deterministas de la tabla. Son conservadoras a propósito: un patrón solo cuenta si apunta a *las instrucciones del sistema*. Por ejemplo, "¿qué pasa si ignoramos las reglas de la lógica?" no se bloquea.
- **Puerto:** `GuardrailPort.check(stage, text, evidence=()) -> GuardrailVerdict`. Es opcional: sin él, el grafo se comporta exactamente como antes.
- **Aplicación:**
  - `application/guardrails.py`:
    - `RuleGuardrails` compone las políticas por etapa.
    - `apply_guardrail` aplica la política de fallo, registra solo los veredictos distintos de `allow` y emite una traza pública (`[anaximandro Guardrail observation: redact (prompt_injection)]`).
  - Se integra en los nodos existentes:
    - **router** (`input`): una pregunta bloqueada salta a la síntesis. Si se redacta, los workers solo ven la versión saneada.
    - **worker** (`turn`): verifica las citas contra `evidence` (la de este turno más la de los turnos previos).
    - **síntesis** (`output`).
    - **`ReActAgent._act`** (`observation`): sanea la observación y la acumula en `evidence`.
  - **No se añaden nodos** `apeiron_guard_*`. La primera versión de este ADR los preveía, pero obligaban a cambiar el SVG y las aristas de la web sin aportar control nuevo. Los veredictos se ven igualmente en la traza (SSE `trace`), en los logs y en el registro.
- **Evidencia real:**
  - `WorkerState.evidence` y `ApeironState.evidence` (reducer `operator.add`) guardan las observaciones ya saneadas.
  - Una cita está respaldada solo si aparece literalmente en ellas, normalizando el esquema (`http`/`https`), `www.` y la versión de arXiv (`v1`/`v2`).
  - Queda pendiente de ADR-009 que la síntesis cite la evidencia; esto es lo previo necesario para hacerlo.
- **Política de fallo:**
  - *Fail-closed* en `input`: si el guardrail lanza una excepción, la pregunta se bloquea con la regla `guardrail_unavailable`.
  - *Fail-open con warning* (`guardrail_failed`) en `observation`, `turn` y `output`, coherente con "degradar, no caer".
- **Privacidad:** los logs (`guardrail`: `stage`, `guard_action`, `rules`) y la persistencia nunca incluyen el texto evaluado. La pregunta persistida y memorizada es la saneada.
- **Ejecución bloqueada:**
  - Termina con un `answer` normal, no con `error`, así que el contrato SSE no cambia.
  - Se persiste con `status='blocked'`.
  - **No se memoriza.**
- **Persistencia:** la migración `20261005120000_run_guardrails.sql` añade `blocked` al check de `agent_runs.status`, la columna `guardrails jsonb` y la nueva versión de `record_agent_run`.
- **Fuera de la fase 1, para no sobredimensionar:**
  - `LlmJudgeGuardrails` y librerías externas (NeMo Guardrails, Guardrails AI, Llama Guard). Encajan como adaptadores del puerto en `infra/guardrails/`, con import diferido y su coste medido.
  - La verificación semántica de afirmaciones (*NLI*/LLM-as-judge), más allá de las citas verificables.

### Implementación del protocolo: A2A 1.0 propio, validado con el SDK oficial

El ADR preveía usar `a2a-sdk`. Al implementarlo, la línea actual es la **1.x** (protocolo 1.0), que cambió el formato respecto a la 0.3: métodos `SendMessage`/`SendStreamingMessage`/`GetTask`/`CancelTask`, JSON de proto3 en camelCase, estados `TASK_STATE_*`, roles `ROLE_*`, respuestas envueltas (`{task}`, `{statusUpdate}`, `{artifactUpdate}`) y la Agent Card con `supportedInterfaces`. El SDK 1.2.1 depende de `protobuf`, `google-api-core` y `json-rpc`, y su servidor es una app Starlette con su propio modelo de autenticación. Ápeiron solo necesita cuatro métodos. Por eso:

- **Decisión:** implementación propia del subconjunto JSON-RPC.
  - `apeiron_infra/a2a/wire.py`: constantes, constructores y códigos de error compartidos por servidor y cliente. Un cambio del protocolo se toca solo aquí.
  - **Sin dependencias nuevas:** solo `httpx`, que ya estaba.
- **Interoperabilidad verificada:** los payloads reales de la API se validaron con los mensajes protobuf del SDK 1.2.1 (`json_format.ParseDict`, que rechaza campos desconocidos). Pasaron la Agent Card, la petición del cliente, `SendMessageResponse`, los 19 `StreamResponse` de un stream y `Task`. Conviene repetirlo al subir de versión del protocolo; ver "Estado actual y brechas".

### A2A servidor: Ápeiron como agente remoto (fase 2)

- **Rutas** (`routes/a2a.py`):
  - `GET /.well-known/agent-card.json`: pública.
  - `POST /a2a`: Bearer, el mismo que la API. La tarea corre con la identidad, el RLS y el rate limit del usuario.
  - Con `APEIRON_A2A_SERVER_ENABLED=false` (por defecto), ambas responden 404.
- **Agent Card** (`a2a/card.py`):
  - interfaz `JSONRPC` 1.0 en `APEIRON_A2A_PUBLIC_URL` (o la URL de la petición) + `/a2a`;
  - `capabilities.streaming=true`;
  - esquema `bearer` (`httpAuthSecurityScheme`);
  - skills `apeiron_single` y `apeiron_debate`.
- **Métodos:**
  - `SendMessage`: espera al final, o devuelve la tarea al instante con `configuration.returnImmediately`.
  - `SendStreamingMessage`: SSE cuyo primer evento es la `Task`.
  - `GetTask`: con `historyLength`.
  - `CancelTask`.
  - Metadata: `mode`, `maxRounds` y `simulate`, con las mismas cotas que `ChatRequest`.
- **Errores JSON-RPC:**
  - estándar: -32700, -32600, -32601 y -32602;
  - de A2A: `TaskNotFound` (-32001; una tarea ajena se trata como inexistente), `TaskNotCancelable` (-32002), `UnsupportedOperation` (-32004; continuar una tarea por `taskId` no está soportado) y `VersionNotSupported` (-32009; solo `A2A-Version` 1.x).
- **Traducción de eventos** (`a2a/tasks.py`):

  | `ChatEvent` | Evento A2A |
  |---|---|
  | `trace` | `statusUpdate(WORKING)` con el mensaje público |
  | `step` / `guard` | `statusUpdate(WORKING)` con una parte `data` |
  | `turn` | `artifactUpdate` del artefacto `turns` (con `append`) |
  | `answer` | artefacto `answer` (texto + `{mode, simulate, blocked, usage}`) y `COMPLETED`, o `REJECTED` si el guardrail bloqueó la entrada |
  | excepción | `FAILED` con `internal_error (trace …)` |
  | cancelación | `CANCELED` |

  El `Thought` nunca sale.
- **Ejecución:**
  - Cada tarea corre en su propia `asyncio.Task`, que sobrevive a la desconexión del cliente; el resultado queda en `GetTask`.
  - Arranca en un **contexto limpio** que solo lleva la identidad, `channel="a2a"`, `a2a_task_id` y `session_id=contextId`.
  - Se descubrió en pruebas que, sin ese aislamiento, la tarea heredaba la configuración de LangGraph de quien la llamaba en proceso.
- **TaskStore** en memoria por instancia, acotado a 500 tareas: se descartan las terminadas más antiguas.
- **Registro:**
  - `agent_runs.channel` (`web`|`a2a`) y `agent_runs.a2a_task_id`.
  - La cancelación se registra con `status='error'` y `error='CancelledError'`.
- **Nginx:** `location = /.well-known/agent-card.json` y `location = /a2a` (sin buffering, 300 s).

### A2A cliente: workers remotos (fase 3)

- **`A2ARemoteAgent`** (`apeiron_infra/a2a/client.py`) implementa `SpecialistAgent`.
  - El grafo lo trata como a cualquier worker: timeout del nodo, degradación y guardrail de `turn`.
  - Envía la pregunta junto con `dialogue_block`, así que el remoto también replica a su interlocutor.
  - Si la card anuncia streaming usa `SendStreamingMessage`; si no, `SendMessage`. Enviar no se reintenta, porque no es idempotente.
  - La respuesta sale del artefacto `answer`, o en su defecto de los artefactos o del mensaje de estado, y se acota a 6000 caracteres.
  - Los `statusUpdate` se reenvían como traza (`[sophos A2A: …]`).
- **Identidad:** cada agente usa su credencial propia (`token_env` → `APEIRON_A2A_TOKEN_<NOMBRE>`). **El JWT del usuario nunca se reenvía.**
- **Seguridad de red:**
  - Allowlist de hosts (`APEIRON_A2A_ALLOWED_HOSTS`) y `https` obligatorio, salvo `localhost`.
  - Se valida la URL configurada y también la interfaz que anuncia la card, para que no haya SSRF por redirección.
- **Bucles de delegación:**
  - Se encontró un bucle al renderizar la UI con un remoto que era la propia instancia.
  - Cada petición lleva `metadata.apeironHops`; el servidor lo guarda en `RequestContext.a2a_hops`.
  - Un worker remoto no delega si la ejecución ya viene de `APEIRON_A2A_MAX_HOPS` saltos (por defecto 1). El turno queda degradado, sin abrir el breaker.
  - Un agente ajeno que no propague la metadata solo queda acotado por el rate limit.
- **Resiliencia:** circuit breaker por agente (3 fallos, 60 s), visible en `/v1/system`.
- **Registro:**
  - `RemoteAgentFactory`, en el núcleo, recibe el agente ya construido por el composition root.
  - Los nombres siguen la regex del catálogo, no admiten el prefijo `apeiron_` y no pueden coincidir con un worker local.
  - `describe()` expone `kind: "local"|"remote"` y `endpoint` (solo el host) en `/v1/agents`.
- **Simulación (regla 11):**
  - `RemoteAgentFactory` sin adaptador crea un sustituto `ReActAgent` local con el mismo nombre. La simulación nunca sale a la red.
  - `FakeLLM` reconoce a cualquier worker por su persona ("Eres X").
- **Catálogo:**
  - Una migración amplía `agents.kind` con `remote`.
  - Cada despliegue añade la fila de sus remotos en su propia migración; sin ella, `agent_executions` omite al agente.

### MCP: literatura académica verificable (`scholarly_search`)

**Problema.** El guardrail de citas solo da por buenas las referencias que aparecen en una observación real. La única fuente externa era arXiv, que cubre física y matemáticas pero casi nada de filosofía. En la práctica, casi cualquier cita de Anaximandro o Heráclito acababa como `[cita no verificada]`: el guardrail borraba citas, pero los agentes no tenían de dónde sacar citas buenas.

**Decisión.** Un servidor MCP propio, `apeiron-scholar`, que consulta **OpenAlex**: gratuito, sin clave y con filosofía, humanidades y ciencia, todo con DOI. Ápeiron lo consume como una herramienta más, `scholarly_search`.

- **MCP y no A2A:** es una herramienta sin estado ni diálogo. A2A se reserva para delegar en otro agente.
- **Servidor** (`services/mcp-scholar`, paquete `apeiron_mcp_scholar`):
  - SDK MCP 2.x (`MCPServer`) por streamable HTTP, **sin estado** y con respuestas JSON.
  - Una herramienta, `search(query, limit=1..5)`, que devuelve título, año, autores, revista, citas recibidas, **DOI literal** (`doi:10.x/y · https://doi.org/10.x/y`) y un extracto del resumen.
  - Los errores de OpenAlex salen como texto controlado.
  - `APEIRON_OPENALEX_MAILTO` (opcional) usa el *polite pool* de OpenAlex.
  - Es independiente del monorepo: un contrato de import-linter le prohíbe importar `apeiron_*`, y se comunica solo por MCP.
- **Despliegue:**
  - Viaja **en la misma imagen que la API**, con el comando `python -m apeiron_mcp_scholar`. No hay imagen nueva en GHCR ni cambios en el pipeline de entrega.
  - Servicio `mcp-scholar` en Compose, **sin puerto publicado** y con healthcheck.
  - Protección contra *DNS rebinding*: solo acepta `Host` `mcp-scholar:*`, `localhost:*` o `127.0.0.1:*`; cualquier otro recibe 421.
- **Cliente** (`apeiron_infra/tools/scholarly.py`):
  - Usa el `McpSdkGateway` existente, que ya funciona con el SDK 2.x, más su propio circuit breaker (`scholarly_sources`), dos intentos y 15 s de timeout.
  - Si falla, la observación dice "Fuente académica no disponible…" y el agente continúa.
  - Se activa con `APEIRON_SCHOLAR_MCP_URL`. En Compose está cableada a `http://mcp-scholar:8080/mcp`.
  - Sin la variable, la herramienta no existe y el resto sigue igual.
- **Agentes:**
  - Anaximandro y Heráclito tienen `scholarly_search`, que también va segunda en `FALLBACK_TOOLS`, después de la memoria, para la política de evidencia.
  - Una migración alinea el catálogo `agents.tools`.
  - arXiv (`mcp_public_api_tool`) se mantiene sin cambios. Su variante MCP heredada (`APEIRON_MCP_SERVER_URL`, que lo *sustituye*) sigue disponible pero no se usa.
- **Seguridad:**
  - La **descripción** de la herramienta que ve el LLM es la nuestra, fija en el código; nunca la que anuncia el servidor. Así se evita el envenenamiento de herramientas (*tool poisoning*).
  - El contenido devuelto pasa por el guardrail de `observation` (inyección indirecta, PII, truncado).
  - El servidor solo se alcanza dentro de la red de Compose.
- **Observabilidad:** `/v1/system` incluye el componente "Literatura académica (MCP)" con el estado de su breaker, o "Desactivado" si no hay URL.
- **Versión del SDK:** el extra `[mcp]` pasa a `mcp>=2.3,<3`. Antes era `>=1.0` sin techo, así que la imagen ya instalaba la 2.x sin haberla validado.

### Observabilidad del sistema (frontend)

Para saber qué ocurre en el sistema sin abrir LangSmith ni los logs:

- **`GET /v1/system`** (Bearer) devuelve:
  - **Componentes:** LLM y su breaker, memoria (sonda con timeout de 2 s), historial de Supabase (degradado si hubo un guardado fallido en los últimos 5 min), fuentes externas y su breaker, guardrails, servidor A2A y cada agente remoto con su breaker.
  - **Actividad del proceso** (`RuntimeMetrics`, solo agregados y en memoria por instancia): ejecuciones en curso y totales por estado y canal, intervenciones por etapa y regla, llamadas LLM, tokens, latencia p50/p95 y fallos de guardado o memorización.
  - **A2A:** card, tareas por estado y las tareas **propias** recientes.
  - **Límites:** cupo restante del rate limit del usuario y las cotas.
  - Nunca devuelve preguntas ajenas ni secretos.
- **Contrato SSE** (cambio aditivo):
  - nuevo evento `guard` (`{stage, action, rules, agent, round}`);
  - `answer.blocked`;
  - el reducer web ignora tipos de evento desconocidos.
- **Web:**
  - **Contexto `observatory`** (ruta `/sistema`): salud global, componentes con símbolo y etiqueta (nunca solo color), indicadores de actividad, barras de intervenciones por regla, topología local o remota, A2A, la actividad propia (agregada desde el historial de Supabase) y los límites. Refresco cada 10 s.
  - **Consola:**
    - panel de guardrails de la ejecución y tarjeta de rechazo;
    - marca A2A en turnos remotos y nodo "remoto · A2A" en el grafo, que también se compacta con 3–4 workers;
    - en el historial, marcas de ejecución bloqueada y "vía A2A".

### Configuración nueva

- **Fase 1:** `APEIRON_GUARDRAILS_ENABLED` (por defecto `true`).
- **Fases 2 y 3:**
  - `APEIRON_A2A_SERVER_ENABLED` (por defecto `false`)
  - `APEIRON_A2A_PUBLIC_URL`
  - `APEIRON_A2A_REMOTE_AGENTS` (JSON, máx. 4)
  - `APEIRON_A2A_ALLOWED_HOSTS`
  - `APEIRON_A2A_MAX_HOPS` (1–3)
  - `APEIRON_A2A_TOKEN_<NOMBRE>` (secrets)
- **MCP académico:**
  - `APEIRON_SCHOLAR_MCP_URL` (Compose la cablea a `mcp-scholar`)
  - `APEIRON_OPENALEX_MAILTO` (opcional)
  - `APEIRON_SCHOLAR_ALLOWED_HOSTS` y `APEIRON_SCHOLAR_PORT` (del servidor; sus valores por defecto sirven en Compose)

Todas están en `.env.example` y en la tabla de configuración del README.

### Import-linter

A2A no añade dependencias. El núcleo sigue sin `httpx`: el cliente A2A vive en `apeiron_infra` y el servidor en `apeiron_api`. Se añade un 5.º contrato: `apeiron_mcp_scholar` no puede importar `apeiron_*`.

## Consecuencias

- **Interoperabilidad:** cualquier cliente A2A 1.0 puede descubrir a Ápeiron y delegarle preguntas con streaming. Ápeiron suma especialistas externos al debate sin cambiar el grafo.
- **Superficie de ataque:** crece, pero queda acotada por puntos de control explícitos:
  - guardrails en la entrada A2A y en los turnos remotos;
  - allowlist, credencial propia y límite de saltos;
  - todo visible en la traza, en los logs, en el registro y en `/v1/system`.
- **Coste:** con `RuleGuardrails` no hay llamadas LLM extra; una pregunta bloqueada consume 0 tokens. Un worker remoto no consume tokens propios, pero su latencia se suma al debate (secuencial, ADR-009).
- **Contratos:**
  - **SSE:** `guard` y `answer.blocked`, ambos aditivos.
  - **REST:** `/v1/system`, `/a2a` y `/.well-known/agent-card.json`; `/v1/agents` añade `kind` y `endpoint`.
  - **Esquema:** estado `blocked` y columnas `guardrails`, `channel` y `a2a_task_id` en `agent_runs`; `kind='remote'` en `agents`. Todo por migraciones nuevas.
  - **Puertos:** `GuardrailPort`; `RequestContext` añade `channel`, `a2a_task_id` y `a2a_hops`.
  - **Herramientas y MCP:** nueva herramienta `scholarly_search` en las fábricas y en el catálogo `agents.tools` (migración `20261005140000_scholarly_tool.sql`); nuevo servicio interno `mcp-scholar` en Compose.
- **Riesgos:**
  - Implementar el protocolo nosotros obliga a seguir su evolución (`wire.py` y la validación contra el SDK).
  - Un agente remoto lento o caído degrada su turno, pero no cae el debate.
  - Las reglas deterministas tienen falsos positivos y negativos, y no sustituyen la CSP pendiente (ADR-010).
  - El TaskStore, `RuntimeMetrics` y el rate limit viven en memoria **por instancia**: con varias réplicas, cada una ve solo lo suyo.
  - Las citas de un agente remoto no se pueden verificar con la evidencia local, así que el guardrail las marca como `[cita no verificada]`. Es una decisión conservadora.

## Estado actual y brechas

Las tres fases están implementadas, junto con el caso MCP académico. Se verificó con `make check` (ruff, mypy, 5 contratos), `pytest` (134 tests), `npm test` (29), el build de producción y la UI renderizada en Chrome headless contra la API en simulación.

1. **Guardrails:**
   - `packages/core/tests/test_guardrails.py`:
     - detección de inyección en español e inglés, sin falsos positivos en preguntas legítimas;
     - secretos y PII;
     - fuga del razonamiento;
     - verificación de citas con normalización de arXiv;
     - política de fallo;
     - bloqueo sin llamadas LLM;
     - inyección indirecta neutralizada antes del prompt;
     - citas de turno y de síntesis remediadas;
     - ejecución `blocked` sin memorizar;
     - secreto redactado que no se persiste;
     - eventos `guard`.
   - `test_api.py`: inyección por SSE.
2. **Servidor A2A** (`services/api/tests/test_a2a_api.py`):
   - Agent Card y servidor desactivado por defecto;
   - Bearer obligatorio;
   - `SendMessage` y streaming;
   - inyección → `REJECTED`;
   - errores JSON-RPC y de versión;
   - tareas privadas por dueño;
   - cancelación;
   - `/v1/system`.
3. **MCP académico** (`services/mcp-scholar/tests`, `test_infra.py`, `test_a2a_api.py`):
   - índice invertido, formato con DOI literal, límites de consulta y *polite pool*;
   - herramienta `search` por el **protocolo MCP real** en proceso (`initialize`, `tools/list`, `tools/call`) y error de OpenAlex como texto controlado;
   - DNS rebinding → 421;
   - herramienta `scholarly_search`: entrada acotada, degradación y breaker;
   - cableado en la topología y en `/v1/system`.
   - Verificado también contra OpenAlex real con el `McpSdkGateway`.
4. **Cliente A2A:**
   - `packages/infra/tests/test_a2a_client.py`: SSRF, `https`, credencial propia, streaming y `SendMessage`, card hacia otro host, tarea fallida que abre el breaker, error JSON-RPC y límite de saltos.
   - De punta a punta en proceso: un Ápeiron debate con otro por A2A; el autobucle se corta en un salto; la simulación no sale a la red.
   - `test_simulation.py`: sustituto simulado.

**Brechas:**
- La migración no se ha aplicado al proyecto remoto (`supabase db push` requiere confirmación).
- **TaskStore y métricas compartidos** (Postgres o Redis) antes de escalar en horizontal.
- **Del protocolo, sin implementar:** notificaciones push, `SubscribeToTask` (reengancharse a un stream), `ListTasks`, `input-required` (diálogo a mitad de tarea), continuar tareas por `taskId` y la firma de la Agent Card.
- **Validación contra el SDK:** se hizo a mano en un entorno aislado. Un test con `pytest.importorskip("a2a")` la automatizaría si se añade `a2a-sdk` como dependencia de desarrollo.
- **Guardrails:** se basan en patrones, así que una paráfrasis creativa puede eludirlos. No hay verificación semántica de afirmaciones en prosa.
