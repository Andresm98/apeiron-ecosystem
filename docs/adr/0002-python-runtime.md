# ADR-002: Runtime y stack tecnológico

**Estado:** COMPLETO  
**Fecha:** 2026-10-03

## Contexto

El objetivo solicitado es Python 3.14.0 con FastAPI asíncrono, LangChain, LangGraph, LangSmith, HTTPX y una memoria vectorial. Los proveedores de LLM, Chroma y extensiones criptográficas pueden tardar en publicar wheels compatibles con una versión nueva de Python.

## Alternativas

1. Fijar Python 3.14 inmediatamente y aceptar dependencias aún no verificadas.
2. Mantener indefinidamente una versión anterior como objetivo.
3. Promover Python 3.14 a runtime de producción y conservar explícitamente el piso de compatibilidad de las librerías.

## Decisión

Python **3.14.0 es el runtime de producción**. Los paquetes mantienen `requires-python >=3.12`; CI ejecuta gates bloqueantes en 3.12, 3.13 y 3.14, y la imagen API usa Python 3.14 por defecto. La matriz completa debe pasar instalación limpia, lint, tipos, tests y build de imagen. El piso mínimo solo se elevará en un ADR separado si se decide retirar 3.12/3.13.

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

Python 3.14 queda cubierto por el mismo gate que los runtimes 3.12 y 3.13; ningún job de versión usa `continue-on-error`. La compatibilidad de dependencias nativas se comprueba en CI y en el build de imagen antes de desplegar.

## Estado actual y brechas

Los paquetes declaran `>=3.12`; CI ejecuta instalación, Ruff, mypy y tests en Python 3.12, 3.13 y 3.14, y la imagen/despliegue usan Python 3.14. En esta revisión, los 34 tests backend pasaron en Python 3.14. La advertencia de LangChain sobre Pydantic v1 en Python 3.14 sigue siendo no bloqueante y debe revisarse al actualizar esa dependencia. Python 3.13 está instalado localmente, pero su entorno no tiene pytest; Python 3.12 no está instalado. La matriz reproducible queda a cargo del gate de CI.
