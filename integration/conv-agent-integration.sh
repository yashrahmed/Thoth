#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/integration/conv-agent-compose.yml"
ACTION="${1:-test}"

wait_for_postgres() {
  attempts=0

  while ! docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U thoth -d thoth_test >/dev/null 2>&1; do
    attempts=$((attempts + 1))

    if [ "$attempts" -ge 60 ]; then
      echo "Postgres did not become ready in time."
      exit 1
    fi

    sleep 1
  done
}

wait_for_minio() {
  attempts=0

  while ! curl -sS -o /dev/null -f "http://127.0.0.1:59000/minio/health/live"; do
    attempts=$((attempts + 1))

    if [ "$attempts" -ge 60 ]; then
      echo "MinIO did not become ready in time."
      exit 1
    fi

    sleep 1
  done

  docker compose -f "$COMPOSE_FILE" wait minio-setup >/dev/null
}

start_stack() {
  docker compose -f "$COMPOSE_FILE" up -d postgres minio minio-setup
  wait_for_postgres
  wait_for_minio
  docker compose -f "$COMPOSE_FILE" --profile migrations run --rm flyway migrate
}

stop_stack() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
}

run_tests() {
  echo "Integration tests are not yet ported to the Cloudflare Worker stack."
  echo "Re-run once src/integration/conv-agent-it.test.ts is rewritten to drive 'wrangler dev'."
  exit 1
}

case "$ACTION" in
  start)
    start_stack
    ;;
  stop)
    stop_stack
    ;;
  restart)
    stop_stack
    start_stack
    ;;
  test)
    run_tests
    ;;
  *)
    echo "Usage: ./integration/conv-agent-integration.sh <start|stop|restart|test>"
    exit 1
    ;;
esac
