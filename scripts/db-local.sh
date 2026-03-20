#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/db/local/docker-compose.yml"
ENV_FILE="$REPO_ROOT/db/local/.env"
COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
  echo "Usage: ./scripts/db-local.sh <start|stop|restart>"
  exit 1
fi

start_database() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migrations run --rm flyway migrate
}

stop_database() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down
}

case "$COMMAND" in
  start|restart)
    if [ "$COMMAND" = "restart" ]; then
      stop_database
    fi

    start_database
    ;;
  stop)
    stop_database
    ;;
  *)
    echo "Unsupported command: $COMMAND"
    echo "Usage: ./scripts/db-local.sh <start|stop|restart>"
    exit 1
    ;;
esac
