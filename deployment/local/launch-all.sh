#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="/tmp/thoth-local"
LOG_DIR="$STATE_DIR/logs"
CREDENTIALS_DIR="$HOME/.thoth"
COMMAND="${1:-}"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
COMPOSE_ENV_FILE="$SCRIPT_DIR/data/.env"
MINIO_ENDPOINT="http://127.0.0.1:9000"
WORKER_PORT=3001
WORKER_PACKAGE_DIR="$REPO_ROOT/packages/conv-agent"
WORKER_DEV_VARS="$SCRIPT_DIR/.dev.vars"
CREDS_FILE="$CREDENTIALS_DIR/local-secrets.env"
CREDS_HINT="Copy deployment/local/local-secrets.env.example to ~/.thoth/local-secrets.env and fill in values."
WRANGLER_CONFIG_FILE="$SCRIPT_DIR/wrangler-server-local.toml"
REQUIRED_WORKER_SECRETS="BLOB_STORAGE_ACCESS_KEY_ID BLOB_STORAGE_SECRET_ACCESS_KEY OPENAI_LLM_API_KEY GOOGLE_LLM_API_KEY"

if [ -z "$COMMAND" ]; then
  echo "Usage: ./deployment/local/launch-all.sh <start|stop>"
  exit 1
fi

if [ -n "${2:-}" ]; then
  echo "Local launch no longer supports profiles. Use ./deployment/local/launch-all.sh <start|stop>." >&2
  echo "Use ./deployment/local/launch-web.sh dev to point the local UI at the deployed dev Worker." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

kill_service_pids() {
  service_name="$1"
  pid_file="$2"
  service_port="$3"
  stopped=1

  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file")"

    if kill -0 "$pid" 2>/dev/null; then
      kill_process_tree "$pid"
      echo "Stopped $service_name."
      stopped=0
    else
      echo "$service_name pid file was stale."
    fi
  fi

  wrangler_pids="$(find_wrangler_pids)"
  if [ -n "$wrangler_pids" ]; then
    for wrangler_pid in $wrangler_pids; do
      kill_process_tree "$wrangler_pid"
    done
    echo "Stopped $service_name Wrangler process tree."
    stopped=0
  fi

  fallback_pids="$(lsof -ti tcp:"$service_port" || true)"
  if [ -n "$fallback_pids" ]; then
    for fallback_pid in $fallback_pids; do
      kill_process_tree "$fallback_pid"
    done
    echo "Stopped $service_name via port $service_port."
    stopped=0
  fi

  rm -f "$pid_file"
  return "$stopped"
}

find_child_pids() {
  parent_pid="$1"

  ps -axo pid=,ppid= | while read -r child_pid child_parent_pid; do
    if [ "$child_parent_pid" = "$parent_pid" ]; then
      printf '%s\n' "$child_pid"
    fi
  done
}

find_wrangler_pids() {
  ps -axo pid=,command= | while read -r process_pid process_command; do
    case "$process_command" in
      *"wrangler dev --config $WRANGLER_CONFIG_FILE"*)
        printf '%s\n' "$process_pid"
        ;;
    esac
  done
}

collect_descendant_pids() {
  parent_pid="$1"

  for child_pid in $(find_child_pids "$parent_pid"); do
    printf '%s\n' "$child_pid"
    collect_descendant_pids "$child_pid"
  done
}

kill_process_tree() {
  root_pid="$1"
  candidate_pids="$(printf '%s\n%s\n' "$root_pid" "$(collect_descendant_pids "$root_pid")" | sed '/^$/d' | sort -u)"

  if [ -z "$candidate_pids" ]; then
    return 0
  fi

  kill $candidate_pids 2>/dev/null || true

  attempts=0
  while [ "$attempts" -lt 5 ]; do
    live_pids=""

    for candidate_pid in $candidate_pids; do
      if kill -0 "$candidate_pid" 2>/dev/null; then
        live_pids="$live_pids $candidate_pid"
      fi
    done

    if [ -z "$live_pids" ]; then
      return 0
    fi

    attempts=$((attempts + 1))
    sleep 1
  done

  kill -9 $candidate_pids 2>/dev/null || true
}

wait_for_service_listener() {
  service_name="$1"
  pid_file="$2"
  service_port="$3"
  wrapper_pid="$4"
  log_file="$5"
  attempts=0

  while [ "$attempts" -lt 60 ]; do
    listener_pid="$(lsof -ti tcp:"$service_port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"

    if [ -n "$listener_pid" ] && curl -sS -o /dev/null -f "http://127.0.0.1:$service_port/health" 2>/dev/null; then
      echo "Started $service_name. Logs: $log_file"
      return 0
    fi

    if ! kill -0 "$wrapper_pid" 2>/dev/null; then
      rm -f "$pid_file"
      echo "$service_name failed to start. Logs: $log_file"
      return 1
    fi

    attempts=$((attempts + 1))
    sleep 1
  done

  rm -f "$pid_file"
  echo "$service_name did not become healthy on port $service_port in time. Logs: $log_file"
  return 1
}

read_secret_value() {
  key="$1"
  file="$2"

  if [ ! -f "$file" ]; then
    return 0
  fi

  value="$(sed -n "s/^${key}=//p" "$file" | tail -n 1)"

  case "$value" in
    \"*\")
      value="${value#\"}"
      value="${value%\"}"
      ;;
    \'*\')
      value="${value#\'}"
      value="${value%\'}"
      ;;
  esac

  printf '%s\n' "$value"
}

