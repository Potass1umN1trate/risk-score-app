#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE_NAME="${IMAGE_NAME:-risk-score-analytics:smoke}"
NETWORK_NAME="${NETWORK_NAME:-risk-score-analytics-smoke}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-risk-score-postgres-smoke}"
ANALYTICS_CONTAINER="${ANALYTICS_CONTAINER:-risk-score-analytics-smoke}"
HOST_PORT="${HOST_PORT:-8000}"
DATABASE_URL="postgresql://riskapp:riskapp_secret@${POSTGRES_CONTAINER}:5432/riskscoredb"

cleanup() {
  docker rm -f "${ANALYTICS_CONTAINER}" >/dev/null 2>&1 || true
  docker rm -f "${POSTGRES_CONTAINER}" >/dev/null 2>&1 || true
  docker network rm "${NETWORK_NAME}" >/dev/null 2>&1 || true
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-60}"

  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS "${url}" >/dev/null; then
      return 0
    fi
    sleep 1
  done

  return 1
}

trap cleanup EXIT

cleanup

echo "Building analytics image: ${IMAGE_NAME}"
docker build -f analytics/Dockerfile -t "${IMAGE_NAME}" .

echo "Creating private Docker network: ${NETWORK_NAME}"
docker network create "${NETWORK_NAME}" >/dev/null

echo "Starting temporary PostgreSQL 16.4 container: ${POSTGRES_CONTAINER}"
docker run -d \
  --name "${POSTGRES_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  -e POSTGRES_USER=riskapp \
  -e POSTGRES_PASSWORD=riskapp_secret \
  -e POSTGRES_DB=riskscoredb \
  postgres:16.4 >/dev/null

echo "Waiting for PostgreSQL readiness"
for _ in $(seq 1 60); do
  if docker exec "${POSTGRES_CONTAINER}" pg_isready -U riskapp -d riskscoredb >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "${POSTGRES_CONTAINER}" pg_isready -U riskapp -d riskscoredb >/dev/null 2>&1; then
  echo "PostgreSQL did not become ready" >&2
  docker logs "${POSTGRES_CONTAINER}" >&2 || true
  exit 1
fi

echo "Starting analytics-service container: ${ANALYTICS_CONTAINER}"
docker run -d \
  --name "${ANALYTICS_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  -p "${HOST_PORT}:8000" \
  -e DATABASE_URL="${DATABASE_URL}" \
  "${IMAGE_NAME}" >/dev/null

HEALTH_URL="http://127.0.0.1:${HOST_PORT}/health"
MODEL_STATUS_URL="http://127.0.0.1:${HOST_PORT}/api/model/status"

echo "Waiting for analytics /health"
if ! wait_for_http "${HEALTH_URL}" 60; then
  echo "analytics-service did not pass /health" >&2
  docker logs "${ANALYTICS_CONTAINER}" >&2 || true
  exit 1
fi

echo "/health response:"
curl -fsS "${HEALTH_URL}"
echo

echo "/api/model/status response:"
curl -fsS "${MODEL_STATUS_URL}"
echo

echo "Smoke passed: analytics-service started, connected to temporary Postgres via DATABASE_URL, and served both endpoints."
