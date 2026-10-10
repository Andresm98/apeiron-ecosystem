# ADR-012: Endurecimiento de la plataforma cloud

**Estado:** PROPUESTO. Amplía ADR-008 (no lo reemplaza) y cierra las brechas operativas que ADR-008, ADR-010 y la deuda de `AGENTS.md` §11 dejaron abiertas.  
**Fecha:** 2026-10-10

## Contexto

La arquitectura de la aplicación está madura: hexagonal con contratos verificados, resiliencia por diseño, seguridad por capas (JWKS, RLS, guardrails, SSRF en A2A) y observabilidad correlacionada. La plataforma que la ejecuta no está al mismo nivel. Es un MVP bien hecho, no un despliegue de producción.

Situación real, contrastada con el código y con `docs/DEPLOY.md`:

| Área | Hoy | Problema |
|---|---|---|
| Infraestructura | EC2, security group, DNS y Elastic IP creados a mano en la consola | No es reproducible ni revisable; no hay entornos (staging/prod) ni recuperación ante la pérdida de la instancia |
| Entrega | `deploy-ec2.yml` entra por SSH con `AWS_SSH_PRIVATE_KEY` y el puerto 22 abierto a los rangos de GitHub | Clave de larga duración, superficie SSH expuesta. ADR-008 decía "no requiere SSH entrante" y la implementación lo contradice |
| Secretos | `.env` editado a mano en `/opt/apeiron-ecosystem` (permisos 600) | Sin rotación, sin auditoría, sin cifrado gestionado; un acceso a la VM los expone todos. ADR-008 prometía un gestor de secretos |
| TLS | Nginx publica `80:80`; TLS "en un balanceador o proxy" queda como tarea pendiente | El JWT de Supabase y el SSE viajan en claro si no se añade a mano; la Agent Card A2A exige `https` |
| Datos | Volúmenes `chroma-data` y `api-data` en el disco de la VM | Sin backups automáticos ni restauración probada |
| Escala | `SlidingWindowLimiter`, `A2ATaskStore` y `RuntimeMetrics` en memoria del proceso | Con más de una réplica, el rate limit se multiplica, las tareas A2A no se encuentran y el observatorio muestra una sola instancia |
| CI | `ci.yml` hace `npm ci` + build, pero no `npm test` | Las reglas de capas del frontend (`architecture.spec.ts`) no bloquean un PR |
| Imágenes | Paquetes GHCR públicos para que la VM haga pull anónimo | Cualquiera puede descargar la imagen de la API con su código |

## Alternativas

1. **Mantener el despliegue actual** y documentar los pasos manuales. Coste cero, pero la brecha con un sistema de producción queda permanente.
2. **Migrar directamente a ECS Fargate o EKS** con ALB, autoescalado y servicios gestionados. Resuelve todo a la vez, pero exige antes el estado compartido (alternativa 3, fase 3) y multiplica el coste fijo para un sistema sin tráfico real todavía.
3. **Endurecer por fases sobre la topología actual** (adoptada): infraestructura como código, entrega sin SSH, secretos gestionados y TLS primero; estado compartido y réplicas después, solo cuando haga falta escalar.

Para la infraestructura como código se evaluaron **Terraform** (declarativo, multi-proveedor, estado remoto en S3) y **AWS CDK** (TypeScript/Python, solo AWS). Se elige Terraform porque Supabase, GitHub y el DNS pueden gestionarse con el mismo flujo, y porque `plan` en un PR da una revisión legible del cambio.

## Decisión

Se adopta la alternativa 3 en cuatro fases. Cada fase se puede desplegar sola y no cambia el contrato público (REST, SSE, A2A).

### Fase 1: infraestructura como código

- Directorio nuevo `infra/terraform/` con módulos `network` (VPC, subredes públicas y privadas), `compute` (EC2 en subred privada, perfil de instancia IAM), `edge` (ALB + certificado ACM + Route 53) y `storage` (bucket S3 de backups con versionado y cifrado).
- Estado remoto en S3 con bloqueo, entornos `staging` y `prod` como workspaces o directorios separados.
- `terraform fmt`, `validate` y `plan` en CI para cada PR que toque `infra/terraform/`. El `apply` de `prod` requiere aprobación manual (environment protegido de GitHub).

