#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_PREFIX:?IMAGE_PREFIX is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${CHROMA_IMAGE:?CHROMA_IMAGE is required}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/apeiron-ecosystem}"

install -d -m 755 "$DEPLOY_DIR/deploy"
install -m 644 /tmp/docker-compose.yml "$DEPLOY_DIR/deploy/docker-compose.yml"
rm -f /tmp/docker-compose.yml /tmp/deploy-ec2.sh
cd "$DEPLOY_DIR"
test -f .env

export APEIRON_API_IMAGE="${IMAGE_PREFIX}/apeiron-api:${IMAGE_TAG}"
export APEIRON_WEB_IMAGE="${IMAGE_PREFIX}/apeiron-web:${IMAGE_TAG}"
export APEIRON_CHROMA_IMAGE="$CHROMA_IMAGE"

docker compose --env-file .env --profile web \
  -f deploy/docker-compose.yml pull
docker compose --env-file .env --profile web \
  -f deploy/docker-compose.yml up -d --no-build --remove-orphans \
  --wait --wait-timeout 600
curl --fail --silent --show-error --retry 10 --retry-delay 5 \
  --retry-connrefused http://127.0.0.1:8000/healthz
docker image prune --force