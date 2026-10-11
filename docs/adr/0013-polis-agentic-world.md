# ADR-013: La Polis de Ápeiron, un mundo agéntico habitable

**Estado:** FASES 1 A 4 IMPLEMENTADAS. Del bloque transversal de 2026-10-11 están implementados el **catálogo de agentes como módulos**, las **sesiones durables** y el **eval de diferenciación con LLM real**. La **fase 5** (dirección de arte, motor de assets, experiencia y pruebas de navegador) queda **aceptada y detallada**, pendiente de implementar por subfases. Amplía ADR-006 (Angular y streaming), ADR-009 (topología y checkpointer pendiente) y ADR-011 (A2A). **Modifica las reglas no negociables 7 (contrato SSE) y 8 (cota de participantes) de AGENTS.md** y la receta §8 «Nuevo agente worker».  
**Fecha:** 2026-10-10 (revisado el 2026-10-11)

## Contexto

Ápeiron ya hace observable su ejecución: el *Grafo en vivo* ilumina nodos, cada turno muestra su evidencia y los guardrails sus intervenciones. Es una consola técnica. El objetivo de producto es otro: **una polis que se explora**, no una pantalla con gráficos. El usuario entra en el mundo, recorre sus lugares, encuentra a los agentes donde viven, les pregunta, los convoca al ágora y **debate con ellos como un participante más**.

