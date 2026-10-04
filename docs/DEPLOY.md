# Despliegue CI/CD en AWS EC2

El pipeline está dividido en `.github/workflows/ci.yml` y `.github/workflows/deploy-ec2.yml`. CI valida y publica imágenes versionadas en GHCR con el `GITHUB_TOKEN` automático. CD se ejecuta solo después de un CI exitoso en `main` y actualiza Compose por SSH a un host fijo. No usa AWS API, ECR, SSM ni credenciales AWS.

## Preparar EC2

Usa AMI Amazon Linux y usuario `ec2-user`. Asigna a EC2 una Elastic IP o DNS estable; CD no consulta la región ni el Instance ID. La instancia debe tener IPv4 pública y 2 vCPU/4 GB RAM.

1. Instala Docker Engine y Docker Compose v2. Asegura que `ec2-user` puede ejecutar `sudo -n docker` sin prompt de contraseña.
2. Crea `/opt/apeiron-ecosystem/.env` antes del primer deploy. Configura `APEIRON_ENV=prod`, `APEIRON_JWT_SECRET` aleatorio (`openssl rand -hex 32`), proveedor/API key LLM, `APEIRON_VECTOR_BACKEND=chroma` y los orígenes CORS reales. El workflow no copia ni sobrescribe `.env`.
3. Mantén el volumen Docker `chroma-data`; define backup y restauración antes de guardar memoria de usuarios.
4. Security group: permite 80/443 según TLS y SSH 22 desde rangos de GitHub-hosted runners. No abras 22 a `0.0.0.0/0`. El API se publica solo en `127.0.0.1:8000`; Chroma no publica puertos.

## Configuración de GitHub

En **Settings → Secrets and variables → Actions → Repository secrets**, crea un solo secret:

- `AWS_SSH_PRIVATE_KEY`: clave privada de `ec2-user`, con sus saltos de línea.

En **Settings → Secrets and variables → Actions → Repository variables**, define `EC2_HOST` con la Elastic IP o DNS de la instancia. No es un secret.

El primer push crea los paquetes `apeiron-api` y `apeiron-web` con visibilidad privada. Ese primer CD puede fallar al hacer pull. Después del primer push, abre ambos paquetes en GitHub Packages, cambia **Package visibility** a **Public** y reejecuta el workflow CD fallido desde **Actions**. A partir de entonces EC2 podrá hacer pull anónimo. CI publica con el `GITHUB_TOKEN` integrado (`packages: write`); no crees un PAT adicional.

Al hacer públicos los paquetes, la imagen API (que incluye los módulos Python instalados) se podrá descargar sin autenticación; no introduzcas secretos ni credenciales durante el build. Si no se acepta distribuir ese código dentro de la imagen, este diseño de un solo secret no es adecuado: habría que mantener GHCR privado y añadir una credencial de lectura o transportar artefactos por otro medio.

## Flujo

1. En pull requests y push a `main`, CI ejecuta Ruff, mypy, import-linter, pytest en Python 3.12/3.13/3.14, `npm ci` y build Angular.
2. Solo en `main`, después de que los checks pasen, CI publica API/web en GHCR con el tag único `SHA-run-attempt`.
3. El workflow CD se activa al completarse CI correctamente para un push a `main` y conecta por SSH al valor de `EC2_HOST`.
4. GitHub copia `docker-compose.yml` y `deploy/scripts/deploy-ec2.sh` a EC2. No se necesita acceso al repositorio desde la instancia.
5. El script remoto descarga las dos imágenes públicas de ese tag, levanta el perfil `web` con Compose y comprueba `/healthz`. Chroma queda fijado a `chromadb/chroma:1.5.9`.

Antes del deploy, CD verifica acceso SSH, `sudo -n`, Docker Compose y lectura de `/opt/apeiron-ecosystem/.env`. Si el paso remoto falla, el log incluye la etapa y línea aproximada del script; GHCR también se comprueba anónimamente antes de abrir SSH.

Pull requests no publican ni despliegan. Un solo host puede tener una interrupción breve durante la recreación de contenedores. Para rollback, vuelve a ejecutar el deploy de un tag GHCR anterior. El escaneo SSH de primera conexión usa `ssh-keyscan`; para una política de host-key estricta, añade el fingerprint conocido de la instancia.

La app Angular se construye en CI y el artefacto servido queda en `dist/apeiron-web/browser`. Termina TLS en un balanceador o proxy delante de Nginx y conserva el SSE sin buffering. Antes de producción pública sigue pendiente reemplazar `InMemoryUserRepository` por persistencia y validar backups de Chroma.
