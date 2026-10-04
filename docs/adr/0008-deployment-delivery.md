GitHub Actions se divide en `.github/workflows/ci.yml` y `.github/workflows/deploy-ec2.yml`. CI ejecuta Ruff, mypy estricto, import-linter, pytest/pytest-asyncio en Python 3.12/3.13/3.14 e instalación/build Angular. Solo un push a `main`, después de todos los checks, publica imágenes API/web con tags únicos e inmutables en ECR. CD escucha el éxito de CI, resuelve la IPv4 por `DescribeInstances` y despliega por SSH. Los únicos secrets requeridos son `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y `AWS_SSH_PRIVATE_KEY`; el token ECR es temporal y cruza por stdin dentro de SSH.
Hay Dockerfiles multistage, Compose con referencias GHCR configurables, API/Chroma y perfil web, Nginx, healthcheck de API y una app Angular instalable. `EC2_HOST` es una variable no secreta; el usuario `ec2-user` y Chroma `chromadb/chroma:1.5.9` están fijados en el workflow CD. Los paquetes GHCR empiezan privados: el primer CD puede requerir rerun tras hacerlos públicos. Las imágenes públicas incluyen código Python de la API. El pipeline solo requiere el secret `AWS_SSH_PRIVATE_KEY`; antes de producción pública siguen pendientes persistencia de usuarios, TLS/firewall y backups de Chroma.
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

Compose levanta API, Nginx/web y ChromaDB con volumen persistente. El vector store no se expone públicamente; servicios se comunican en red privada. API tiene healthcheck, política de restart y configuración desde entorno/secret store. Secretos no se versionan en `.env`; para producción se inyectan desde el gestor de secretos de la plataforma. Datos Chroma se respaldan y se prueba restauración. TLS termina en un balanceador/proxy administrado; el workflow no requiere SSH entrante a EC2.

La guía VM/EC2 debe cubrir: preparar Docker/Compose, DNS y firewall; crear secretos; configurar variables de entorno; obtener/build de imágenes; arrancar servicios; aplicar migraciones/semillas necesarias; verificar healthcheck, auth, streaming y memoria; configurar TLS; respaldar/restaurar el volumen y actualizar con rollback. `docker compose up --build` se reserva para desarrollo; producción despliega tags inmutables y hace backup antes de actualización.

GitHub Actions se divide en `.github/workflows/ci.yml` y `.github/workflows/deploy-ec2.yml`. CI ejecuta Ruff, mypy estricto, import-linter y pytest/pytest-asyncio en Python 3.12, 3.13 y 3.14, además del build Angular. Solo un push exitoso a `main` publica imágenes API/web en GHCR usando el `GITHUB_TOKEN` integrado. CD escucha la conclusión exitosa de CI y despliega por SSH a `EC2_HOST`. El único secret es `AWS_SSH_PRIVATE_KEY`; las imágenes deben publicarse como paquetes GHCR públicos para permitir pulls anónimos desde EC2.

## Consecuencias

Compose minimiza la carga operativa y se ajusta a un backend desplegable, pero no proporciona por sí solo alta disponibilidad, escalado horizontal, rotación de secretos ni backups administrados. Esas capacidades requieren servicio gestionado o una decisión futura de plataforma. Separar web/API/Chroma permite reinicio y actualización independientes.

## Estado actual y brechas

Hay Dockerfiles multistage, Compose con referencias GHCR configurables, API/Chroma y perfil web, Nginx, healthcheck de API y una app Angular instalable. `EC2_HOST` es una variable no secreta; el usuario `ec2-user` y Chroma `chromadb/chroma:1.5.9` están fijados en el workflow CD. El pipeline no usa AWS API keys, ECR, OIDC o SSM. Antes de producción pública siguen pendientes persistencia de usuarios, TLS/firewall y pruebas operativas de backup/restauración.