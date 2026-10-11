# ADR-014: Consola conversacional (hilos, mesa del debate, Markdown e inspector del grafo)

**Estado:** IMPLEMENTADO. Amplía ADR-006 (Angular y streaming), ADR-010 (Supabase e historial) y ADR-013 (participantes elegidos). No cambia el contrato SSE (regla 7 de AGENTS.md); añade campos opcionales a `POST /v1/chat` y un endpoint de lectura.  
**Fecha:** 2026-10-11

## Contexto

La consola (`/`) se quedó atrás respecto a la Polis:

| Problema | Situación de partida |
|---|---|
| El grafo en vivo ocupaba una columna fija de 350 px y con cinco workers los rótulos se solapaban | `AgentGraphComponent` dibujaba siempre en un lienzo de 320 unidades |
| El debate era siempre entre los mismos dos agentes | `/v1/chat` no aceptaba `participants`; se usaba `debate_participants` (los de `debate = true`) |
| Cada pregunta moría tras la respuesta | No había hilo: la consola mostraba una sola ejecución y el grafo no recibía contexto previo |
| El historial era una lista de ejecuciones sueltas | `agent_runs` no sabía a qué conversación pertenecía cada ejecución |
| La salida de los modelos se veía «distorsionada» | Se pintaba como texto plano con `white-space: pre-wrap`: `**`, `#`, listas y tablas aparecían crudos |

## Alternativas

1. **Contexto de la conversación enviado por el cliente** (el historial en el body). Descartado: el cliente podría inyectar «respuestas de Ápeiron» falsas y saltarse los guardrails de salida; además duplica datos que el servidor ya guarda.
2. **Checkpointer de LangGraph por conversación** (como las sesiones de ADR-013). Descartado para la consola: obliga a mantener el estado completo del grafo por hilo, y lo que necesitan los agentes es solo un resumen acotado de lo ya dicho.
3. **Contexto compuesto en el servidor desde las ejecuciones guardadas del propio usuario** (elegida).
4. Para el Markdown: **`marked` + DOMPurify con `innerHTML`** frente a **un parser propio a árbol pintado con plantillas**. Con la sesión de Supabase en `localStorage` (ADR-010) un XSS es crítico; el árbol elimina la clase de fallo en lugar de mitigarla y no añade dependencias.

## Decisión

### Conversaciones (backend)

- `ChatRequest` admite `conversation_id` (UUID que genera el cliente). La API no confía en él más allá de agrupar: solo se leen ejecuciones del **mismo usuario** (filtro `user_id` + RLS).
- `ApeironFacade.stream` lee los últimos intercambios (`ConversationPort.exchanges`, máx. 6) y compone un bloque acotado (`conversations.context_block`: 500 caracteres por pregunta, 1200 por respuesta, 6000 en total) que entra al grafo como `context` (`ApeironInput`). El worker lo pasa al subgrafo ReAct, que lo coloca **después** de la pregunta, marcado como contexto y no como instrucciones. Un agente remoto (A2A) lo recibe dentro de la pregunta.
- Solo cuentan intercambios `completed`: las preguntas bloqueadas y las ejecuciones fallidas no entran en el contexto.
- Persistencia: `agent_runs.conversation_id` (migración `20261011130000_console_conversations.sql`, índice parcial por usuario y conversación, `record_agent_run` actualizada). `SupabaseRunRepository` implementa `ConversationPort` leyendo `agent_runs`; su `append` no hace nada porque la RPC ya guarda la ejecución.
- Sin Supabase (modo `local`) se usa `InMemoryConversations`: por usuario, LRU de 500 conversaciones y 6 intercambios cada una, **por instancia**.
- Si leer el contexto falla, la pregunta sigue sola (`conversation_load_failed` en métricas y logs): degradar, no caer.
- `GET /v1/conversations/{uuid}` devuelve las ejecuciones completas del hilo en orden (404 si no existe o es ajeno, 404 sin Supabase, 502 si Supabase falla). `GET /v1/runs` incluye `conversation_id` y la consola agrupa por él.

### Mesa del debate

- `ChatRequest` admite `participants` (1–6, sin repetir, en orden de palabra). Fuerza el modo `debate`, no se combina con `agent` ni con `mode: "single"`, y la ruta los valida contra la topología publicada (422). El humano no es un participante válido aquí: solo existe en las sesiones de ADR-013.
- El grafo ya lo soportaba desde ADR-013 (`ApeironInput.participants`); la facade solo lo reenvía.

### Consola (frontend)

- **Dos columnas**: conversaciones (agrupadas desde `/v1/runs`) y casos de estudio a la izquierda; el hilo y el compositor a la derecha. El hilo se desplaza dentro del panel y sigue el final mientras llegan turnos, salvo que el usuario haya subido a releer.
- **Compositor**: Consulta (con interlocutor opcional) o Debate (chips de la mesa con su número de orden y rondas 1–4). Intro envía; Mayús+Intro salta de línea.
- `ResearchStore.ask()` archiva el intercambio anterior, fija el `conversation_id` y lanza el siguiente; `openConversation()` reabre un hilo completo. `run()` y `follow()` no cambian (la Polis los sigue usando).
- Los debates ya cerrados del hilo muestran la síntesis y pliegan sus turnos.
- **Inspector del grafo**: la columna derecha desaparece. Una etiqueta «Grafo en vivo» en la cabecera (con el nodo activo y el consumo) despliega un popover al pasar el puntero o al enfocarla; un clic lo fija (pantallas táctiles) y Escape o un clic fuera lo cierran. Contiene el grafo, el consumo, los guardrails y la traza. El lienzo del grafo crece con el número de workers (124 unidades por caja) en lugar de estrechar las cajas.
- **Markdown**: `domain/markdown.ts` produce un árbol (títulos, párrafos con saltos de línea, listas anidadas, citas, código, tablas GFM, separadores, énfasis, código en línea y enlaces) y `MarkdownComponent` lo pinta con plantillas recursivas. Ningún texto del modelo llega al DOM como HTML; los enlaces solo admiten `http(s)` y `mailto`.

## Consecuencias

- Una pregunta de seguimiento cuesta más tokens de entrada (hasta ≈6000 caracteres de contexto por worker y llamada). En simulación no cambia nada: el `FakeLLM` ignora el contexto.
- Los agentes responden con memoria de la conversación, pero solo de las **respuestas finales** (síntesis o turno único), no de cada turno del debate ni de la evidencia: el contexto se mantiene corto.
- La migración debe aplicarse antes de desplegar la API: sin la columna, `GET /v1/runs` falla (502) porque selecciona `conversation_id`.
- Con varias réplicas y sin Supabase, cada instancia tiene su propia memoria de conversaciones (la misma limitación que `SlidingWindowLimiter` y `A2ATaskStore`).

## Estado actual y brechas

- Implementado y probado: `test_conversations.py` (núcleo), `test_supabase.py` (adaptador), `test_api.py` y `test_supabase_api.py` (API), `markdown.spec.ts` y `conversation.spec.ts` (web). Recorrido de navegador hecho a mano en simulación (consulta → seguimiento como debate de tres → popover).
- Pendiente: renombrar o borrar conversaciones desde la UI (hoy solo con la política `delete` de RLS), LaTeX/KaTeX en el Markdown, resaltado de sintaxis en los bloques de código, continuar una sesión de la Polis como conversación de la consola, y un E2E automático del flujo (fase 5b de ADR-013).
