#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
COMMAND="${1:-}"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
COMPOSE_ENV_FILE="$SCRIPT_DIR/data/.env"

usage() {
  echo "Usage: ./deployment/local/db-local.sh <up|migrate|stop>"
}

if [ -z "$COMMAND" ]; then
  usage
  exit 1
fi

start_postgres() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" up -d postgres
}

case "$COMMAND" in
  up)
    start_postgres
    ;;
  migrate)
    start_postgres
    sh "$REPO_ROOT/deployment/run-flyway-migrations.sh" local
    ;;
  stop)
    docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" down
    ;;
  *)
    echo "Unsupported command: $COMMAND" >&2
    usage >&2
    exit 1
    ;;
esac
