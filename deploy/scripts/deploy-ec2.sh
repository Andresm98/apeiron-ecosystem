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
if [[ ! -r .env ]]; then
  echo "[deploy] Missing or unreadable $DEPLOY_DIR/.env" >&2
  exit 2
fi

export APEIRON_API_IMAGE="${IMAGE_PREFIX}/apeiron-api:${IMAGE_TAG}"
export APEIRON_WEB_IMAGE="${IMAGE_PREFIX}/apeiron-web:${IMAGE_TAG}"
export APEIRON_CHROMA_IMAGE="$CHROMA_IMAGE"

echo "[deploy] Pulling API, web, and Chroma images"
docker compose --env-file .env --profile web \
  -f deploy/docker-compose.yml pull
echo "[deploy] Starting Compose services"
docker compose --env-file .env --profile web \
  -f deploy/docker-compose.yml up -d --no-build --remove-orphans \
  --wait --wait-timeout 600
echo "[deploy] Checking API health"
curl --fail --silent --show-error --retry 10 --retry-delay 5 \
  --retry-connrefused http://127.0.0.1:8000/healthz
echo "[deploy] Removing dangling images"
docker image prune --force