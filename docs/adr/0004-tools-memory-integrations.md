# ADR-004: Tools, MCP y memoria de conocimiento

**Estado:** Aceptada como baseline de arquitectura  
**Fecha:** 2026-10-03

## Contexto

Anaximandro requiere verificación lógica, consulta de información científica actual y recuperación de contexto filosófico-científico. La plataforma debe poder cambiar proveedores y limitar el impacto de una tool no disponible o malformada.

## Alternativas

1. Incrustar llamadas externas en prompts/agentes.
2. Exponer adaptadores tipados como tools registradas mediante un puerto.
3. Ejecutar código generado por el modelo para cada necesidad.

## Decisión

Se adopta la alternativa 2. `application` define los puertos de salida `ToolPort` y `VectorStorePort`; `infra` contiene sus adaptadores y el composition root solo inyecta tools autorizadas por cada `AgentFactory`. El modelo nunca puede crear herramientas, elegir hosts arbitrarios ni ejecutar código o shell.

Las tres tools iniciales son:

- `formal_logic_calculator`: parser de gramática acotada, evaluación de conectivos y tablas de verdad/validez de argumentos. No usa `eval`. El límite inicial es ocho variables proposicionales; álgebra simbólica y cálculo científico son extensiones separadas, no capacidades implícitas.
- `mcp_public_api_tool`: adaptador MCP asíncrono y/o clientes HTTPX de APIs públicas permitidas. Cada servidor MCP y host HTTP se configura en el servidor; no se acepta URL arbitraria del modelo/usuario. La integración API actual de ejemplo consulta arXiv.
- `vector_memory_retriever`: recuperación con filtros de tenant/sesión y corpus global controlado.

ChromaDB es el primer proveedor de vector store en despliegue; `VectorStorePort` permite evaluar pgvector cuando convenga compartir la infraestructura de datos. La recuperación de producción es híbrida desde la primera entrega: obtener candidatos por similitud semántica y por coincidencia léxica (BM25 o equivalente), deduplicarlos y fusionar/rerankear con una política determinista y configurable. El resultado devuelve fragmentos con metadatos de fuente para que la respuesta pueda atribuirlos. El adaptador no debe afirmar que una recuperación lexical actual ya es RAG vectorial: el modo in-memory actual es un double léxico para desarrollo/tests.

El corpus global (textos de presocráticos y fuentes científicas curadas) se separa de memoria privada. Todo documento privado se asocia a `user_id` y, cuando aplique, `session_id`; cada búsqueda filtra en el servidor por usuario actual más corpus global. Prohibido confiar en filtros de tenant enviados por el cliente. Se exige test de aislamiento entre usuarios, límites de tamaño/retención configurables y un mecanismo operativo de borrado de memoria del usuario antes de producción.

Cada ejecución de tool aplica timeout, límites de entrada/salida, parseo/validación, sanitización de errores y política de retry solo para fallos transitorios e idempotentes. Respuestas externas se consideran datos no confiables e instrucciones dentro de ellas no modifican el system prompt. Se registra nombre, duración, resultado/error clasificado y trace ID; no se registran secretos ni contenido privado por defecto.

## Consecuencias

El catálogo es auditable y cada agente recibe solo la mínima capacidad necesaria. MCP añade interoperabilidad pero también una frontera de confianza y disponibilidad; sus servidores deben declararse explícitamente y monitorizarse. Chroma facilita la primera entrega, mientras que el puerto reduce el coste de migración. El híbrido requiere evaluación de relevancia y fuentes, no solo conectividad con una base vectorial.

## Estado actual y brechas

Existen parser lógico seguro, cliente arXiv, gateway MCP opcional, tool de memoria y adaptador Chroma. El store in-memory es léxico, la memoria de usuario depende de identidad autenticada y faltan especificación de retención/borrado, reranking híbrido y pruebas completas de aislamiento.