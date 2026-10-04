# ADR-005: Autenticación, autorización y resiliencia

**Estado:** COMPLETADO  
**Fecha:** 2026-10-03

## Contexto

El API expone registro, emisión de token, chat y streaming; además invoca LLMs, MCP, APIs públicas y memoria. Un fallo externo no debe bloquear el servicio ni permitir acceso cruzado al contexto de usuarios.

## Decisión

Se adopta OAuth2 Password Bearer para el endpoint de token y JWT firmado para autenticar las llamadas de API. El token incluye sujeto y expiración; la duración inicial configurable es 60 minutos. La clave de firma se obtiene de un secret manager/variable de entorno, nunca de valores por defecto en producción, y la rotación debe contemplar versión de clave o periodo de solapamiento. HTTPS es obligatorio fuera de desarrollo. La dependencia de autenticación valida token en cada ruta protegida y establece identidad confiable en el contexto de request.

Las contraseñas se almacenan únicamente con bcrypt (o algoritmo adaptativo aprobado posteriormente), nunca en claro. Límites de credenciales y respuestas de error no revelan si una contraseña o usuario concreto existe. El registro público debe poder deshabilitarse o protegerse por política de despliegue. Para producción, usuarios y datos de autorización usan repositorio persistente; repositorios in-memory son solo para pruebas/desarrollo. Se aplican límites de tasa a autenticación y generación de chat.

El cliente web mantiene el access token solo en memoria; no lo persiste en `localStorage`. CORS permite únicamente orígenes configurados. SSE usa `Authorization: Bearer` en la petición POST. Si se añade WebSocket, la autenticación debe evitar tokens en query strings y especificar un mecanismo de cabecera/subprotocolo seguro antes de habilitarlo.

La resiliencia sigue estas reglas:

- Timeout configurable y separado para request/nodo, llamada LLM, tool HTTP/MCP y persistencia. Un timeout global limita el trabajo total de una consulta.
- Reintento asíncrono con backoff exponencial y jitter en errores transitorios; máximo de intentos configurable. No reintentar errores de validación ni operaciones no idempotentes sin clave de idempotencia.
- Fallback de LLM solo si se configura un proveedor/modelo alternativo compatible. La respuesta degradada debe señalar indisponibilidad y no presentar una salida parcial como respuesta verificada.
- Circuit breaker independiente por dependencia, con estados closed/open/half-open, ventana/umbral de fallos, recuperación y una sola prueba concurrente half-open. El estado debe ser seguro ante concurrencia dentro del proceso; la coordinación distribuida queda fuera mientras haya una sola réplica o se acepta explícitamente que cada réplica tenga circuito local.
- Errores a clientes son estables y no filtran stack traces, prompts, secretos ni contenido de dependencias. Trace ID permite correlación interna.

## Consecuencias

El diseño reduce abuso y limita fallos en cascada, pero JWT por sí mismo no proporciona revocación inmediata; usar expiraciones cortas y no almacenar tokens en el navegador reduce la ventana. Los límites de tasa y persistencia de identidad requieren decisiones operativas por entorno. Reintentos, timeout y breaker deben coordinarse para que sus presupuestos no excedan el timeout total.

## Estado actual y brechas

Todas las capacidades decididas están implementadas y verificadas: OAuth2 password + JWT (sub/exp, TTL 60 min, rotación con `previous_secret`), bcrypt, CORS configurado, token web solo en memoria, secret de desarrollo rechazado en `prod`, repositorio persistente SQLite (`SqliteUserRepository`), rate limiting deslizante en auth/chat (`enforce_auth_rate`/`enforce_chat_rate`), configuración para deshabilitar o restringir el registro público (`public_register`), retries con backoff exponencial y jitter (`wait_exponential_jitter`), circuit breaker por dependencia con prueba única concurrente en `half-open` (`asyncio.Lock`), fallback LLM y ocultación de errores internos.