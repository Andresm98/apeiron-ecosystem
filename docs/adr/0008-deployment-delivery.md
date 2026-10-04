# ADR-008: Contenedores, despliegue y CI/CD

**Estado:** Aceptada como baseline de arquitectura  
**Fecha:** 2026-10-03

## Contexto

La primera instalación debe poder levantarse en una VM/EC2 con backend, frontend y vector store, con artefactos reproducibles y sin ejecutar procesos como root. La plataforma no requiere Kubernetes para validar su primera arquitectura.

## Alternativas

1. Despliegue manual de procesos y dependencias en una máquina.
2. Contenedores Docker multistage con Compose para el despliegue inicial.
3. Plataforma de orquestación de contenedores desde el primer release.

## Decisión

Se adopta la alternativa 2 para VM/EC2. `deploy/docker/api.Dockerfile` construye dependencias en una etapa builder y copia solo runtime/dependencias a una imagen Python slim; ejecuta con usuario no-root y healthcheck. `deploy/docker/web.Dockerfile` compila Angular en Node LTS y sirve artefactos estáticos con Nginx. Imágenes y dependencias de producción se fijan a versiones/digests revisados; no se usa `latest` en releases.

Compose levanta API, Nginx/web y ChromaDB con volumen persistente. El vector store no se expone públicamente; servicios se comunican en red privada. API tiene healthcheck, política de restart y configuración desde entorno/secret store. Secretos no se versionan en `.env`; para producción se inyectan desde el gestor de secretos de la plataforma. Datos Chroma se respaldan y se prueba restauración. TLS termina en Nginx o balanceador/proxy administrado; se limitan puertos expuestos a HTTP/HTTPS y acceso administrativo SSH restringido.

La guía VM/EC2 debe cubrir: preparar Docker/Compose, DNS y firewall; crear secretos; configurar variables de entorno; obtener/build de imágenes; arrancar servicios; aplicar migraciones/semillas necesarias; verificar healthcheck, auth, streaming y memoria; configurar TLS; respaldar/restaurar el volumen y actualizar con rollback. `docker compose up --build` se reserva para desarrollo; producción despliega tags inmutables y hace backup antes de actualización.

GitHub Actions en `.github/workflows/ci.yml` ejecuta en PR y push: Ruff, mypy estricto, import-linter, pytest/pytest-asyncio; instalación reproducible/build Angular y sus tests; build de Docker API/web. Los jobs de runtime objetivo son bloqueantes antes de promoción. Publicar/implementar imágenes solo ocurre en ramas/tags protegidos con credenciales de entorno, y no es necesario para el primer CI de validación.

## Consecuencias

Compose minimiza la carga operativa y se ajusta a un backend desplegable, pero no proporciona por sí solo alta disponibilidad, escalado horizontal, rotación de secretos ni backups administrados. Esas capacidades requieren servicio gestionado o una decisión futura de plataforma. Separar web/API/Chroma permite reinicio y actualización independientes.

## Estado actual y brechas

Hay Dockerfiles multistage, Compose con API/Chroma y perfil web, Nginx y healthcheck de API. El compose todavía usa una etiqueta Chroma flotante y `.env`; el build del frontend requiere que exista una app Angular. No se encontró workflow CI. La guía de despliegue debe incorporar TLS, backups, firewall, gestión de secretos, pinning y recuperación antes de producción.