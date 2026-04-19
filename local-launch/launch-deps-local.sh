#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$REPO_ROOT/local-launch/data/.env"
COMMAND="${1:-}"
LOCALSTACK_ENDPOINT="http://127.0.0.1:4566"
LOCAL_BLOB_BUCKET="thoth-local-blob-store"
LOCAL_LLM_QUEUE_NAME="thoth-llm-completions"

if [ -z "$COMMAND" ]; then
  echo "Usage: ./local-launch/launch-deps-local.sh <start|stop|restart>"
  exit 1
fi

start_database() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres localstack
  wait_for_localstack_resources
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile migrations run --rm flyway migrate
}

stop_database() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down
}

wait_for_localstack_resources() {
  attempts=0

  while ! curl -sS -o /dev/null "$LOCALSTACK_ENDPOINT"; do
    attempts=$((attempts + 1))

    if [ "$attempts" -ge 60 ]; then
      echo "LocalStack did not become ready in time."
      exit 1
    fi

    sleep 1
  done

  attempts=0

  while ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T localstack awslocal s3api head-bucket --bucket "$LOCAL_BLOB_BUCKET" >/dev/null 2>&1; do
    attempts=$((attempts + 1))

    if [ "$attempts" -ge 60 ]; then
      echo "LocalStack S3 bucket did not become ready in time."
      exit 1
    fi

    sleep 1
  done

  attempts=0

  while ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T localstack awslocal sqs get-queue-url --queue-name "$LOCAL_LLM_QUEUE_NAME" >/dev/null 2>&1; do
    attempts=$((attempts + 1))

    if [ "$attempts" -ge 60 ]; then
      echo "LocalStack SQS queue did not become ready in time."
      exit 1
    fi

    sleep 1
  done
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
    echo "Usage: ./local-launch/launch-deps-local.sh <start|stop|restart>"
    exit 1
    ;;
esac
