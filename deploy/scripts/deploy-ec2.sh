#!/usr/bin/env bash
set -euo pipefail
trap 'status=$?; echo "[deploy] Failed near script line $LINENO (exit $status)" >&2; exit "$status"' ERR

: "${IMAGE_PREFIX:?IMAGE_PREFIX is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${CHROMA_IMAGE:?CHROMA_IMAGE is required}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/apeiron-ecosystem}"

echo "[deploy] Checking Docker and Compose"
command -v docker >/dev/null
docker compose version

echo "[deploy] Installing Compose file"
install -d -m 755 "$DEPLOY_DIR/deploy"
install -m 644 /tmp/docker-compose.yml "$DEPLOY_DIR/deploy/docker-compose.yml"
rm -f /tmp/docker-compose.yml /tmp/deploy-ec2.sh
cd "$DEPLOY_DIR"

# El .env de la VM es la configuración de producción y se edita en la propia VM.
# CD solo lo crea desde el template (.env.example del commit desplegado) si no existe;
# nunca lo sobrescribe. Para volver a sincronizarlo con el template: borrar .env y desplegar.
rm -f .env.next  # restos del modelo anterior (copia en cada despliegue)
if [[ ! -f .env ]]; then
  if [[ ! -f .env.example ]]; then
    echo "[deploy] Missing .env and .env.example: the CD step 'Upload .env.example template' did not run" >&2
    exit 2
  fi
  echo "[deploy] No .env found: seeding it from .env.example. Edit $DEPLOY_DIR/.env on the VM to set secrets."
  (umask 077 && tr -d '\r' < .env.example > .env)
else
  echo "[deploy] Keeping the existing .env (managed on the VM; not overwritten)"
fi
chown root:root .env
chmod 600 .env

export APEIRON_API_IMAGE="${IMAGE_PREFIX}/apeiron-api:${IMAGE_TAG}"
export APEIRON_WEB_IMAGE="${IMAGE_PREFIX}/apeiron-web:${IMAGE_TAG}"
export APEIRON_CHROMA_IMAGE="$CHROMA_IMAGE"
compose() {
  docker compose --env-file .env --profile web -f deploy/docker-compose.yml "$@"
}

echo "[deploy] Pulling API, web, and Chroma images"
compose pull

# Valida el .env real con la propia clase Settings de la API, dentro de la imagen que se va a
# desplegar. Si es inválido se aborta aquí: los contenedores en marcha no se tocan.
echo "[deploy] Validating .env with the release's Settings"
if ! compose run --rm --no-deps -T --entrypoint python api -c '
import os, sys
from apeiron_api.settings import Settings
try:
    s = Settings()
except Exception as exc:
    print(f"[deploy] .env inválido, no se despliega: {exc}", file=sys.stderr)
    sys.exit(3)
key = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}.get(s.llm_provider)
if key and not os.environ.get(key):
    print(f"[deploy] AVISO: {key} vacía; la API arranca pero el chat con el modelo real fallará", file=sys.stderr)
print(f"[deploy] .env válido (auth={s.auth_provider}, llm={s.llm_provider}:{s.llm_model}, env={s.env})")
'; then
  echo "[deploy] Aborted: fix $DEPLOY_DIR/.env on the VM and re-run the deploy. Running containers were left unchanged." >&2
  exit 3
fi

echo "[deploy] Starting Compose services"
compose up -d --no-build --remove-orphans --wait --wait-timeout 600
echo "[deploy] Checking API health"
curl --fail --silent --show-error --retry 10 --retry-delay 5 \
  --retry-connrefused http://127.0.0.1:8000/healthz
echo "[deploy] Removing dangling images"
docker image prune --force
