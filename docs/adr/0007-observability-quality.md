# ADR-007: Observabilidad, pruebas y gates de calidad

**Estado:** Aceptada como baseline de arquitectura  
**Fecha:** 2026-10-03

## Contexto

La ejecución de agentes es distribuida entre nodos, modelos y herramientas; sin trazas correlacionadas es difícil distinguir latencia, coste, fallo de proveedor y degradación de calidad. Las entradas pueden contener datos privados y razonamiento interno.

## Decisión

Se adopta logging estructurado JSON en stdout con los campos `trace_id`, `agent_name`, `state_transition`, `execution_time_ms` y `token_usage`, además de dependencia, estado y clase de error cuando correspondan. `token_usage` siempre tiene una forma normalizada; su valor es nulo si el proveedor no lo informa, nunca se inventa. El middleware crea el trace ID por request o valida uno entrante según política; el mismo ID acompaña logs, errores API y eventos de error SSE. No se registran contraseñas, JWT, prompts completos, respuestas de herramientas ni razonamiento privado por defecto. Se permite habilitar captura de contenido solo en entornos controlados con redacción y consentimiento/política explícitos.

LangSmith se integra desde infraestructura mediante variables de entorno/configuración y callbacks/contexto por ejecución, propagando trace ID, agente, tags de modo y metadatos no sensibles. Está desactivado por defecto hasta configurar credenciales; la ausencia de LangSmith no puede impedir una consulta. La retención y región del servicio se configuran conforme a la política de datos. Nunca se envían secretos ni información personal como metadatos.

La verificación obligatoria incluye:

- Unit tests de routing, factories, reducers, ReAct/validación de tools, autenticación, retry/breaker y aislamiento de memoria.
- Tests async de integración del grafo con LLM/tool doubles: `single`, `debate`, máximo de rondas, timeout/fallos y síntesis.
- Tests API con FastAPI TestClient/HTTPX: bearer válido/inválido, esquemas, SSE (tipos, orden, errores y cancelación) y no filtración de excepciones.
- Tests Angular de servicios/event parser/store/componentes y build de producción; test de sanitización de Markdown/LaTeX.
- Lint Ruff, mypy estricto, `lint-imports`, tests y build de imagen en CI.

Los tests no requieren keys externas: usan FakeLLM, servidores simulados y almacenamiento in-memory. Tests opcionales de proveedor real se separan de gates deterministas. Casos de evaluación del agente comprueban uso apropiado de tools, fuentes/citas, fidelidad de síntesis, límites de seguridad y ausencia de afirmaciones de certeza indebidas; las métricas de evaluación no sustituyen tests deterministas.

## Consecuencias

El formato común permite correlación local y remota y mantiene trazabilidad sin registrar chain-of-thought. LangSmith aporta depuración/evaluación, con coste y obligaciones de datos que deben gobernarse. Los doubles hacen CI repetible, aunque no sustituyen pruebas controladas de integración con proveedores.

## Estado actual y brechas

Existe configuración JSON básica con algunos campos, y configuración opcional de LangSmith. `token_usage` no está garantizado por todos los proveedores. Hay tests Python básicos; no se encontró workflow `.github/workflows/ci.yml` ni suite web ejecutable. Deben completarse propagación contextual, redacción, suites y gates bloqueantes.