write_dev_vars() {
  if [ ! -f "$CREDS_FILE" ]; then
    echo "Missing credentials file: $CREDS_FILE. $CREDS_HINT"
    exit 1
  fi

  if [ ! -f "$WRANGLER_CONFIG_FILE" ]; then
    echo "Missing Wrangler config file: $WRANGLER_CONFIG_FILE."
    exit 1
  fi

  cp "$CREDS_FILE" "$WORKER_DEV_VARS"

  if [ -z "$(read_secret_value "OPENAI_LLM_API_KEY" "$WORKER_DEV_VARS")" ] && [ -n "${OPENAI_LLM_API_KEY:-}" ]; then
    printf '\nOPENAI_LLM_API_KEY=%s\n' "$OPENAI_LLM_API_KEY" >>"$WORKER_DEV_VARS"
  fi

  if [ -z "$(read_secret_value "GOOGLE_LLM_API_KEY" "$WORKER_DEV_VARS")" ] && [ -n "${GOOGLE_LLM_API_KEY:-}" ]; then
    printf '\nGOOGLE_LLM_API_KEY=%s\n' "$GOOGLE_LLM_API_KEY" >>"$WORKER_DEV_VARS"
  fi

  for secret_name in $REQUIRED_WORKER_SECRETS; do
    if [ -z "$(read_secret_value "$secret_name" "$WORKER_DEV_VARS")" ]; then
      echo "Missing $secret_name in $CREDS_FILE."
      if [ "$secret_name" = "OPENAI_LLM_API_KEY" ]; then
        echo "Set OPENAI_LLM_API_KEY in $CREDS_FILE or export OPENAI_LLM_API_KEY before starting the local worker."
      fi
      if [ "$secret_name" = "GOOGLE_LLM_API_KEY" ]; then
        echo "Set GOOGLE_LLM_API_KEY in $CREDS_FILE or export GOOGLE_LLM_API_KEY before starting the local worker."
      fi
      exit 1
    fi
  done
}

start_worker() {
  service_name="thoth-conv-agent-server"
  pid_file="$STATE_DIR/$service_name.pid"
  log_file="$LOG_DIR/$service_name.log"

  if [ -f "$pid_file" ]; then
    existing_pid="$(cat "$pid_file")"
    if kill -0 "$existing_pid" 2>/dev/null; then
      echo "$service_name is already running with pid $existing_pid."
      return
    fi
    rm -f "$pid_file"
  fi

  port_pids="$(lsof -ti tcp:"$WORKER_PORT" || true)"
  if [ -n "$port_pids" ]; then
    echo "$service_name could not start because port $WORKER_PORT is already in use."
    exit 1
  fi

  (
    cd "$WORKER_PACKAGE_DIR"
    # Run Wrangler through Bun and pass the generated env file to Wrangler so
    # local secret values are available to the Worker runtime at startup.
    nohup bun x wrangler dev --config "$WRANGLER_CONFIG_FILE" --env-file "$WORKER_DEV_VARS" --port "$WORKER_PORT" --inspector-port 0 --show-interactive-dev-session=false >"$log_file" 2>&1 &
    echo "$!" >"$pid_file"
  )

  wrapper_pid="$(cat "$pid_file")"

  wait_for_service_listener "$service_name" "$pid_file" "$WORKER_PORT" "$wrapper_pid" "$log_file"
}

stop_worker() {
  kill_service_pids "thoth-conv-agent-server" "$STATE_DIR/thoth-conv-agent-server.pid" "$WORKER_PORT" || echo "thoth-conv-agent-server is not running."
  rm -f "$WORKER_DEV_VARS"
}

wait_for_dependencies() {
  wait_for_postgres

  attempts=0

  while ! curl -sS -o /dev/null -f "$MINIO_ENDPOINT/minio/health/live" 2>/dev/null; do
    attempts=$((attempts + 1))

    if [ "$attempts" -ge 60 ]; then
      echo "MinIO did not become ready in time."
      exit 1
    fi

    sleep 1
  done

  wait_for_minio_setup
}

wait_for_postgres() {
  attempts=0

  while [ "$attempts" -lt 60 ]; do
    postgres_state="$(docker inspect thoth-postgres-local --format '{{.State.Status}}' 2>/dev/null || true)"

    case "$postgres_state" in
      running)
        if docker exec thoth-postgres-local sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
          return 0
        fi
        ;;
      exited|dead)
        echo "Postgres failed with state: $postgres_state" >&2
        docker logs thoth-postgres-local >&2 || true
        exit 1
        ;;
    esac

    attempts=$((attempts + 1))
    sleep 1
  done

  echo "Postgres did not become ready in time." >&2
  docker logs thoth-postgres-local >&2 || true
  exit 1
}

wait_for_minio_setup() {
  attempts=0

  while [ "$attempts" -lt 60 ]; do
    setup_state="$(docker inspect thoth-minio-setup --format '{{.State.Status}} {{.State.ExitCode}}' 2>/dev/null || true)"

    case "$setup_state" in
      "exited 0")
        return 0
        ;;
      exited\ *)
        echo "MinIO setup failed with state: $setup_state" >&2
        docker logs thoth-minio-setup >&2 || true
        exit 1
        ;;
    esac

    attempts=$((attempts + 1))
    sleep 1
  done

  echo "MinIO setup did not complete in time." >&2
  docker logs thoth-minio-setup >&2 || true
  exit 1
}

start_database() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" up -d postgres minio minio-setup
  wait_for_dependencies
}

stop_database() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" down
}

case "$COMMAND" in
  start)
    stop_worker
    stop_database
    write_dev_vars
    start_database
    start_worker
    ;;
  stop)
    stop_worker
    stop_database
    ;;
  *)
    echo "Unsupported command: $COMMAND"
    echo "Usage: ./deployment/local/launch-all.sh <start|stop>"
    exit 1
    ;;
esac
