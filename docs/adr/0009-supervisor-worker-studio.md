# ADR-009: Topología supervisor/worker, workers como subgrafos y LangGraph Studio

**Estado:** COMPLETADO (reemplaza la topología de debate de ADR-003)  
**Fecha:** 2026-10-03

## Contexto

El grafo de ADR-003 tenía un único nodo genérico `agent_turn` alimentado con `Send` en paralelo. Funcionaba, pero ocultaba la arquitectura: en LangGraph Studio y en la UI no se veía qué agente actuaba, el ciclo ReAct era un bucle de Python invisible y, al ejecutarse en paralelo, los agentes no podían leerse dentro de la misma ronda. Se pidió que Ápeiron orqueste con pasos explícitos, que Heráclito sea un worker que interactúe con Anaximandro y que el grafo se pueda ver e interactuar de punta a punta con el menor coste de tokens.

## Alternativas

1. Mantener `Send` paralelo y solo renombrar nodos: no hay interacción real dentro de la ronda.
2. Supervisor/worker secuencial: Ápeiron decide el siguiente orador después de cada turno.
3. Handoffs libres entre agentes (cada worker elige al siguiente): menos control de coste y rondas.

## Decisión

Se adopta la alternativa 2.

```
START -> apeiron_router -> <worker> -> apeiron_supervisor -> <worker> | apeiron_synthesis -> END
                              └─ subgrafo ReAct: reason -> act (tool) -> reason ... -> END
```

- **Ápeiron (orquestador)** tiene tres nodos: `apeiron_router` (modo y participantes), `apeiron_supervisor` (después de cada turno decide el siguiente worker o el cierre por `max_rounds`) y `apeiron_synthesis` (síntesis LLM en debate; en `single` devuelve el turno sin llamar al LLM).
- **Workers** (`anaximandro`, `heraclito`, …) son nodos con nombre propio generados desde el registro. `ReActAgent` compila su propio subgrafo (`reason`, y `act` si tiene tools). El nodo del worker referencia el subgrafo directamente, para que `get_graph(xray=True)`, Studio y `astream(subgraphs=True)` lo vean.
- **Interacción**: en debate los workers hablan por turnos. Cada prompt incluye solo la **última** posición de cada interlocutor (`dialogue_block`), con la instrucción de responderle. Así Heráclito replica a Anaximandro en la misma ronda, y el contexto no crece con el historial completo, lo que ahorra tokens.
- Se mantienen las cotas de ADR-003: rondas 1–4, 1–4 participantes, pasos ReAct 1–8 y timeouts por nodo y por tool. También la degradación por worker y por síntesis. Los nombres `apeiron_*` y `__*` quedan reservados. `recursion_limit=100` cubre el peor caso (4 rondas × 4 workers).
- **Streaming**: la facade usa `stream_mode=["tasks","updates","custom"]` con `subgraphs=True`. Además de `trace`, `turn` y `answer`, emite el evento SSE `node` (`{node: "anaximandro/act", status: start|end, error}`). El evento `answer` incluye `usage` (llamadas y tokens, medidos con un `ContextVar` que alimentan los adaptadores LLM) y `simulate`.
- **Modo simulación**: `ChatRequest.simulate=true` ejecuta un grafo idéntico con `FakeLLM`. Recorre router, workers, `act` (consulta la memoria vectorial real) y síntesis con 0 tokens, a un ritmo visible (`APEIRON_SIMULATION_PACE_S`). No escribe en la memoria del usuario.
- **LangGraph Studio**: `langgraph.json` expone `apeiron` (LLM real) y `apeiron_demo` (simulado) desde `apeiron_api.studio`, con la misma composición que la API. El servicio Compose `studio` (perfil `studio`, solo desarrollo) ejecuta `langgraph dev` en `127.0.0.1:2024`. La UI web de Studio se conecta desde `smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024`. No existe una UI de Studio autoalojable; el servidor y los datos sí quedan en local.
- **UI**: login en ruta propia con guards, y la consola muestra el grafo en vivo (SVG dibujado con la topología de `GET /v1/agents`) a partir de los eventos `node`. No hace llamadas extra al LLM.

## Consecuencias

El debate pasa a ser secuencial: la latencia de una ronda es la suma de los turnos y no el máximo, con el mismo número de llamadas LLM. A cambio hay diálogo real y un grafo legible. El contrato SSE se amplía: el primer evento ahora es `node`. Los clientes que ignoran tipos desconocidos no se rompen. En Studio no hay JWT: la memoria se consulta como `anonymous` y se recomienda `apeiron_demo` para explorar sin coste. El servidor `langgraph dev` es en memoria y no es un artefacto de producción.

## Estado actual y brechas

Implementado y cubierto por tests de núcleo (topología con subgrafos, orden de turnos y diálogo, eventos de nodo internos y uso de tokens) y de API (simulación sin tokens que recorre `act` de ambos workers, topología). Pendiente: checkpointer persistente para *time travel* fuera de Studio, y que la síntesis cite explícitamente la evidencia recuperada.