### Fase 2: entrega, secretos y TLS

- **Sin SSH ni claves de larga duración.** GitHub Actions asume un rol IAM por **OIDC** (`aws-actions/configure-aws-credentials`) y despliega con **SSM Run Command** sobre la instancia. Se elimina `AWS_SSH_PRIVATE_KEY` y se cierra el puerto 22.
- **Secretos en SSM Parameter Store** (`SecureString`, KMS), bajo `/apeiron/<entorno>/`. `deploy-ec2.sh` genera el `.env` en el arranque a partir de los parámetros que el rol de la instancia puede leer; `.env.example` sigue siendo la plantilla y la lista de nombres. La validación previa con `Settings` dentro de la imagen nueva se mantiene.
- **TLS en el ALB** con ACM y redirección 80 → 443. Nginx deja de publicar `80:80` al exterior; solo el ALB llega a la instancia. Se mantiene `proxy_buffering off` y se ajusta el `idle_timeout` del ALB a 300 s para el SSE.
- **CSP y cabeceras de seguridad** en Nginx (pendiente de ADR-010), ahora que hay TLS.
- **GHCR privado** con un token de solo lectura en Parameter Store, o migración a ECR con pull por rol IAM.

### Fase 3: datos y estado compartido

- **Backups**: snapshot diario de los volúmenes `chroma-data` y `api-data` a S3 (AWS Backup o un `cron` con retención), y un procedimiento de restauración **probado** y documentado en `docs/DEPLOY.md`.
- **Estado compartido detrás de puertos**: `RateLimiterPort`, `TaskStorePort` y `MetricsPort` en `application/ports/outbound/`, con los adaptadores en memoria actuales como implementación por defecto y un adaptador Redis (ElastiCache) en `infra/`. Se elige en `container.py` con `APEIRON_STATE_BACKEND=memory|redis`. El núcleo sigue sin proveedores.

### Fase 4: réplicas (solo cuando haya demanda)

- Con la fase 3 hecha, la API ya no tiene estado local salvo SQLite del modo `local`, que no se usa en producción (Supabase). Se puede pasar a un Auto Scaling Group detrás del ALB o a ECS Fargate sin tocar el código. Chroma se mantiene como servicio único con su volumen, o se evalúa pgvector en Supabase (descartado por ADR-010 para la fase actual).

### Transversal: CI

- Añadir `npm test` al job `frontend-check` de `ci.yml`. Es un cambio de una línea y se hace antes de la fase 1.

## Consecuencias

- La plataforma pasa a ser reproducible: perder la instancia es un `terraform apply` y una restauración de backup, no una reconstrucción manual.
- Desaparecen las credenciales de larga duración en GitHub y en la VM. Los secretos se rotan y auditan en un solo sitio (CloudTrail).
- El coste fijo sube: ALB (~16-20 USD/mes), NAT o endpoints VPC para la subred privada, y ElastiCache en la fase 3. Por eso la fase 4 solo se activa con demanda real.
- Aumenta la superficie que mantener: módulos Terraform, roles IAM y políticas. Se compensa con `plan` revisable en cada PR.
- Desarrollo local no cambia: Docker Compose, `.env` local, `FakeLLM` y backends en memoria siguen siendo el camino por defecto.

## Estado actual y brechas

Nada de este ADR está implementado. Orden recomendado y criterio de terminado de cada fase:

| Fase | Terminado cuando |
|---|---|
| CI | `npm test` corre en `ci.yml` y falla el PR si falla un spec |
| 1 | `terraform plan` sin cambios contra la infraestructura existente (importada) y CI ejecuta `plan` |
| 2 | `AWS_SSH_PRIVATE_KEY` borrado, puerto 22 cerrado, `.env` generado desde Parameter Store, `https://` con certificado válido y la Agent Card anunciando `https` |
| 3 | Restauración de `chroma-data` y `api-data` probada desde S3; tests de los adaptadores Redis con un double; `/v1/system` muestra el backend de estado |
| 4 | Dos réplicas detrás del ALB pasan `smoke_e2e.py` y el rate limit se aplica de forma global |
