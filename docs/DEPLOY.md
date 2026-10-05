# Despliegue CI/CD en AWS EC2

El pipeline está dividido en `.github/workflows/ci.yml` y `.github/workflows/deploy-ec2.yml`. CI valida y publica imágenes versionadas en GHCR con el `GITHUB_TOKEN` automático. CD se ejecuta solo después de un CI exitoso en `main` y actualiza Compose por SSH a un host fijo. No usa AWS API, ECR, SSM ni credenciales AWS.

## Preparar EC2

Usa AMI Amazon Linux y usuario `ec2-user`. Asigna a EC2 una Elastic IP o DNS estable; CD no consulta la región ni el Instance ID. La instancia debe tener IPv4 pública y 2 vCPU/4 GB RAM.

1. Instala Docker Engine y Docker Compose v2. Asegura que `ec2-user` puede ejecutar `sudo -n docker` sin prompt de contraseña.
2. **El `.env` de producción se edita en la VM** (`sudo nano /opt/apeiron-ecosystem/.env`). El primer despliegue lo crea desde `.env.example`; después CD **nunca lo sobrescribe** (ver [Variables de entorno](#variables-de-entorno-env)).
3. Supabase (identidad, sesiones e historial; ADR-010): define `APEIRON_SUPABASE_URL` y `APEIRON_SUPABASE_PUBLISHABLE_KEY` en el `.env` de la VM. Aplica el esquema con migraciones de la CLI (`npx supabase link` + `npx supabase db push`; ver [supabase/README.md](../supabase/README.md)), nunca con SQL a mano. En *Authentication → URL Configuration*, pon como **Site URL** el dominio público (para los enlaces de confirmación) y mantén activada la confirmación de correo. No hace falta la `service_role` key.
4. Mantén los volúmenes Docker `chroma-data` (memoria vectorial) y `api-data` (usuarios SQLite); define backup y restauración de ambos antes de guardar datos de usuarios.
5. Security group: permite 80/443 según TLS y SSH 22 desde rangos de GitHub-hosted runners. No abras 22 a `0.0.0.0/0`. El API se publica solo en `127.0.0.1:8000`; Chroma no publica puertos.

## Configuración de GitHub

En **Settings → Secrets and variables → Actions → Repository secrets**, crea el secret de despliegue:

- `AWS_SSH_PRIVATE_KEY`: clave privada de `ec2-user`, con sus saltos de línea.

En **Settings → Secrets and variables → Actions → Repository variables**, define `EC2_HOST` con la Elastic IP o DNS de la instancia. No es un secret.

### Variables de entorno (`.env`)

En GitHub solo hay `AWS_SSH_PRIVATE_KEY` (secret) y `EC2_HOST` (variable). La configuración de la app vive en **`/opt/apeiron-ecosystem/.env` de la VM** y se edita allí:

- En cada despliegue, CD envía `.env.example` del commit como template a `/opt/apeiron-ecosystem/.env.example`.
- **Si `.env` no existe** (primer despliegue), se crea copiando el template (permisos `600`, saltos de línea LF). Después edítalo en la VM para poner las claves reales.
- **Si `.env` existe, no se toca nunca**: tus ediciones sobreviven a todos los despliegues.
- Para volver a sincronizar con el template: `sudo rm /opt/apeiron-ecosystem/.env` y vuelve a desplegar (o compáralo a mano con `.env.example`, que está al lado).
- **Validación antes de cambiar nada:** tras descargar las imágenes, el script ejecuta la clase `Settings` de la propia API, dentro de la imagen nueva, contra el `.env` de la VM. Si la configuración es inválida (por ejemplo, Supabase sin URL), el despliegue se detiene **sin tocar los contenedores en marcha** y el log indica qué falta, sin mostrar valores. Si falta la API key del LLM, solo avisa, porque la API arranca igual.
- Tras editar `.env` en la VM, aplica los cambios con `cd /opt/apeiron-ecosystem && sudo docker compose --env-file .env --profile web -f deploy/docker-compose.yml up -d` (o con el siguiente push).

**A2A (ADR-011):** para publicar a Ápeiron como agente, define `APEIRON_A2A_SERVER_ENABLED=true` y `APEIRON_A2A_PUBLIC_URL=https://<dominio>` (así la Agent Card anuncia `https`); Nginx ya enruta `/a2a` y `/.well-known/agent-card.json`. Cada worker remoto necesita su credencial en `APEIRON_A2A_TOKEN_<NOMBRE>`, que es un secret más del `.env` de la VM, y su host en `APEIRON_A2A_ALLOWED_HOSTS`.

Las claves quedan solo en la VM, fuera del repositorio y de GitHub. El paso siguiente natural es AWS Secrets Manager o SSM Parameter Store con un rol IAM en la instancia.

El primer push crea los paquetes `apeiron-api` y `apeiron-web` con visibilidad privada. Ese primer CD puede fallar al hacer pull. Después del primer push, abre ambos paquetes en GitHub Packages, cambia **Package visibility** a **Public** y reejecuta el workflow CD fallido desde **Actions**. A partir de entonces EC2 podrá hacer pull anónimo. CI publica con el `GITHUB_TOKEN` integrado (`packages: write`); no crees un PAT adicional.

Al hacer públicos los paquetes, la imagen API (que incluye los módulos Python instalados) se podrá descargar sin autenticación; no introduzcas secretos ni credenciales durante el build. Si no se acepta distribuir ese código dentro de la imagen, este diseño de un solo secret no es adecuado: habría que mantener GHCR privado y añadir una credencial de lectura o transportar artefactos por otro medio.

## Flujo

1. En pull requests y push a `main`, CI ejecuta Ruff, mypy, import-linter, pytest en Python 3.12/3.13/3.14, `npm ci` y build Angular.
2. Solo en `main`, después de que los checks pasen, CI publica API/web en GHCR con el tag único `SHA-run-attempt`.
3. El workflow CD se activa al completarse CI correctamente para un push a `main` y conecta por SSH al valor de `EC2_HOST`.
4. GitHub copia `docker-compose.yml` y `deploy/scripts/deploy-ec2.sh` a EC2, y envía `.env.example` por SSH (stdin) como template. No se necesita acceso al repositorio desde la instancia.
5. El script remoto crea `.env` desde el template solo si no existe, descarga las imágenes, valida el `.env` con `Settings` (si falla, se detiene sin tocar nada) y después descarga las dos imágenes públicas de ese tag, levanta el perfil `web` con Compose y comprueba `/healthz`. Chroma queda fijado a `chromadb/chroma:1.5.9`.

Antes del deploy, CD verifica acceso SSH, `sudo -n` y Docker Compose, y crea `/opt/apeiron-ecosystem` si no existe. Si el paso remoto falla, el log incluye la etapa y línea aproximada del script; GHCR también se comprueba anónimamente antes de abrir SSH.

Pull requests no publican ni despliegan. Un solo host puede tener una interrupción breve durante la recreación de contenedores. Para rollback, vuelve a ejecutar el deploy de un tag GHCR anterior. El escaneo SSH de primera conexión usa `ssh-keyscan`; para una política de host-key estricta, añade el fingerprint conocido de la instancia.

La app Angular se construye en CI y el artefacto servido queda en `dist/apeiron-web/browser`. Termina TLS en un balanceador o proxy delante de Nginx y conserva el SSE sin buffering. Antes de producción pública, valida el backup y la restauración de los volúmenes `api-data` (usuarios SQLite) y `chroma-data` (memoria vectorial).
