#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/db/local/docker-compose.yml"

docker compose -f "$COMPOSE_FILE" up -d postgres
docker compose -f "$COMPOSE_FILE" --profile migrations run --rm flyway migrate
