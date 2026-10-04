# ADR-002: Runtime y stack tecnológico

**Estado:** Aceptada como baseline de arquitectura  
**Fecha:** 2026-10-03

## Contexto

El objetivo solicitado es Python 3.14.0 con FastAPI asíncrono, LangChain, LangGraph, LangSmith, HTTPX y una memoria vectorial. Los proveedores de LLM, Chroma y extensiones criptográficas pueden tardar en publicar wheels compatibles con una versión nueva de Python.

## Alternativas

1. Fijar Python 3.14 inmediatamente y aceptar dependencias aún no verificadas.
2. Mantener indefinidamente una versión anterior como objetivo.
3. Definir Python 3.14 como runtime de producción objetivo y mantener un piso temporal explícito hasta verificar compatibilidad de toda la cadena.

## Decisión

Python **3.14.0 es la versión objetivo** de producción. Durante la transición, los paquetes conservan `requires-python >=3.12`; la imagen por defecto puede usar 3.13 solo mientras 3.14 no pase los gates requeridos. Python 3.14 no se considerará soportado ni se promoverá por un job informativo: debe pasar instalación limpia, lint, tipos, tests y build de imagen. Al promoverlo, CI debe ejecutar la versión objetivo como gate bloqueante y actualizar el argumento por defecto de Docker; el piso mínimo solo se elevará en un ADR separado si se decide retirar 3.12/3.13.

El backend usa:

- FastAPI + Uvicorn para presentación HTTP y streaming asíncrono.
- LangGraph para estado y flujo cíclico; LangChain/adaptadores LangChain para modelos y definición/adaptación de tools.
- `httpx.AsyncClient` y cliente MCP oficial asíncrono para dependencias externas.
- ChromaDB como primer adaptador vectorial desplegable; el puerto permite una implementación futura con pgvector.
- Pydantic Settings para configuración validada por entorno, PyJWT y bcrypt para autenticación inicial, Tenacity para reintentos.
- pytest + pytest-asyncio, Ruff e import-linter; mypy estricto como gate.

Las operaciones de I/O son asíncronas de extremo a extremo. Código síncrono inevitable (por ejemplo, el cliente Chroma) se aísla fuera del event loop mediante thread offload. Se usan anotaciones explícitas, `asyncio.timeout` y APIs estándar compatibles con el piso declarado; no se usa sintaxis exclusiva de Python 3.14 mientras siga vigente el piso 3.12.

Angular será el cliente web standalone con versión estable fijada en `package-lock.json`; Node se fija a una versión LTS compatible con esa versión de Angular. Versiones de runtime e imágenes no se usarán con tags flotantes en producción.

## Consecuencias

Se conserva compatibilidad transitoria con el entorno actual y se evita declarar compatibilidad con 3.14 sin evidencia. La matriz debe distinguir el piso soportado y el runtime objetivo; los jobs requeridos no usan `continue-on-error`. Las dependencias nativas pueden retrasar el cambio de imagen, no el objetivo arquitectónico.

## Estado actual y brechas

Los paquetes declaran `>=3.12`; Docker usa 3.13 y permite cambiar a 3.14 manualmente. El repositorio aún no tiene un workflow visible que certifique 3.14. Antes de promoverlo deben pasar los gates anteriores en CI y estar disponibles las dependencias fijadas.
