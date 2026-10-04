# ADR-006: Contrato API, streaming y aplicación Angular

**Estado:** Aceptada como baseline de arquitectura  
**Fecha:** 2026-10-03

## Contexto

El usuario necesita iniciar casos guiados o preguntas libres, observar el avance del grafo y recibir respuestas con Markdown y fórmulas sin esperar al final de todos los turnos. La petición necesita autenticación y cancelación desde el navegador.

## Alternativas

1. REST sin streaming.
2. WebSocket bidireccional para todos los intercambios.
3. REST para operaciones discretas y Server-Sent Events para respuesta incremental.

## Decisión

Se adopta la alternativa 3. FastAPI expone inicialmente:

- `POST /v1/auth/register` y `POST /v1/auth/token`.
- `GET /v1/agents` para agentes/modos disponibles.
- `POST /v1/chat` para respuesta completa.
- `POST /v1/chat/stream` para SSE autenticado.

El contrato `ChatRequest` contiene pregunta no vacía (máximo inicial 4000 caracteres), `mode` (`single` o `debate`) y `max_rounds` (1–4). El usuario autenticado se toma del token, nunca del body. Una respuesta completa incluye answer, modo, turnos y traza.

El stream usa `Content-Type: text/event-stream`, `Cache-Control: no-cache` y deshabilita buffering del proxy. `fetch` + `ReadableStream` (no `EventSource`) permite POST, cabecera Bearer y cancelación por `AbortController`. El contrato de eventos versionado en modelos web es:

- `trace`: lista ordenada de transiciones visibles del grafo/herramientas.
- `turn`: agente, ronda y texto emitido como posición del especialista.
- `answer`: respuesta final y modo.
- `error`: código público estable y trace ID opcional, sin excepciones internas.

Los frames SSE se parsean por delimitadores de evento, tolerando fragmentación entre chunks y fin de línea CRLF. La terminación normal completa el stream; desconectar cancela el trabajo si es seguro hacerlo. No se promete replay/reconexión sin cursor mientras no exista persistencia de eventos. Nunca se transmite `Thought` privado; solo estados como routing, thinking, tool execution, reflection y synthesis.

El cliente objetivo es una app Angular standalone con routing y SCSS, versión fijada en lockfile. Su estructura contiene:

- Dashboard con diez casos de uso precargados, seleccionables y con modo asociado.
- Consola de chat que admite prompt libre, historial de la sesión visible, cancelación, Markdown y KaTeX.
- Agent State Viewer que consume `trace` y `turn`, muestra estado actual y conserva un orden estable.
- Servicios separados para auth, API/stream, modelos y store reactivo; el token vive en memoria.

Los diez casos de uso base son: paradoja de Fermi y ápeiron; entrelazamiento y monismo; problema de tres cuerpos; validez de modus ponens/falacia; ápeiron y energía oscura; devenir y flecha del tiempo; unidad de opuestos y dualidad onda-partícula; mundos innumerables y multiverso; literatura reciente de exoplanetas habitables; azar e indeterminismo cuántico. Se mantienen como datos tipados y prompts editables, no como ramas de lógica en la API.

Markdown/LaTeX se renderiza con librería mantenida, sanitización HTML habilitada y política que impide HTML no confiable y enlaces/scripts ejecutables. Streaming y vista final deben soportar errores, carga, cancelación, ausencia de respuesta, timeout y selección de caso.

## Consecuencias

SSE simplifica el flujo unidireccional de generación y se integra con autenticación Bearer y POST. WebSocket se reserva para una necesidad real de mensajes bidireccionales. El contrato de eventos debe mantenerse compatible entre FastAPI y TypeScript; cambios incompatibles requieren versión o transición.

## Estado actual y brechas

El API implementa REST/SSE y el cliente tiene modelos, servicios base, casos y store scaffold. `apps/web` aún no contiene `package.json`, componentes Angular ni build completo. El desarrollo debe convertirlo en aplicación Angular funcional y probar framing fragmentado, cancelación, seguridad de renderizado y estados de error.