La referencia es [bruno-simon.com](https://bruno-simon.com/). Lo que la define, y que este ADR adopta como requisitos:

| Rasgo de la referencia | Traducción a la Polis |
|---|---|
| Navegación encarnada (conduces un coche; la cámara te sigue) | Te mueves como **ssanax**, tu avatar, en tercera persona |
| El contenido está en lugares que se descubren | Cada agente y cada herramienta tiene un **lugar** en la ciudad |
| Mapa (M), reaparición, secretos | Mapa de la polis, volver al ágora, lugares por descubrir |
| Teclado, mando y táctil | WASD/flechas, ratón para la cámara, joystick táctil |
| Three.js (WebGL/WebGPU), Rapier, *matcaps*, selector de calidad | Three.js, iluminación horneada/*matcaps*, calidad baja/alta; física solo si hace falta |

Además, el usuario quiere **gobernar la deliberación**: elegir quién debate (los cinco agentes a la vez si quiere), invitar a un agente a mitad de un debate, fijar su duración, su ritmo, dejarla abierta y disponer de un tiempo para escribir su propio turno. Nada de eso existía al empezar:

| Necesidad | Situación de partida |
|---|---|
| Preguntar a un agente concreto | `ChatRequest` no tenía `agent`: el router elegía por `AGENT_HINTS` |
| Elegir participantes | `ChatRequest` no tenía `participants`: se usaba `debate_participants` fijo |
| Cinco agentes, más el humano, a la vez | Cota dura de participantes 1–4 (`Settings`, `_validate`) |
| Pausar el grafo (turno humano, avance paso a paso) | No había checkpointer (pendiente en ADR-009); sin él no hay `interrupt()` |
| Duración, ritmo, debate abierto | El supervisor solo conocía `max_rounds` |
| Reconectar a un debate en curso | Una ejecución vivía en una petición POST: si se cortaba, se perdía |
| Distinguir cancelación, fallo y desconexión | Al cancelar, `RunState.status` volvía a `idle` pero los nodos seguían `active`; desconexión y fallo del servidor eran ambos `error` |

## Alternativas

1. **Cámara orbital sobre islas** (versión anterior de este ADR). Se ve en 3D, pero el usuario sigue fuera del sistema: es un grafo animado.
2. **Mundo 2D (PixiJS + GSAP).** Más barato, pero no hay espacio que recorrer ni presencia.
3. **React Three Fiber.** Buen ecosistema, pero mete React en una aplicación Angular.
4. **Polis en Three.js con avatar propio y sesiones deliberativas en el backend, por fases** (adoptada).

## Decisión

Se adopta la alternativa 4.

### Principios

1. **Estás dentro.** El usuario es ssanax, un ciudadano con avatar. Explorar, inspeccionar, preguntar y deliberar son acciones distintas, todas dentro del mundo.
2. **Solo hechos reales.** Ningún estado de agente sale de temporizadores que simulen trabajo. La vida ambiental (agentes que pasean, humo, agua) existe, pero no se confunde con la ejecución.
3. **El backend es la fuente de verdad.** El mundo representa y envía órdenes; nunca ejecuta agentes ni decide resultados. Si la escena no carga, la consola sigue funcionando.
4. **Topología declarada.** Los lugares de los agentes se generan desde `/v1/agents`: un agente nuevo aparece en la ciudad sin tocar el motor. Desde 2026-10-11 eso incluye su nombre visible y su residencia (ver [Catálogo de agentes](#catálogo-de-agentes-módulos-declarativos)).
5. **El razonamiento privado no sale** (regla 10). Se muestran turnos, herramientas, observaciones acotadas y estados.
6. **Capas** (regla 4). Three.js solo en `presentation`; el dominio de la Polis es TypeScript puro y tiene specs.
7. **El color significa algo** (fase 5). El mundo es sobrio; el color saturado se reserva para lo que pasa: quién habla, qué herramienta se consulta, la salud del Faro.

### La ciudad

| Lugar | Quién o qué | Qué pasa allí |
|---|---|---|
| **Ágora** (centro) | Ápeiron | Se convoca y se celebra el debate. La tribuna (*bema*) es de quien habla; Ápeiron sintetiza desde el centro |
| **El Gnomon** | Anaximandro | Primeros principios; el primer mapa del mundo |
| **El Fuego y el Río** | Heráclito | Cambio y contradicción |
| **La Cumbre** | Nietzsche (fase 3) | Genealogía y crítica de valores |
| **El Taller** | Feynman (fase 3) | Modelos causales y experimentos |
| **El Jardín** | Epicuro (fase 3) | Prudencia, coste y consecuencias |
| **Biblioteca** | `scholarly_search`, `mcp_public_api_tool` | Un agente que busca literatura envía allí un mensajero visible |
| **El Ábaco** | `formal_logic_calculator` | Comprobación lógica |
| **Mnemósine** | `vector_memory_retriever` | Memoria del usuario y conocimiento global |
| **Casa de ssanax** | El usuario | Punto de aparición |
| **Archivo** (fase 4) | Historial (`/v1/runs`) | Crónicas de debates pasados y su reproducción |
| **El Faro** (fase 4) | Observatorio (`/v1/system`) | Salud del sistema, visible desde toda la ciudad |

Las residencias de los agentes (título, subtítulo, silueta, color y epíteto) **no están en el frontend**: las declara el manifiesto de cada agente y llegan por `/v1/agents`. Un agente sin residencia válida recibe un templo genérico. Un agente remoto (A2A) recibe un **puerto** en el borde de la ciudad, marcado como forastero.

### Experiencia

- **Moverse:** WASD/flechas, ratón o dos dedos para la cámara, joystick táctil, `M` para el mapa, volver al ágora desde el menú.
- **Descubrir:** los lugares tienen silueta y luz propias, visibles desde lejos. Al acercarse aparece su nombre.
- **Interactuar por proximidad:** cerca de un agente, `E` abre su diálogo: quién es, qué herramientas usa, su último turno y dos acciones, **Preguntarle** e **Invitarlo al ágora**.
- **Preguntar a un agente:** lo hace en modo consulta en su propio lugar. Sus herramientas se ven como mensajeros hacia la Biblioteca, el Ábaco o Mnemósine.
- **Convocar un debate:** en el ágora, la tribuna abre la configuración: participantes, duración, ritmo y tiempo para tu turno. Los convocados **caminan hasta el ágora**; la ejecución empieza cuando llegan.
- **Deliberar:** quien habla sube a la tribuna. Un haz une al orador con aquel a quien responde, y solo cuando `turn.responds_to` lo respalda. En tu turno aparece una cuenta atrás sobre ssanax y un campo para escribir.
- **Semántica visual separada:**

  | Relación | Dato real | Representación |
  |---|---|---|
  | Flujo de control | `GraphRun.edges` (siempre pasa por `apeiron_supervisor`) | Pulso que sale del centro del ágora hacia el siguiente orador |
  | Comunicación entre agentes | `turn.responds_to` | Haz entre orador e interlocutor |
  | Uso de herramientas | `step.tool` | Mensajero hacia el edificio de la herramienta |
  | Guardrail | `guard` | Destello en el lugar afectado (sin texto) |

### Estados

Estado de cada agente: `idle`, `working`, `using_tool`, `done`, `degraded` y `error`. Caminar al ágora y ocupar la tribuna son animaciones del motor, no estados: salen de la convocatoria (`summoned`) y de `working`/`using_tool`.

La ejecución se corrige en origen, en `research/application/run-state.ts`, para que también lo aproveche la consola:

| Situación | `RunStatus` | Efecto en el mundo |
|---|---|---|
| Sin ejecución | `idle` | Agentes en sus lugares |
| En curso | `running` | Según los eventos |
| Esperando a ssanax o un avance | `running` + `RunState.session.waiting` (ver desviaciones) | Cuenta atrás o aviso de "continuar" |
| Terminada | `done` | Síntesis en el ágora; los agentes vuelven a casa |
| Cancelada por el usuario | `cancelled` (nuevo) | Se cierra todo nodo `active`; los agentes vuelven sin marcar error |
| Fallo del servidor (evento `error`) | `error` con `failure: 'server'` | Alerta en el ágora |
| Conexión perdida | `error` con `failure: 'network'` | Aviso de reconexión; la sesión se reengancha con `after=N` |

El estado de cada isla es una proyección pura del `RunState`. Las animaciones salen de las listas que solo crecen (`graph.edges`, `turns`, `steps`, `guards`): la escena compara longitudes y anima cada elemento nuevo, aunque Angular agrupe varios eventos en el mismo ciclo. **Esto no es un replay**: solo se anima lo que el cliente observó en vivo.

### Arquitectura del frontend (fases 1 a 4)

```text
apps/web/src/app/polis/
  domain/                         # puro, con specs (node:test)
    city-layout.ts                #   lugares desde la topología: residencias del manifiesto, herramientas, forasteros
    citizen-state.ts              #   RunState → estado visual por agente
    signals.ts                    #   listas que crecen → pulsos, haces, mensajeros, destellos
    deliberation.ts               #   borrador de la tribuna, validaciones, petición, estimación de llamadas
    replay.ts                     #   cronología guardada → plan de reproducción
  application/
    polis.store.ts                #   proyección del ResearchStore + órdenes de sesión, replay, Faro
    ports/deliberation.port.ts
  infrastructure/
    http-deliberation.adapter.ts  #   /v1/sessions, SSE sobre fetch con reenganche after=N
    polis.providers.ts
  presentation/
    polis.page.ts|html|scss       #   ruta lazy /polis: HUD, tribuna, diálogos, mapa
    engine/                       #   Three.js fuera del ciclo de Angular
      world.ts places.ts figures.ts effects.ts input.ts
research/application/agent-directory.ts   # nombres visibles aprendidos de la topología (root)
```

- **Render:** `WebGLRenderer`, geometría procedural low-poly, luz hemisférica y direccional, sin sombras en tiempo real.
- **Física:** suelo pisable 2D (`isWalkable`: islas, puentes y monumentos), sin motor físico.
- **Coste de carga:** `three` va en el chunk lazy de `/polis` (≈112 kB comprimidos), con pantalla de carga. El bundle inicial no cambia.
- **Rendimiento:** sin render con la pestaña oculta; calidad baja/alta (relación de píxeles); `dispose` de todo al salir.
- **Fallback:** sin WebGL, o con `prefers-reduced-motion`, la ruta ofrece la consola y el grafo SVG.

La arquitectura objetivo de la fase 5 está en [Fase 5](#fase-5-dirección-de-arte-motor-y-experiencia).

### Sesiones deliberativas (backend, fase 2)

Un debate deja de ser una petición POST con stream y pasa a ser un **recurso con vida propia**, igual que las tareas A2A de ADR-011.

**Endpoints** (todos con Bearer y rate limit; la sesión solo es visible para su dueño):

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/v1/sessions` | Crea y arranca. Body en la tabla de abajo |
| `GET` | `/v1/sessions` | Sesiones abiertas del usuario, incluidas las que sobrevivieron a un reinicio (`dormant: true`) |
| `GET` | `/v1/sessions/{id}` | Instantánea. Si la sesión solo está en el diario, la rehidrata y la reanuda |
| `GET` | `/v1/sessions/{id}/events?after=N` | SSE reanudable: los eventos se numeran y se puede reenganchar |
| `POST` | `/v1/sessions/{id}/turn` | Turno de ssanax `{text}`. Pasa el guardrail `input`; si se bloquea, se pide reformular sin cerrar la sesión |
| `POST` | `/v1/sessions/{id}/advance` | Siguiente turno, en ritmo `step` |
| `POST` | `/v1/sessions/{id}/invite` | Invita a un agente para la siguiente ronda (`{agent}`), dentro de la cota |
| `POST` | `/v1/sessions/{id}/close` | Pide la síntesis y cierra |
| `DELETE` | `/v1/sessions/{id}` | Cancela |

**Configuración de la sesión:**

| Campo | Valores | Por defecto |
|---|---|---|
| `question` | ≤ 4000 caracteres | — |
| `mode` | `single` \| `debate` | Heurística actual |
| `agent` | Agente registrado (solo `single`) | Lo decide el router |
| `participants` | 1–6 nombres registrados, más `human` | `debate_participants` |
| `max_rounds` | 1–4 | `default_rounds` |
| `time_budget_s` | 60–1800 | Sin límite de tiempo (manda `max_rounds`) |
| `pace` | `auto` \| `step` | `auto` |
| `turn_delay_s` | 0–30 (pausa de lectura en `auto`) | 0 |
| `open_ended` | `true` \| `false` | `false` |
| `human_turn_timeout_s` | 30–600 | 240 (4 minutos) |
| `simulate` | `true` \| `false` | `false` |

- **Cuándo se cierra:** cuando se cumple el primero de estos límites: `max_rounds`, que se ignora si `open_ended`; `time_budget_s`, que termina el turno en curso y sintetiza; un `close` del usuario; o un **tope duro de seguridad** que se aplica siempre.
- **Tope duro de seguridad:** `APEIRON_SESSION_MAX_LLM_CALLS` (60) y `APEIRON_SESSION_MAX_DURATION_S` (1800). Si se alcanza, se sintetiza y se cierra.
- **Turno de ssanax:** el nodo humano hace `interrupt()` y la sesión emite `session {status: "waiting", waiting: "human_turn", deadline}`. Si vence el plazo, el turno queda vacío (`[human Timeout]`) y el debate continúa sin el usuario.
- **Ritmo `step`:** antes de cada turno, `interrupt()` hasta recibir `advance`. Con `step` y `open_ended`, el debate solo avanza cuando el usuario lo decide: es lo más predecible posible.
- **Ejecución:** cada sesión corre en una `asyncio.Task` con contexto limpio (patrón de `A2ATaskStore`) y sobrevive a la desconexión del cliente.
- **Checkpointer y durabilidad:** ver [Sesiones durables](#sesiones-durables-fase-5-adelantada). Postgres queda descartado como checkpointer porque exigiría una conexión directa a Supabase con credenciales de servidor, en contra de la regla 6.
- **ssanax es el usuario autenticado:** el participante `human` se ata al `user_id` del token (regla 5); `ssanax` es su nombre visible (metadato del perfil de Supabase o, si falta, el usuario local). Otro usuario entra en la Polis como sí mismo. Nadie puede hablar en nombre de otro.
- **Contrato SSE (cambia la regla 7):** los eventos actuales no cambian, y se añade `session {id, status: running|waiting|closing|completed|cancelled|error, waiting, deadline, next?, round?, responds_to?, participants, reason, last_event}`, más `id: N` en cada frame de `/v1/sessions/{id}/events`. El turno humano llega como `turn` con `agent: "human"`. `/v1/chat/stream` se mantiene sin cambios para la consola y A2A.
- **Cota (cambia la regla 8):** participantes de 1 a **6** (los cinco workers más el humano). Se actualizan `Settings`, `_validate`, `schemas` y AGENTS.md en el mismo cambio.
- **Persistencia del resultado:** la ejecución se guarda al cerrar, con los turnos humanos, la configuración y la cronología. Migraciones: `kind = 'human'` en `public.agents`, `config` y `events jsonb` en `agent_runs`, tokens por agente en `agent_executions`.
- **Coste:** con un LLM real, un debate de 1 ronda con 5 agentes y `REQUIRE_EVIDENCE=true` cuesta ≈17.000 tokens (medido en el eval: 102.113 tokens en 6 debates). La tribuna muestra una estimación de llamadas; la simulación cuesta 0 tokens y es la opción por defecto en el ágora.

### Catálogo de agentes (módulos declarativos)

Hasta la fase 4, añadir un agente exigía tocar siete sitios y su nombre estaba escrito a mano en `AGENT_HINTS` (dominio), en `STANCES`/`_speaker`/`_label` (`FakeLLM`), en una fábrica por agente, en `debate_participants` (`Settings`), en `agentLabel` y `DEFAULT_AGENTS` (web), en `RESIDENCES` (Polis) y en el catálogo SQL. **Cada agente pasa a ser un módulo con su carpeta**, y ningún código conoce a un agente por su nombre.

```text
packages/agents/                          # paquete apeiron-agents (solo datos + cargador; depende de apeiron-core)
  src/apeiron_agents/
    catalog.py                            #   load_catalog/load_spec: valida cada carpeta; catalog_digest
    __main__.py                           #   CLI: `list` y `migration` (genera la migración del catálogo SQL)
    <nombre>/agent.toml                   #   manifiesto
    <nombre>/persona.md                   #   prompt de sistema (persona)
  tests/test_catalog.py
packages/core/.../domain/entities/agent_spec.py   # AgentSpec, AgentCardInfo, Residence + invariantes
```

**Manifiesto** (`agent.toml`). Un agente mal declarado no arranca: la API falla al cargar el catálogo.

| Sección | Campos | Quién lo usa |
|---|---|---|
| (raíz) | `name` (= carpeta, `^[a-z][a-z0-9_]{1,40}$`, no reservado), `display_name`, `role`, `version`, `order`, `debate` | Registro, topología, catálogo SQL, debate por defecto |
| `[access]` | `tools` (lista de acceso: el agente solo ve esas), `a2a` (se publica como agente A2A propio), `max_steps` (≤ el global) | `SpecAgentFactory`, rutas A2A; el composition root rechaza tools desconocidas |
| `[routing]` | `hints` (además de su nombre, que siempre lo elige) | `decide_agent` (dominio) a través del grafo |
| `[card]` | `description`, `tags`, `examples` | Agent Card propia y skill en la card de Ápeiron |
| `[residence]` | `title`, `subtitle`, `landmark` (silueta que sabe dibujar el motor), `color` (`#rrggbb`), `epithet` | La Polis, vía `/v1/agents` |
| `[simulation]` | `query`, `thesis`, `objection` | `FakeLLM` (0 tokens) |
| `persona.md` | Texto; debe nombrar al agente («Eres Feynman») | `ReActAgent` y la detección de hablante del `FakeLLM` |

**Lo que cambia en cada capa:**

- **Núcleo:** `decide_agent(question, hints, default)` recibe las pistas; `build_graph(..., hints=)`. `SpecAgentFactory` sustituye a las cinco fábricas. `AgentRegistry` rechaza duplicados y expone `describe()` (con `display_name`, `version`, `debate`, `a2a`, `residence`), `hints()` y `debate_defaults()`.
- **Infra:** `FakeLLM(stances=, labels=)`: no conoce a ningún agente; la síntesis simulada es genérica.
- **API:** el composition root carga el catálogo (`agent_catalog()`), valida las tools contra las que sabe construir y deduce `debate_participants` de `debate = true` si `APEIRON_DEBATE_PARTICIPANTS` está vacío (ahora admite lista vacía).
- **A2A (amplía ADR-011):** cada agente con `a2a = true` publica card y endpoint propios:

  | Método | Ruta | Qué hace |
  |---|---|---|
  | `GET` | `/a2a/agents/{name}/.well-known/agent-card.json` | Card del agente (pública; 404 si no está publicado o el servidor A2A está apagado) |
  | `POST` | `/a2a/agents/{name}` | JSON-RPC A2A con el mismo Bearer y rate limit; la tarea es una consulta `single` a ese agente (se ignoran `mode` y `maxRounds`) |

  La card de Ápeiron añade un skill `agent_<name>` por agente publicado. Otro Ápeiron puede reclutar a un agente concreto como worker remoto apuntando `APEIRON_A2A_REMOTE_AGENTS` a `/a2a/agents/<name>`.
- **Web:** `AgentDirectory` (root) aprende los nombres visibles de la topología; `agentLabel(name, names)` es puro. `layoutCity` toma la residencia del manifiesto y valida silueta y color. Desaparecen `DEFAULT_AGENTS` y `RESIDENCES`; el borrador de la tribuna arranca con los debatientes que publica la topología.
- **Supabase:** el catálogo SQL **se genera**: `python -m apeiron_agents migration --write supabase/migrations` escribe un upsert de todos los workers, desactiva (`active = false`) los que ya no tienen carpeta y lleva una huella `-- apeiron-agents-catalog: <sha>`. `test_catalog.py` falla si la última migración generada no coincide con los manifiestos. La versión generada siempre es posterior a la última migración existente.
- **import-linter:** `apeiron_agents` es hermano de `apeiron_infra` (`api -> infra | agents -> core`) y un contrato nuevo le prohíbe importar adaptadores, la API o LangGraph.

**Nueva receta «Nuevo agente worker»:** crear `packages/agents/src/apeiron_agents/<nombre>/` con `agent.toml` y `persona.md` → `python -m apeiron_agents list` → generar la migración → tests. No se toca código.

### Sesiones durables (fase 5, adelantada)

Una sesión abierta **sobrevive a un reinicio de la API**.

- **Diario** (`SessionJournalPort`, núcleo): dueño, configuración completa, estado público, plazos en tiempo de pared, uso de tokens (total y por agente) y la cronología numerada `(seq, t, type, data)`. **Nunca guarda el token del usuario.**
- **Adaptador** `SqliteSessionJournal` (infra, SQLite de la biblioteca estándar en un hilo, WAL; tablas `deliberation_sessions` y `deliberation_events`, borrado en cascada). Un único escritor por instancia (cola en el servicio) conserva el orden y agrupa los eventos seguidos de una sesión; si el diario falla, la sesión en memoria sigue (warning `session_journal_failed`).
- **Checkpointer:** `AsyncSqliteSaver` (extra `sessions` de `apeiron-infra`: `langgraph-checkpoint-sqlite`, `aiosqlite`) en `<db>-checkpoints.db`. Sin `APEIRON_SESSIONS_DB_PATH`, todo sigue en memoria (`InMemorySaver`), como en desarrollo y tests.
- **Parada:** `Container.aclose()` → `DeliberationService.shutdown()`: las sesiones abiertas **no se cancelan ni se registran**; quedan dormidas en el diario y el checkpoint se conserva. Una cancelación del usuario se distingue de la parada (`cancel_requested`).
- **Rehidratación perezosa:** cuando el dueño vuelve (cualquier `GET`/orden sobre la sesión, con un token fresco), el servicio reconstruye la sesión desde el diario (eventos, registro de ejecución vía `ExecutionCollector.replay`, uso de tokens) y la reanuda: si el grafo tenía una interrupción pendiente, vuelve a esperarla; si estaba a mitad, continúa con `astream(None)`; si ya había terminado, solo cierra. La numeración de eventos continúa, así que `after=N` sirve a través del reinicio.
- **Cuota:** `start` cuenta las sesiones abiertas en memoria y en el diario; una sesión dormida más allá de su tope duro y del TTL deja de contar y la poda la borra (diario y checkpoint).
- **Compose:** `APEIRON_SESSIONS_DB_PATH=data/sessions.db` en `.env.example`, en el volumen `api-data` (junto a `users.db`).

### Diferenciación de los ciudadanos medida con LLM real

`python -m apeiron_api.evals.differentiation --yes --label <x>` (consume tokens; exige `--yes`) usa la misma composición que la API:

1. Debates de 1 ronda con los cinco agentes sobre 6 preguntas variadas (técnicas, cívicas, filosóficas).
2. **Atribución ciega:** un juez LLM recibe cada intervención con **todos** los nombres del catálogo enmascarados y las descripciones públicas de las cards en orden aleatorio (semilla fija), y elige quién la escribió. El azar acierta 1/5. Los turnos degradados no cuentan como intervención.
3. **Solapamiento léxico** entre agentes sobre la misma pregunta (coseno de bolsas de palabras sin palabras vacías; menos es mejor).
4. `--rescore <json>` recalcula un informe guardado sin llamar al LLM. Los informes viven en `docs/evals/`.

**Diagnóstico de la línea base:** todos convergían en la misma respuesta de «consultor pragmático» (listas de condiciones, coste-beneficio, «empezar pequeño»). Dos causas: las personas describían un tema y no un **método**, una **forma** ni **lo que no deben hacer**; y la instrucción común de diálogo (`dialogue_block`: «reconoce un acuerdo, formula tu objeción principal y aporta tu tesis») imponía la misma plantilla a todos.

**Cambios (personas v2):** cada persona declara su función, su método en pasos, su forma de respuesta, sus vetos y su extensión. La instrucción de diálogo pasa a: «Respóndele directamente desde tu función y con tu propia forma: no adoptes su estructura ni repitas su conclusión; muestra lo que su posición no ve desde tu método.»

| `openai:gpt-5.6-luna` (low), `REQUIRE_EVIDENCE=true`, `MAX_REACT_STEPS=2` | Línea base (v1) | Personas v2 |
|---|---|---|
| Atribución ciega (azar 20%) | 53% (30 válidas) | **85%** (27 válidas) |
| Anaximandro / Heráclito / Nietzsche / Feynman / Epicuro | 17 / 67 / 17 / 83 / 83% | 50 / 83 / 100 / 100 / 100% |
| Solapamiento léxico medio | 0,294 | **0,128** |
| Palabras por turno (media) | 141 | 111 |
| Turnos degradados | 0 / 30 | **3 / 30** (Feynman 2, Nietzsche 1) |
| Coste del eval | 124.388 tokens | 114.471 tokens |

### Fase 5: dirección de arte, motor y experiencia

La fase 5 sale de una revisión del encargo de rediseño del 2026-10-11 (ver [Revisión del encargo](#revisión-del-encargo-de-rediseño-2026-10-11)) y de las capturas de la Polis en escritorio y móvil. Se ejecuta en subfases independientes, cada una con criterios medibles.

#### 5.1 Dirección de arte: «la Polis en penumbra»

Referencia: la atmósfera de *Little Nightmares* (diorama, claroscuro, escala monumental, niebla baja, luz cálida contra un fondo frío), **subordinada a la legibilidad**: la Polis existe para observar a los agentes. De ahí el principio 7: el mundo es sobrio y el color saturado solo aparece donde hay significado.

**Paleta** (tokens del motor; la fuente de verdad es `PALETTE` en `polis/domain/atmosphere.ts`, ajustada en 5c a ocres sucios, verdes de agua estancada y gris óxido con base `#1a211e`):

| Token | Valor | Uso |
|---|---|---|
| `abyss` | `#0f1311` | Fondo, capa 0, fondo del HUD |
| `fog` | `#1a211e` | Niebla (`FogExp2`) y horizonte |
| `murk` | `#1d2a24` | Agua estancada |
| `cold` / `moonlight` | `#55685f` / `#a9bdc4` | Luz hemisférica fría; luna |
| `moss` / `ochre` | `#3a4433` / `#6e5d42` | Islas; suelo del ágora |
| `stone` / `stoneWet` / `stoneLight` | `#5b5850` / `#3a3935` / `#837c6e` | Columnas, edificios, roca |
| `rust` / `rustGrey` / `bronze` / `wood` | `#6a4530` / `#5a514b` / `#8a6a3a` / `#4b3826` | Metales, herrajes, puentes |
| `cloth` | `#c9c2b2` | Túnica de ssanax: la figura más clara de la escena |
| `lamp` | `#ffb35c` | Linternas y farol de ssanax: la única luz cálida |
| `logos` | `#f2c14e` | Núcleo de Ápeiron, pulsos de control |
| Color del agente | Del manifiesto (`residence.color`) | **Solo** su luz, su halo y sus haces cuando actúa; en reposo, desaturado al 25% |
| `ok` / `warn` / `danger` | `#9ee493` / `#f4c95d` / `#ef6461` | Estados (Faro, errores, guardrails) |

**Materiales:** piedra erosionada y bronce oxidado en `MeshLambertMaterial` (o `MeshBasicMaterial` en los assets horneados, ver [la guía de landmarks](../polis/landmarks.md)), sin `MeshStandardMaterial` salvo en los metales del ágora; el agua es oscura y casi inmóvil (`MeshPhongMaterial`: solo el brillo de la luna la delata); los personajes son siluetas de tela clara (ssanax) o del color apagado de su agente.

**Luz** (revisada en 5c): hemisférica fría (1,5) + una direccional rasante de «luna» (3,0; elevación 24°) **con sombras en tiempo real según el nivel** (PCF suave, 1024 px en media y 2048 px en alta; la caja de sombras sigue a ssanax y se ajusta al téxel para no temblar). La luz cálida viene de las linternas de los puentes (emisivo HDR + *bloom*, sin luz propia) y de **como mucho 4 luces dinámicas**: el farol que lleva ssanax (siempre encendido, se aviva en su turno) y la de cada agente que razona o consulta, con su color pleno. Bajo cada figura hay una sombra de contacto (disco), en todos los niveles.

**Escala y cámara:** columnas y estatuas del ágora a 3–4 veces la altura de ssanax; cámara de diorama con FOV 42°, más baja y más cerca (*pitch* 0,32, distancia 12). Lo que se interpone entre la cámara y ssanax (columnas, muros) se vuelve translúcido en lugar de mover la cámara.

#### 5.2 Capas del mundo y del HUD

| Capa | Contenido | Técnica | Reglas |
|---|---|---|---|
| **0. Abismo y niebla** | Cielo degradado, planos de niebla baja, siluetas lejanas | Esfera/plano sin escritura de profundidad, `renderOrder` bajo, `FogExp2` | Nunca recibe interacción; cuesta ≤ 3 draw calls |
| **1. Geometría estática** | Islas, puentes, landmarks | Procedural (hoy) o glTF horneado; fusionada por material e instanciada | Sin cálculo por fotograma salvo LOD |
| **2. Dinámicos** | ssanax, ciudadanos, mensajeros, haces, agua | Animación propia; colisiones con el suelo pisable (o Rapier, 5f) | Solo lo que cambia por fotograma |
| **3. UI espacial** | Rótulos de lugares, nombres, estados, bocadillos de diálogo, sensores visibles | `CSS2DRenderer`, con opacidad por distancia y prioridad | Nunca tapan el HUD (`isolation`); se atenúan con la distancia |
| **4. HUD Angular** | Barra superior, minimapa, dock de ciudadanos, crónica, barra de turno, tribuna, diálogos | Componentes standalone en 2D, estilo mínimo y brutalista (tinta clara sobre `abyss`, reglas de 1 px, rótulos en mayúsculas monoespaciadas) | Contraste AA (4,5:1), foco visible, `aria-live` en la crónica |

#### 5.3 Post-proceso por niveles de calidad

Se usa `postprocessing` (pmndrs): un `EffectComposer` con **un solo `EffectPass`** que fusiona los efectos en un shader, más barato que encadenar los pases de `three/examples`. Versión fijada al implementar 5c y cargada en el chunk de `/polis`.

| Efecto | Baja | Media | Alta | Parámetros de partida |
|---|---|---|---|---|
| Tone mapping | ✔ (en el renderer) | ✔ | ✔ | AgX, exposición 1,0 (0,9 dejaba la penumbra ilegible) |
| Sombras de la luna | — (solo de contacto) | PCF suave 1024 px | PCF suave 2048 px | `bias` −0,0004, `normalBias` 0,05, caja de ±34 m que sigue a ssanax |
| Niebla | `FogExp2` | `FogExp2` + planos bajos | igual | densidad 0,012, color `fog` |
| Color grading | — | ✔ | ✔ | Efecto propio (`GradeEffect`): contraste fílmico 1,18 alrededor del gris medio, saturación 0,78, *split toning* 0,35 (sombras hacia `#1c2730`, luces hacia `#ffcf94`); una LUT `.cube` puede sustituirlo |
| Viñeta | — | ✔ | ✔ | `offset` 0,3, `darkness` 0,65 |
| Bloom | — | ✔ | ✔ | `intensity` 0,35, `luminanceThreshold` 0,85, `mipmapBlur`, solo emisivos (linternas, núcleo, halos) |
| Oclusión ambiental | — | — | ✔ | N8AO (o GTAO) a media resolución, `aoRadius` 2, `intensity` 1,5; desactivada si el asset ya trae AO horneada |
| Profundidad de campo | — | — | solo explorando | `DepthOfFieldEffect` con foco en ssanax, `focusRange` amplio, `bokehScale` 2; **se apaga durante una deliberación, un diálogo o tu turno** |
| Grano | — | — | ✔ | `NoiseEffect` 0,04 |
| Relación de píxeles | 1 | ≤ 1,5 | ≤ 2 | — |

**Selección del nivel:** en táctil (`pointer: coarse`) se empieza en baja; en escritorio, en media. Si la media de fotograma supera 22 ms durante 3 s, se baja un nivel (nunca sube solo). El usuario puede fijarlo en ajustes, y CI fuerza baja. Con `prefers-reduced-motion`: sin DoF, sin grano y cámara sin inercia.

#### 5.4 Arquitectura del motor (objetivo de la fase 5)

```text
polis/presentation/
  polis.page.*                    # composición: escenario + HUD; conecta motor y store
  hud/                            # componentes standalone, cada uno con su SCSS (presupuesto de 10 kB por componente)
    top-bar  minimap  roster  chronicle  turn-bar  tribune  place-panel  onboarding  joystick  resume-banner
  engine/
    polis-engine.ts               # renderer, bucle rAF, calidad, visibilidad, resize, dispose
    post/post-pipeline.ts         # composer por nivel (5.3)
    world/
      city.ts                     #   layout → escena (lugares, puentes, rótulos)
      landmarks/procedural.ts     #   siluetas actuales (fallback si no hay glTF)
      gltf/loader.ts              #   GLTFLoader + DRACO/meshopt + KTX2, caché por landmark
      gltf/scene-nodes.ts         #   glTF → nodos del landmark; el parser de convenciones es domain/landmark-conventions.ts
      batching.ts lod.ts          #   fusión de estáticos e instanciado; THREE.LOD
    physics/
      walkable.ts                 #   interfaz PolisPhysics
      walkable-2d.ts              #   implementación actual (isWalkable)
      rapier.ts                   #   implementación Rapier, import dinámico (5f, condicional)
    actors/  avatar.ts citizens.ts figures.ts
    fx/      effects.ts bubbles.ts
    input/   input.ts joystick-bridge.ts
```

- **Fuera de Angular:** la app es *zoneless* (Angular 22 + signals), así que `NgZone.runOutsideAngular` no aplica. Lo que importa es que el bucle **no escriba signals por fotograma**: el motor emite hacia Angular solo eventos discretos (proximidad, selección) y, para el minimapa, posiciones limitadas a ~10 Hz.
- **Sin servicios globales nuevos:** el motor son clases TypeScript que crea la página en `ngOnInit` y destruye en `onDestroy`. Si se envuelven en `@Injectable()`, se proveen en la propia ruta, nunca en `root`. El estado de la ejecución sigue en `ResearchStore`/`PolisStore`: no se crea un `SimulationStateService` paralelo.
- **Física como puerto:** `PolisPhysics { move(from, delta): Vector3; sensors(position): string[] }`. La implementación 2D actual cumple el contrato. Rapier entra solo si 5f lo justifica.

#### 5.5 Assets: glTF desde Blender sin romper la ciudad declarada

La ciudad se genera desde la topología, así que **no existe una escena única exportada de Blender** con posiciones fijas: rompería el catálogo de agentes. En su lugar:

- **Un glTF por tipo de landmark** (`agora.glb`, `gnomon.glb`, `garden.glb`…), modelado en espacio local con el origen en el centro de su isla y horneado en local. `layoutCity` sigue decidiendo dónde va cada uno.
- **Opcional:** un agente puede traer su propio `residence.glb` en su carpeta. Su publicación (servirlo por la API o copiarlo al build web) es una decisión abierta de 5e.
- **Convenciones de nombres** (las lee `domain/landmark-conventions.ts`, que acepta también el prefijo `node_` del encargo: `node_fixed_muro_box` ≡ `fixed_muro_box`; nada se posiciona a mano). Guía completa, con el horneado de luz y sombra: [docs/polis/landmarks.md](../polis/landmarks.md):

  | Prefijo / sufijo | Significado | Resultado en el motor |
  |---|---|---|
  | `fixed_*` | Geometría estática colisionable | Malla fusionada en el lote estático + colisionador fijo (Rapier) o bloqueo en `walkable-2d` |
  | `fixed_*_box` / `_cyl` | Colisionador simplificado | Cuboide/cilindro en lugar de trimesh |
  | `walk_*` | Suelo pisable | Navmesh/plano pisable (sustituye al círculo de la isla) |
  | `sensor_*` | Zona de interacción, invisible | Sustituye al radio de `nearestPlace`; `sensor_interact`, `sensor_tribune` |
  | `spawn_*` | Empty de posición | `spawn_host` (donde espera el agente), `spawn_visitor` (llegada de ssanax), `spawn_seat_N` (asientos del ágora) |
  | `light_*` | Empty de luz | `light_lamp` (emisivo + bloom), `light_core` (núcleo de Ápeiron) |
  | `fx_*` | Ancla de efecto | `fx_smoke`, `fx_water`, `fx_fire` |
  | `*_lod0` / `*_lod1` / `*_lod2` | Niveles de detalle | `THREE.LOD` con distancias 0 / 35 / 70 m |
  | `extras` en la raíz | `apeiron.landmark`, `apeiron.version`, `apeiron.radius` | Validación y radio de la isla |

- **Validador en CI** (`node scripts/validate-landmarks.mjs`): convenciones, triángulos por LOD, tamaño de texturas, presencia de `uv2` (lightmap) y peso del fichero.
- **Origen de los assets:** modelado propio o bases CC0 (p. ej. Kenney, Quaternius) adaptadas al estilo; nada con licencia dudosa. El repositorio aporta el pipeline y los scripts; el modelado es trabajo de arte.

**Pipeline en Blender (paso a paso):**

1. **Escala y ejes:** metros, origen en el centro de la isla, +Y arriba al exportar. ssanax mide 2,5 m.
2. **Modelado modular:** piezas de kit (columna, escalón, muro) y una isla por landmark; formas grandes legibles a 40 m.
3. **Nombres:** aplicar las convenciones de la tabla; los empties `spawn_*`, `light_*` y `fx_*` se colocan a mano en Blender, no en código.
4. **UV:** `UVMap` para la textura de material; `UVLightmap` (uv2) con *Lightmap Pack* y margen de 0,02.
5. **Iluminación de bake:** sol frío rasante + linternas cálidas (emisión), Cycles con denoise; mismo ángulo de «luna» que la direccional del motor.
6. **Bake:** `Combined` (sin especular) y `AO` a una imagen de 1024 px (2048 px para el ágora), combinadas en el lightmap.
7. **Limpieza:** aplicar modificadores, unir mallas por material, borrar caras ocultas, normales coherentes.
8. **LOD:** duplicar con *Decimate* al 50% (`_lod1`) y al 20% (`_lod2`).
9. **Exportar:** glTF 2.0 binario, solo la selección, modificadores aplicados, sin cámaras ni luces (se usan empties).
10. **Optimizar:** `gltf-transform optimize --compress meshopt --texture-compress ktx2` y redimensionado de texturas.
11. **Validar:** `scripts/validate-landmarks.mjs`; los ficheros van a `apps/web/public/assets/polis/landmarks/`.
12. **Revisar:** abrir la Polis con `?perf` (overlay con `renderer.info`) y comprobar los presupuestos de 5.7.

#### 5.6 Experiencia y HUD

Problemas observados en las capturas de escritorio (1440×900) y móvil (390×844), con su solución:

| Problema | Solución |
|---|---|
| Se llega sin orientación (detrás de columnas, sin «estás aquí»), rótulos que se pisan, «Casa de ssanax» con otro usuario | Introducción de cámara (de vista aérea a ssanax), **onboarding** de primera visita con controles según el dispositivo, **minimapa** permanente con «estás aquí» y rumbo, rótulos lejanos que se desvanecen, casa con el nombre del jugador |
| El debate no se ve en el mundo: solo 3 extractos truncados | **Bocadillos** sobre quien habla, **crónica** completa en un panel plegable (turnos íntegros, a quién responde, herramientas, síntesis), anuncios en `aria-live` |
| No se ve quién está en la ciudad ni qué hace | **Dock de ciudadanos**: avatar, color y estado de cada agente; un clic lleva a su lugar |
| La tribuna parece un formulario de ajustes (casillas y selects sin estilo) | Pregunta grande con sugerencias, participantes como tarjetas, **presets** (debate rápido, seminario paso a paso, asamblea abierta) y opciones avanzadas plegadas |
| Tu turno es un campo de texto con un reloj | Barra de turno con **anillo de cuenta atrás** (cambia de color a falta de 30 s), contador, atajos (`Ctrl+Enter` hablar) y progreso de la sesión (ronda, orador siguiente, tiempo restante) |
| Móvil: joystick invisible (mitad izquierda de la pantalla), sin mapa, cabecera partida, el botón global de tema tapa el HUD | **Joystick visible** (solo con puntero grueso), botones de mapa e interacción, diálogos como *bottom sheet*, botón de tema oculto en `/polis` (pasa a ajustes) |
| Las sesiones ya sobreviven a un reinicio, pero la UI no lo sabe | **Aviso de sesión abierta** al entrar (`GET /v1/sessions`) con «Reanudar», que se reengancha desde el evento 0 |
| Fallos sin salida | Topología no disponible → «No se pudo cargar la ciudad · Reintentar»; reconexión visible («Reconectando… intento 2/6») |

#### 5.7 Presupuestos de rendimiento

| Métrica | Objetivo |
|---|---|
| FPS | 60 en portátil medio (nivel medio); ≥ 30 en móvil (nivel bajo) |
| Draw calls | < 150 en alta; < 80 en baja |
| Triángulos en vista | < 300.000 |
| Memoria de texturas | < 128 MB |
| glTF totales | < 4 MB (meshopt + KTX2) |
| Chunk de `/polis` (sin assets) | < 250 kB comprimidos, incluido `postprocessing` |
| Rapier (si 5f) | WASM en import dinámico, nunca en el chunk inicial de `/polis` |
| Señales hacia Angular | ≤ 10 Hz |
| Tiempo hasta interactuar en `/polis` | < 3 s en escritorio con banda ancha |

#### 5.8 Pruebas de navegador en CI

`@playwright/test` en `apps/web/e2e/`, con la API en simulación (`APEIRON_LLM_PROVIDER=fake`, auth local, memoria) y el build de Angular servido por el propio Playwright (`webServer`). Chromium con SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`) y nivel de calidad bajo forzado. Un job nuevo en `ci.yml`, que además añade `npm test` (deuda de AGENTS.md §11).

Recorridos: llegada y onboarding; minimapa y viaje; preguntar a un agente; convocar con ssanax, mi turno, hablar y síntesis; paso a paso con invitación y cierre; reenganche tras cortar la red; reanudar una sesión abierta; viewport móvil (joystick, *bottom sheet*); fallback con `reducedMotion`. Las capturas se guardan como artefactos del job.

#### 5.9 Subfases

| Subfase | Contenido | Depende de | Prueba de terminado |
|---|---|---|---|
| **5a. HUD y experiencia** | 5.6 completo sobre la geometría actual; motor: intro de cámara, bocadillos, joystick explícito, minimapa a 10 Hz, desvanecido de rótulos | — | Capturas antes y después en escritorio y móvil; specs del dominio nuevo |
| **5b. E2E en CI** | 5.8 | 5a | Job verde en CI con los recorridos |
| **5c. Pase visual procedural** ✔ | Paleta, materiales, luz y sombras, niebla y post-proceso por niveles (5.1–5.3) sobre la geometría actual; selector de calidad; **adelantados** de 5d–5f: parser de convenciones, cargador glTF, lotes estáticos y adaptador de Rapier | 5a | FPS y draw calls dentro de presupuesto (overlay `?perf`), contraste AA del HUD |
| **5d. Pipeline de assets** | `validate-landmarks` en CI y primer landmark glTF (ágora); la guía de Blender ya existe | 5c | El ágora glTF sustituye a la procedural y pasa el validador |
| **5e. Motor de assets** | Resto de landmarks, KTX2 (transcoder Basis), anclas `spawn_*`/`light_*`/`fx_*` usadas por el motor; decisión sobre `residence.glb` por agente | 5d | Ciudad completa en glTF dentro de presupuesto; fallback procedural si un asset falla |
| **5f. Física** | Rapier ya integrado (5c): se activa solo si un landmark declara `fixed_*`/`sensor_*`. Queda el suelo `walk_*` (sustituir `isWalkable`) y los desniveles | 5e | Recorrido con colisiones de un asset real |
| **5g. Audio y WebGPU (opcional)** | Ambiente sonoro, `WebGPURenderer` | 5e | Revisión de experiencia |
| **5i. Polis cósmica** ✔ | Cielo procedural, escala monumental, arquitectura ciclópea, energía en las grietas, vegetación, polvo cósmico, horizonte de ruinas y claroscuro extremo | 5c | Capturas con GPU; draw calls y FPS medidos; specs del trazado a la nueva escala |
| **5h. Personaje de ssanax** ✔ | Avatar con esqueleto y animación de videojuego: locomoción con inercia, salto, gestos por evento, mirada, física secundaria, polvo; vía glTF riggeado opcional | 5c | Specs del animador; recorrido con capturas de cada animación; sin errores de consola; draw calls dentro de presupuesto |

### Revisión del encargo de rediseño (2026-10-11)

El encargo proponía un rediseño de nivel «AAA indie» (Bruno Simon + *Little Nightmares*) con servicios Angular, Rapier, parser glTF y post-proceso. Se adoptó con estas adaptaciones:

| Propuesta | Decisión | Motivo |
|---|---|---|
| Estética *Little Nightmares* | **Adaptada:** «la Polis en penumbra» + principio 7 | La oscuridad y la DoF no pueden ocultar estados, rótulos ni bocadillos: la Polis existe para observar agentes |
| Capas 0–4 mundo/HUD | **Adoptada** (5.2) | Coincide con lo que ya existe y lo ordena |
| `EngineService`, `PhysicsService`, `WorldService` como servicios | **Adaptada:** clases del motor con ciclo de vida de la página; física como puerto | La regla 4 (capas) y el `dispose` al salir de la ruta; nada en `root` |
| `SimulationStateService` | **Descartada** | Duplicaría `ResearchStore`/`PolisStore`, que ya proyectan el reducer compartido |
| `NgZone.runOutsideAngular` | **No aplica** | La app es *zoneless*; el riesgo real es escribir signals por fotograma (≤ 10 Hz) |
| Parser glTF con `node_fixed_*`, `node_sensor_*`, `node_spawn_*` | **Adoptada y ampliada** (`walk_`, `light_`, `fx_`, LOD, `extras`) | Elimina posiciones a mano dentro de cada landmark |
| Escena de Blender con posiciones fijas | **Descartada:** un glTF por landmark, colocado por `layoutCity` | La ciudad sale de la topología: un agente nuevo debe aparecer sin exportar otra escena |
| Rapier | **Condicional** (5f); revisado en 5c: integrado, se activa solo con colisionadores | Pesa ~1,2 MB comprimido en WASM; con islas planas, `isWalkable` basta |
| Bake de luz y AO, LOD, frustum culling, fusión de estáticos | **Adoptada** (5.5, 5e) | Necesaria para cumplir 5.7 |
| `EffectComposer` con DoF, viñeta, bloom, SSAO/GTAO y grading | **Adoptada por niveles** (5.3) | En móvil y en CI (SwiftShader) el pase completo no es viable |
| «Código completo» de todo en una entrega | **Sustituida por subfases** con pruebas | Cada parte debe poder verificarse y revertirse por separado |
| (No estaba) UX: orientación, crónica, móvil, reanudar | **Añadida** (5.6, subfase 5a primero) | Es lo que las capturas mostraron como problema; mejorar el render sin esto no arregla la experiencia |
| (No estaba) presupuestos, fallbacks, E2E | **Añadidos** (5.7, 5.8) | Sin ellos «calidad de producción» no es verificable |

### La Polis cósmica (subfase 5i)

El cuarto encargo pidió abandonar la «maqueta» por un entorno **cósmico, monumental y oscuro**, con la escala ciclópea de *God of War*, la estética de *Little Nightmares* y un cosmos vivo. Sustituye a la dirección de arte «en penumbra» de 5.1 en lo que respecta al **mundo**; el principio 7 (legibilidad de estados, rótulos y bocadillos) se mantiene.

| Pieza | Implementación | Coste |
|---|---|---|
| Cielo (capa 0) | `cosmos/sky.ts`: shader procedural en una esfera de 2 km que sigue a la cámara. Lleva nebulosas FBM (violeta, azul medianoche, ocre) en una banda galáctica con filamentos de polvo, tres capas de estrellas con parpadeo y tono, la luna con halo y un horizonte que se funde con la niebla. Las constelaciones geométricas (polígonos y estrellas de 5 y 7 puntas) giran 0,0025 rad/s y hay meteoros lentos cada 5–14 s | 1 draw call + 2 de constelaciones + hasta 3 meteoros |
| Escala | `WORLD_SCALE = 3,3` en `city-layout.ts`: ágora de 72 m de diámetro, columnas de 22 m, moradas a 172 m del centro, puentes de 6,6 m. Núcleo jugable ≈ 0,3 km²; con el horizonte, ≈ 1 km². Correr pasa a ~10 m/s | — |
| Arquitectura | `monuments.ts`: columnas dóricas acanaladas, columnas rotas con tambores caídos, columnata del ágora (28 columnas) y peristilos de los santuarios **sin techo**, gradas, estatuas colosales derruidas (cabeza, torso, mano) y altares. Los monumentos de cada lugar crecen ×3,3 y los obstáculos (columnas, altares, estatuas) se rodean al caminar | Fusionado por lugar y material |
| Islas y calzadas | Las islas **flotan sobre el abismo** (sin agua): losa con grietas de energía (`cosmos/energy.ts`, pulsos que fluyen por shader) y panza de roca escarpada con cristales. Las grietas son doradas en el ágora, del color del agente en su santuario y cian en el resto; calzadas con pretiles y quilla | 1 textura de grietas compartida |
| Vida | `cosmos/vegetation.ts` (árboles retorcidos y plantas bioluminiscentes), `cosmos/stardust.ts` (`THREE.Points` en un volumen que envuelve a la cámara: 1.200/3.500/6.000 partículas según el nivel) y `cosmos/horizon.ts` (rocas, tambores y monolitos a la deriva entre 330 y 520 m, y tres colosos) | 3 + 1 + 6 draw calls |
| Luz | Claroscuro extremo: ambiente índigo bajo, luna fría con sombras que cubren columnas de 22 m, antorchas instanciadas con charco de luz aditivo (`cosmos/torches.ts`, sin luces dinámicas), faroles fríos cada 14 m en las calzadas y niebla `FogExp2` índigo (0,0036) que se funde con el cielo | 4 draw calls para todas las antorchas |

**Decisiones:**

- **1 km² de escenario, no de suelo caminable.** Con el mundo entero caminable, cada consulta a un agente exigiría minutos de trayecto. El escenario llega al km² con el horizonte de ruinas; lo jugable queda en ≈ 0,3 km², y el mapa permite viajar.
- **Sin agua:** las islas flotan sobre el cosmos, que se ve también por debajo, con bruma de nebulosa bajo ellas.
- **Cámara de diorama monumental:** *pitch* 0,2 (casi horizontal, para que entren las columnas y el cielo), distancia 15, zoom hasta 80 m e intro aérea desde 260 m.
- **Antorchas sin luz dinámica:** el presupuesto de 4 luces sigue reservado al farol de ssanax y a los oradores. La luz de las antorchas es un charco aditivo más bloom.

### Personaje de ssanax (subfase 5h)

El tercer encargo pidió que ssanax fuera un personaje de videojuego «real», con animaciones, movimientos y gestos, a partir de la hoja de modelado de un personaje estilizado. **Decisión del usuario que cambia este ADR:** los avatares con esqueleto salen de «Fuera de alcance», pero solo para ssanax. Los ciudadanos siguen siendo figuras simples.

- **Una imagen no es un modelo riggeado.** Se construye un personaje **propio**, inspirado en los rasgos genéricos de la referencia (proporciones, prendas) sin copiarla, porque la hoja es obra de un tercero. Si se quiere ese modelo exacto, hace falta el fichero con licencia, y entra por la vía glTF.
- **Procedural con esqueleto real:** un `SkinnedMesh` de una pieza (un draw call y uno de sombra; antes, cinco y tres) con 22 huesos y colores por vértice. Las poses son funciones puras (`avatar/clips.ts`) y la máquina de estados también (`avatar/animator.ts`): locomoción mezclada por velocidad con la fase ligada a la distancia, salto y aterrizaje con *squash*, gestos solo del tren superior con entrada y salida suaves, bucles por estado (pensar en tu turno, gesticular al hablar) e idles variados.
- **Lo que depende del mundo** (`avatar/character.ts` y `world.ts`): inercia y giro, inclinación en las curvas, mirada hacia quien habla, parpadeo, muelles en pelo, pañuelo y faja, y polvo de pisadas y aterrizajes (`avatar/dust.ts`, un `InstancedMesh`).
- **Vía glTF:** si `assets/polis/characters/manifest.json` lista `ssanax`, `GltfAvatar` carga el modelo y aplica la misma máquina de estados a su `AnimationMixer`. Caminar y correr se sincronizan con la fase y los gestos se filtran al tren superior. Contrato de clips y guía: [docs/polis/characters.md](../polis/characters.md).
- **Gestos con significado:** saludar al llegar, convocar al convocar, hacer señas al invitar, encogerse de hombros al pasar turno, asentir con la síntesis. Atajos 1–5, Espacio para saltar y botones táctiles (Saltar, Saludar).

### Revisión del segundo encargo: atmósfera (2026-10-11, subfase 5c)

Tras la 5a, el encargo pidió priorizar la transformación visual antes de los E2E. Decisiones:

| Propuesta | Decisión | Motivo |
|---|---|---|
| `FogExp2` con paleta de ocres sucios, verde de agua estancada y gris óxido (base `#1a211e`) | **Adoptada**: la paleta de 5.1 se ajustó a ese tono | Coincide con «la Polis en penumbra» |
| Sombras en tiempo real, suaves y de alta resolución | **Adoptada por niveles**: 2048 px en alta, 1024 px en media, solo de contacto en baja | El ADR decía «sin sombras en tiempo real»; en escritorio son asumibles con lotes estáticos, en móvil y CI no |
| FOV cinematográfico 40–45° | **Adoptada**: 42° | Diorama |
| Parser en un `WorldService` que configure Rapier desde `node_fixed_*`, `node_sensor_*`, `node_spawn_*` | **Adoptada sin servicio**: parser puro en el dominio y adaptador de Rapier como implementación del puerto `PolisPhysics` | Se mantiene la decisión de la primera revisión (nada en `root`, `dispose` con la página); Rapier se descarga solo si algún landmark trae colisionadores |
| Texturas horneadas para `MeshBasicMaterial`/`MeshStandardMaterial` con AO | **Adoptada**: materiales `baked_*` → `MeshBasicMaterial`; el resto conserva la AO del glTF | Guía en `docs/polis/landmarks.md` |
| «Garantizar 120 FPS» | **No adoptada como presupuesto** | Depende del refresco de la pantalla y del equipo; el presupuesto sigue siendo 5.7, medible con `?perf` |
| `EffectComposer` con viñeta, DoF sutil y grading de alto contraste | **Adoptada** (5.3) | La DoF se apaga durante deliberación, diálogo, mapa o tu turno (principio 7) |

### Fases

| Fase | Contenido | Contratos | Prueba de terminado |
|---|---|---|---|
| **1. La ciudad** | Polis navegable con ssanax; lugares de Anaximandro, Heráclito, Ápeiron y las herramientas; diálogo por proximidad; **preguntar a un agente** (`agent?` en `ChatRequest`) y debates vistos en el ágora; corrección de `RunStatus` (`cancelled`, `failure`) | REST: `agent` en `ChatRequest` | Entro como ssanax, camino, descubro a Heráclito, le pregunto y veo su respuesta y sus herramientas en la ciudad; convoco un debate y veo a los agentes acudir y hablar |
| **2. La asamblea** | Sesiones deliberativas: participantes, invitar, duración, ritmo, debate abierto, turno de ssanax con plazo, reconexión, checkpointer | REST `/v1/sessions`, SSE `session`, esquema (`human`, `config`) | Debato con dos agentes en ritmo `step`, escribo mi turno dentro del plazo, me reengancho, cierro y recibo la síntesis |
| **3. Nuevos ciudadanos** | Nietzsche, Feynman, Epicuro; metadatos por agente (catálogo declarativo); cota de 6; evals de diferenciación | Esquema (`agents`), cota, A2A por agente | Debate con los cinco y ssanax; el eval con LLM real distingue a cada ciudadano |
| **4. Archivo y Faro** | Reproducir crónicas (`events jsonb` en `agent_runs`), tokens por agente, Faro con `/v1/system` | Esquema, REST `/v1/runs/{id}` | Reproduzco un debate pasado evento a evento |
| **5. Acabado** | Sesiones durables, 5a, 5c, 5h y 5i (hechas); subfases 5b, 5d–5g | `GET /v1/sessions` | Ver [5.9](#59-subfases) |

### Fuera de alcance

Multijugador (varios humanos en la misma polis), voz, avatares con esqueleto **para los ciudadanos** (ssanax sí lo tiene desde 5h), GSAP, PixiJS, React y cualquier lógica de agentes en el frontend.

## Consecuencias

- Ápeiron pasa de herramienta observable a **sistema habitado**. La consola sigue siendo la vista técnica y el fallback.
- La fase 2 introduce el checkpointer que ADR-009 dejaba pendiente. Con `APEIRON_SESSIONS_DB_PATH`, las sesiones sobreviven a un reinicio; la durabilidad sigue siendo **de una instancia** (SQLite local): con varias réplicas hace falta un almacén compartido detrás de `SessionJournalPort` y del checkpointer.
- Las reglas 7 y 8 cambian por decisión explícita, no por accidente. La cota sube a 6 y el coste se acota con topes duros por sesión.
- Añadir un agente deja de ser código: es una carpeta. A cambio, el catálogo SQL depende de un paso generado (`python -m apeiron_agents migration`) que un test vigila.
- Cada agente publicado por A2A es una superficie de entrada más: hereda el Bearer, el rate limit y los guardrails del servidor A2A, y se puede desactivar con `a2a = false` en su manifiesto.
- El humano en el bucle amplía la superficie de ataque: el texto de ssanax entra en el prompt de los agentes. Se mitiga con el guardrail `input` en cada turno y con la regla de sistema que trata como datos los turnos ajenos.
- La personalidad de los agentes es ahora un artefacto medible: un cambio de persona debería ir acompañado de un eval con LLM real (coste ≈115.000 tokens por ejecución completa).
- La fase 5 añade dependencias al chunk de `/polis` (`postprocessing`, quizá `three-stdlib`/`n8ao`, Rapier condicional) y un flujo de arte (Blender, `gltf-transform`) que no existía.

## Estado actual y brechas

**Fase 1 implementada** (2026-10-10):

- **Backend:** `agent?` en `ApeironInput`, `ChatUseCasePort`, `ApeironFacade` y `ChatRequest` (patrón de id, solo con `single`, validado contra `/v1/agents`). El router lo respeta por encima de las pistas de enrutado.
- **Estados:** `RunStatus` gana `cancelled` y `RunState.failure` (`server` | `network`). `cancelRun` y `failRun` cierran los nodos activos (`settleRun`), y la consola también lo aprovecha.
- **Polis:** contexto `apps/web/src/app/polis/`, con el dominio (`city-layout.ts`, `citizen-state.ts`, `signals.ts`), `PolisStore` sobre `ResearchStore`, el motor en `presentation/engine/` y la ruta lazy `/polis`.
- **Convocatoria:** los convocados tardan 1,4 s en llegar al ágora (los trayectos largos se aceleran) y la petición se lanza al llegar. Cancelar durante la convocatoria no llega al backend.

| Criterio | Cómo se verificó | Resultado |
|---|---|---|
| Lugares generados desde `/v1/agents`, forasteros incluidos | `polis.spec.ts`: 2, 5 y 6 agentes, sin solapes, puertos para remotos | ✔ |
| Cada puente es pisable de punta a punta | `polis.spec.ts`: recorrido cada 0,5 m con 2, 5 y 6 agentes y con forasteros. Detectó y corrigió un edificio que bloqueaba el puente del Gnomon | ✔ |
| Estados por agente, incluidas la cancelación y las dos clases de fallo | `polis.spec.ts` y `run-state.spec.ts` | ✔ |
| Nunca queda un agente en `working` tras cancelar, fallar o perder la conexión | Specs y recorrido en Chrome (cancelar a mitad de debate: todos `idle`) | ✔ |
| `agent` validado contra la topología | `test_core.py` (router) y `test_api.py` (422 en `/v1/chat` y `/v1/chat/stream`) | ✔ |
| Capas respetadas | `architecture.spec.ts` con `polis/` | ✔ |
| Bundle inicial sin crecer | Build de producción sin avisos; Three.js en el chunk lazy (≈111 kB comprimidos) | ✔ |
| Prueba de experiencia | Recorrido automatizado en Chrome en simulación: entrar como ssanax, caminar, mapa, preguntar a Heráclito, convocar un debate y cancelar | ✔ |

**Fases 2 a 4 implementadas** (2026-10-11):

- **Fase 2, la asamblea:** `orchestration/control.py` (`DeliberationControl` en un ContextVar); `graph.py` con nodo `human` e `interrupt()`, supervisor con ritmo `step`, cierre, invitados, presupuesto de tiempo y topes; `use_cases/deliberation.py` (`DeliberationService`); `routes/sessions.py`; en la web, `HttpDeliberationAdapter` con reenganche `after=N`, la tribuna y la barra de turno.
- **Fase 3, nuevos ciudadanos:** Nietzsche, Feynman y Epicuro, cada uno con una función cognitiva; cota de 6.
- **Fase 4, Archivo y Faro:** cronología `events` y `config` en `agent_runs`; `llm_calls` y tokens por agente (ContextVar `current_agent`); `replayPlan`; luz del Faro desde `overallHealth(/v1/system)`. Migración `20261011120000_polis_sessions.sql`.

**Catálogo de agentes, sesiones durables y eval con LLM real** (2026-10-11):

- **Catálogo:** paquete `packages/agents` con las cinco carpetas; `AgentSpec` en el dominio; `SpecAgentFactory`; pistas, posturas, nombres visibles y residencias desde los manifiestos; A2A por agente; `AgentDirectory` en la web; migración generada `20261011120001_agents_catalog.sql`; contrato nuevo de import-linter.
- **Durabilidad:** `SessionJournalPort`, `SqliteSessionJournal`, `open_sqlite_checkpointer`, `GET /v1/sessions`, rehidratación perezosa, parada ordenada (`Container.aclose`).
- **Eval:** `apeiron_api/evals/differentiation.py`, informes en `docs/evals/`, personas v2 e instrucción de diálogo nueva.

| Criterio | Cómo se verificó | Resultado |
|---|---|---|
| Ningún código conoce a un agente por su nombre | `grep` de los cinco nombres en el código de `core`, `infra`, `api` y la web (sin tests): solo comentarios y contenido (corpus semilla de la memoria, ejemplos de la card de Ápeiron, casos de estudio y la portada de acceso); ninguna lógica | ✔ |
| Un agente nuevo es solo una carpeta | `test_catalog.py`: un agente de prueba en una carpeta temporal se carga sin código | ✔ |
| Manifiestos inválidos no arrancan | `test_catalog.py` (carpeta ≠ nombre, claves desconocidas, persona sin nombre, silueta desconocida, tools mal tipadas, sin persona) y `test_core.py` (nombres reservados, simulación incompleta) | ✔ |
| Catálogo SQL alineado con los manifiestos | `test_catalog.py` compara la huella de la última migración generada | ✔ |
| Lista de acceso de herramientas y tope de pasos por agente | `test_core.py` (`SpecAgentFactory` solo entrega las tools declaradas) | ✔ |
| Card y endpoint A2A por agente; otro Ápeiron recluta a Feynman | `test_a2a_api.py` (card, 404, 401, consulta a Epicuro, Feynman remoto de punta a punta) | ✔ |
| Residencias y nombres visibles desde la topología | `test_api.py` (`/v1/agents`) y `polis.spec.ts` (silueta y color inválidos → templo) | ✔ |
| Una sesión abierta sobrevive a un reinicio | `test_sessions.py` (dos instancias con diario y checkpointer compartidos) y `test_sessions_api.py` (dos apps reales con SQLite: la sesión duerme, `GET /v1/sessions` la lista, despierta con el dueño, el turno pendiente se respeta, la numeración continúa y nada se repite) | ✔ |
| La parada no se confunde con una cancelación | `test_sessions.py` | ✔ |
| Diario: orden, idempotencia, sesiones abiertas por dueño y poda | `test_sessions_store.py` | ✔ |
| Diferenciación con LLM real | Eval v1 → v2: atribución ciega 53% → 85%, solapamiento 0,294 → 0,128 | ✔ con brechas |
| Métricas del eval | `test_evals.py` (enmascarado, solapamiento, los degradados no cuentan) | ✔ |
| Suite completa | `pytest` 184, ruff, mypy (101 ficheros), import-linter 6 contratos, `npm test` 51, build de producción | ✔ |

**Subfase 5a, HUD y experiencia** (2026-10-11):

- **Dominio:** `polis/domain/hud.ts` (presets de la tribuna, cuenta atrás, línea de progreso, crónica, anuncio para `aria-live`, dock de ciudadanos, opacidad de rótulos, rumbo del minimapa, controles por dispositivo, estado del enlace y sesión reanudable), la señal `speech` en `signals.ts` y la casa con el nombre del jugador (`layoutCity(agents, player)`, sin mover el trazado).
- **Aplicación e infraestructura:** `DeliberationPort.list()` (`GET /v1/sessions`) y `events(id, link)`, que informa de los reintentos; `PolisStore` con `player`, `plan` (lo pedido al convocar: rondas, presupuesto y plazo del turno), `link`, `resumeOffer`/`resume` y `retryTopology`.
- **Motor:** introducción de cámara de vista aérea a ssanax (2,6 s; el primer gesto la corta), bocadillos CSS2D con un extracto del turno (6–14 s), posición y rumbo hacia Angular a ≤ 10 Hz y solo si cambian, rótulos que se desvanecen entre 22 y 62 m (y se ocultan más allá) y joystick explícito: arrastrar en el lienzo siempre mira.
- **HUD** (`presentation/hud/`, componentes standalone `OnPush`): `minimap`, `roster`, `chronicle`, `turn-bar`, `tribune`, `onboarding`, `joystick` y `resume-banner`. Los tokens del HUD (`--hud-*`) están en `:host` de la página para que 5c cambie la paleta en un solo sitio.
- **Shell:** el botón global de tema no se muestra en `/polis`, y la app tiene favicon en línea (el 404 de `favicon.ico` habría roto los E2E de 5b, que fallan con errores de consola).

| Criterio | Cómo se verificó | Resultado |
|---|---|---|
| Specs del dominio nuevo | `hud.spec.ts` (14 casos) y `polis.spec.ts` (señal `speech`); `npm test` 65 | ✔ |
| Capturas antes y después, escritorio (1440×900) y móvil (390×844) | Recorrido con `@playwright/test` y el Chrome del sistema contra `ng serve` y la API en simulación: llegada, onboarding, minimapa, viaje al ágora, tribuna, convocar con ssanax, mi turno, hablar con `Ctrl+Enter`, síntesis y crónica; en móvil, onboarding táctil, joystick, botón de mapa y tribuna como *bottom sheet* | ✔ |
| Reanudar una sesión abierta | Sesión creada por API en ritmo `step`; al entrar aparece el aviso y «Reanudar» reengancha desde el evento 0 («Siguiente: Nietzsche · Dar la palabra») | ✔ |
| Sin errores de consola en los recorridos | Escucha de `console`/`pageerror` en los scripts | ✔ |
| Señales hacia Angular ≤ 10 Hz | El motor solo emite posición cada 0,1 s y si cambia (`moved`); el joystick emite por evento de puntero | ✔ |
| Capas respetadas y bundle | `architecture.spec.ts`; build de producción sin avisos de presupuesto (estilos de componente < 10 kB); chunk de `/polis` ≈ 135 kB comprimidos con el motor | ✔ |

**Subfase 5c, atmósfera y motor** (2026-10-11):

- **Dominio:** `atmosphere.ts` (paleta, tono de agente en reposo, contraste WCAG, `HUD_TOKENS`, niveles de calidad, `QualityGovernor`, `renderSettings` por nivel y `overBudget`) y `landmark-conventions.ts` (clasificación de nombres y `planLandmark`).
- **Motor:** `engine/atmosphere.ts` (cielo, `FogExp2`, hemisférica, luna con sombras que sigue a ssanax, planos de niebla baja, disco de luna, linternas instanciadas, 4 luces dinámicas fijas para no recompilar shaders), `post/post-pipeline.ts` (`postprocessing` 6.39: HDR, bloom, AgX, `GradeEffect`, viñeta, grano y DoF en su propio pase), `world/batching.ts` (lotes estáticos por lugar y material), `world/gltf/{scene-nodes,loader}.ts`, `physics/{walkable,walkable-2d,rapier}.ts` y la oclusión de cámara en `world.ts`. Materiales de `places.ts` y `figures.ts` con la paleta nueva; FOV 42°.
- **HUD:** tinta clara sobre `abyss`, reglas de 1 px y rótulos en mayúsculas monoespaciadas; los tokens `--hud-*` los escribe la página desde `HUD_TOKENS`. Selector Baja/Media/Alta (se recuerda), `?quality=` para CI y overlay `?perf`.
- **Dependencias:** `postprocessing` 6.39.5 (en el chunk de `/polis`) y `@dimforge/rapier3d-compat` 0.21.0 (chunk aparte, solo si hay colisionadores). `angular.json` sirve `apps/web/public/` (manifiesto de landmarks en `assets/polis/landmarks/`, hoy vacío). Los assets no pueden vivir bajo `/polis/`: en nginx, un directorio con el nombre de la ruta convierte `/polis` en un 301 a `/polis/` y rompe la recarga de la SPA (se detectó al probar en Docker).

| Criterio | Cómo se verificó | Resultado |
|---|---|---|
| Contraste AA del HUD | `atmosphere.spec.ts`: los 8 pares texto/fondo de `HUD_CONTRAST_PAIRS` ≥ 4,5:1 | ✔ |
| Niveles, regulador y DoF bloqueada | `atmosphere.spec.ts` (baja sin composer ni sombras; DoF nula con foco bloqueado o movimiento reducido; el regulador baja tras 3 s lentos y nunca sube) | ✔ |
| Convenciones y Rapier sin posicionar a mano | `landmark-conventions.spec.ts`, `scene-nodes.spec.ts` (escena tipo Blender con jerarquía y raíz desplazada) y `rapier.spec.ts` con el WASM real (un muro `node_fixed_*_box` detiene a ssanax, el giro del landmark gira sus colisionadores, los sensores se detectan y el suelo 2D sigue vetando el agua) | ✔ |
| FPS y draw calls (overlay `?perf`, Chrome con RTX 2060, 1440×900) | Media: 60 fps, 128 draw calls; alta: 60 fps, 140 (debate 138); baja en móvil 390×844: 58–61 fps, 35. Antes de los lotes: 310 y 331 | ✔ (60 fps es el tope de vsync de la pantalla) |
| Sin errores ni avisos de consola | Recorridos con Playwright (llegada, paseo, tribuna, debate con tu turno) en las tres calidades | ✔ |
| Suite web y build | `npm test` 81, build de producción sin avisos; chunk de `/polis` ≈ 180 kB comprimidos | ✔ |

**Subfase 5h, personaje de ssanax** (2026-10-11):

| Criterio | Cómo se verificó | Resultado |
|---|---|---|
| Esqueleto y animación correctos | `animator.spec.ts` (10 casos): rig de un solo árbol y simétrico, de 2,5 m; piernas y brazos opuestos; pasos proporcionales a la distancia (los pies no patinan) y en la zancada completa del pie adelantado; mezcla reposo/caminar/correr; salto con impacto y *squash* que se recupera; gestos solo en el tren superior que terminan a tiempo; prioridades hablar > pensar y gesto puntual > bucle; idle variado y nunca en tu turno; rotaciones acotadas | ✔ |
| Contrato del glTF riggeado | `gltf-clips.spec.ts`: clips por nombre (con prefijo de Mixamo), gestos sin pistas de cadera y piernas, sincronía de fase y caídas a otro clip | ✔ |
| Prueba visual | Recorrido en Chrome con GPU: saludo al llegar, frente en reposo, caminar, correr con polvo, salto, gestos 1–4, convocatoria, pensar en tu turno y hablar | ✔ |
| Consola y rendimiento | Sin errores ni avisos; el avatar baja de 5 draw calls a 1 (más 1 de sombra) | ✔ |

La prueba visual destapó dos fallos de cámara que no eran del personaje: la linterna del puente tapaba la llegada (se adelantó 3 m sobre el puente) y, con la cámara pegada al núcleo de Ápeiron, la pieza translúcida teñía la pantalla (ahora lo que está a menos de 2,5 m de la cámara, o la contiene, se oculta). Al escribir la guía apareció un tercero: las pisadas caían cuando las piernas se cruzaban; se corrigió y tiene test.

**Subfase 5i, Polis cósmica** (2026-10-11):

| Criterio | Cómo se verificó | Resultado |
|---|---|---|
| Trazado a la nueva escala | `polis.spec.ts` (sin solapes, cada puente pisable de punta a punta con 2, 5, 6 agentes y forasteros, llegadas pisables, asientos cerca de la bema) y `hud.spec.ts` (desvanecido de rótulos escalado) | ✔ |
| Obstáculos de la arquitectura | `rapier.spec.ts`: ssanax no atraviesa una columna, la rodea y sale si aparece dentro | ✔ |
| Contraste del HUD con la paleta índigo | `atmosphere.spec.ts` | ✔ |
| Imagen | Capturas con GPU: vista aérea de la ciudad flotando en el cosmos, llegada, ágora desde dentro y en plano abierto (ssanax diminuto entre columnas de 22 m), deliberación y móvil | ✔ |
| Rendimiento (RTX 2060, 1440×900) | Media: 60 fps, 146 draw calls; alta: 60 fps, 134 en el debate y 158 a la llegada (incluye unos 20 pases a pantalla completa de DoF y bloom); baja en móvil: 58 fps, 63. Triángulos ≈ 100.000 (presupuesto 300.000) | ✔ con la salvedad de la llegada en alta |
| Sin errores ni avisos de consola | Recorridos completos | ✔ |

**Desviaciones respecto al diseño:**

- **Esperar no es un `RunStatus`.** Se implementó como `RunState.session` (la última instantánea del evento `session`). Así `running` sigue significando "ejecución abierta" en la consola y la espera es un detalle de la sesión.
- **Canal `session` en `agent_runs`** para distinguir las deliberaciones de la consola (`web`) y de A2A.
- **Pasar turno = turno vacío.** `POST /turn` admite `""`. LangGraph 1.2 falla al reanudar con `Command(resume=None)`, así que la sesión nunca reanuda con `None` (tampoco al cerrar mientras espera: se reanuda con `""` o `True`).
- **El catálogo de agentes llegó después de la fase 3**, no con ella: las tres fábricas nuevas se hicieron primero con la receta antigua y luego se migraron a carpetas.
- **La durabilidad de sesiones se adelantó** desde la fase 5 y es local (SQLite), no compartida.
- **5a: `top-bar` y `place-panel` siguen en la página** y no en `hud/`: son la parte que menos cambia y moverlos no mejoraba nada medible. El mapa completo también sigue en la página; el minimapa lo abre.
- **5a: el HUD conserva la paleta clara actual.** La dirección de arte «en penumbra» (5.1) y el estilo del HUD de la capa 4 son de 5c; aquí solo se centralizaron los tokens.
- **5a: con puntero grueso y una sesión abierta, el joystick se oculta**: la barra de turno ocupa la parte baja de la pantalla. Se puede volver a caminar al cerrar o cancelar la sesión.
- **5a: el plazo total del turno (anillo) solo se conoce en sesiones convocadas desde esta pestaña.** Al reanudar, el anillo empieza lleno con el tiempo que quede, porque `GET /v1/sessions` no devuelve la configuración.

**Brechas abiertas:**

- **Migraciones sin aplicar:** `20261011120000_polis_sessions.sql` y `20261011120001_agents_catalog.sql` necesitan `npx supabase db push` en el proyecto remoto, con confirmación del usuario (AGENTS.md §9). Hasta entonces, guardar una sesión en Supabase falla con un warning (`run_persist_failed`).
- **Regresión de las personas v2: 3 de 30 turnos degradados** (Feynman 2, Nietzsche 1: «no se obtuvo una respuesta final válida»); la línea base tuvo 0. **Causa no verificada.** Hipótesis: con `MAX_REACT_STEPS=2` y evidencia obligatoria, Feynman (cuatro herramientas) encadena una segunda herramienta y agota los pasos; o la forma pedida (etiquetas en negrita, listas) choca con el protocolo de texto del ReAct. Siguiente paso: revisar las trazas en LangSmith y, si se confirma, `max_steps = 3` en el manifiesto de Feynman o una instrucción de cierre.
- **Anaximandro solo se reconoce el 50%** (se confunde con Heráclito). Su persona necesita un rasgo de forma más exclusivo.
- **El eval es pequeño** (27 intervenciones válidas, un solo juez del mismo proveedor): sirve para comparar versiones, no como medida absoluta.
- **Durabilidad de una sola instancia:** SQLite local; los tokens consumidos antes de una caída abrupta solo se conservan hasta el último cambio de estado, y las duraciones por agente previas al reinicio quedan en cero.
- **No hay pruebas de navegador en CI** (subfase 5b). `@playwright/test` ya está en las devDependencies de la web, pero los recorridos de 5a se hicieron con scripts fuera del repositorio; 5b los convierte en `apps/web/e2e/`.
- **Sin probar en navegador:** el aviso «Reconectando… intento N/6» (requiere cortar la red a mitad de sesión, previsto en 5b), el panel «No se pudo cargar la ciudad · Reintentar» y la ruta con `prefers-reduced-motion`.
- **5c sin asset real:** el cargador glTF, los LOD, los materiales `baked_*` y el paso a Rapier solo se han probado con escenas sintéticas en Node; el primer `.glb` de verdad llega en 5d. KTX2 sigue pendiente (5e).
- **El suelo `walk_*` aún no sustituye a `isWalkable`:** Rapier aporta colisiones con `fixed_*` y sensores; la superficie pisable sigue siendo la de las islas y los puentes.
- **Con SwiftShader (CI) la Polis va a 10–15 fps en media y alta:** por eso CI fuerza `?quality=low` (35 draw calls, sin composer ni sombras).
- **Las draw calls de `renderer.info` incluyen los pases a pantalla completa** del post-proceso (bloom con mipmaps, DoF): durante la introducción aérea en alta se llegó a 180 con SwiftShader; con GPU, 140.
- **El presupuesto de tiempo se comprueba entre turnos:** un turno largo en curso no se interrumpe (así estaba diseñado).
- **Las crónicas anteriores a la migración no tienen `events`:** el Archivo lo indica en lugar de reproducirlas.
- **La portada de acceso aún dice «dos filósofos»:** es texto anterior a la autenticación y no conoce la topología.

**Decisiones abiertas:** cómo se publica un `residence.glb` por agente (5e); cuándo el suelo `walk_*` sustituye a `isWalkable` (5f); si la Polis sustituye a la consola como página de inicio.
