# ADR-003: Topología LangGraph, supervisor y agentes ReAct

**Estado:** COMPLETO  
**Fecha:** 2026-10-03

## Contexto

Ápeiron debe enrutar una consulta a un especialista o coordinar un debate de varios turnos, producir una síntesis y emitir estados legibles por la interfaz. Los agentes deben razonar con herramientas sin filtrar detalles del proveedor ni revelar razonamiento privado.

## Alternativas

1. Un grafo por agente/modo, duplicando enrutamiento, límites y trazas.
2. Un grafo único con rutas y nodos reutilizables.
3. Conversación libre entre agentes sin límite de rondas ni de herramientas.

## Decisión

Se adopta un único grafo LangGraph con `ApeironState` tipado y dos modos explícitos:

- `single`: el supervisor enruta por defecto a Anaximandro; enrutamiento por intención puede seleccionar solo agentes registrados y habilitados. El agente responde y se finaliza.
- `debate`: fan-out paralelo con `Send` a la lista de participantes autorizada; cada ronda recibe la pregunta y turnos previos, el `round_gate` incrementa la ronda y detiene el ciclo al alcanzar `max_rounds`; síntesis contrasta acuerdos y desacuerdos.

El grafo objetivo contiene supervisor/routing, turno de especialista, ejecución de tools dentro del ciclo ReAct del especialista, compuerta de ronda, síntesis y fin. Los especialistas siguen `Thought -> Action -> Observation -> Reflect` hasta una respuesta final o un máximo de pasos. El razonamiento interno no se envía al cliente ni se registra en logs por defecto. La traza pública comunica transiciones y nombres de tools, no pensamientos ni entradas sensibles de herramientas.

`max_rounds` acepta valores de 1 a 4; el valor por defecto es configurable (2 inicialmente). El máximo de pasos ReAct, timeout por nodo y timeout por tool también son configuración validada y tienen cotas duras. El API valida el modo y los límites antes de invocar el grafo. Un fallo/timeout de un especialista produce un resultado degradado identificado; no debe bloquear indefinidamente el resto de participantes. Si falla la síntesis, se aplica la estrategia definida por la facade (respuesta de degradación determinista a partir de turnos completados, sin inventar evidencia).

El estado mínimo transporta pregunta, modo, participantes, ronda, límite, turnos, traza y respuesta. Identidad de usuario, trace ID y metadatos de ejecución viajan como contexto de ejecución; no se confía en IDs suministrados por el cliente para autorización. Actualizaciones concurrentes de turnos/trazas usan reducers deterministas y preservan asociación agente-ronda. El grafo no guarda memoria conversacional implícita entre invocaciones: la memoria se consulta y actualiza mediante su puerto con scope autenticado.

El registro/fábricas permiten añadir Sócrates, Anaxágoras u otros agentes sin ramificar el supervisor. La selección de participantes es explícita y auditable: modo debate usa el conjunto configurado de participantes, no todo agente que accidentalmente aparezca en el registro.

## Consecuencias

Un grafo común simplifica control de coste, errores, callbacks y visualización de estado. Fan-out aumenta latencia/coste con el número de participantes y rondas; por eso se limitan ambos. La síntesis debe distinguir evidencia recuperada, inferencia y analogía filosófica. La publicación de eventos a Kafka queda fuera de alcance; podría añadirse como adaptador de salida sin acoplar el dominio.

## Estado actual y brechas

El grafo único implementa `single`/`debate`, fan-out, reducers, selección configurada de 1–4 participantes, rondas 1–4 y routing determinista por intención entre agentes habilitados (Anaximandro por defecto). Settings valida rondas por defecto, hasta 8 pasos ReAct, timeouts de nodo/herramienta y participantes. Un fallo o timeout de especialista genera un turno marcado `degraded` sin interrumpir el debate; si falla la síntesis, el fallback determinista solo expone turnos completados. El protocolo ReAct textual ejecuta exclusivamente nombres presentes en el conjunto permitido, no devuelve razonamiento sin una respuesta final válida y emite trazas públicas sin pensamientos ni argumentos de herramientas. Estas políticas están cubiertas por pruebas del núcleo y de API.
