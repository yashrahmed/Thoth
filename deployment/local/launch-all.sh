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
PROXY_SERVER_PORT=8788
WORKER_PACKAGE_DIR="$REPO_ROOT/packages/conv-agent"
PROXY_SERVER_PACKAGE_DIR="$REPO_ROOT/packages/proxy-server"
WORKER_DEV_VARS="$SCRIPT_DIR/.dev.vars"
CREDS_FILE="$CREDENTIALS_DIR/local-secrets.env"
CREDS_HINT="Copy deployment/local/local-secrets.env.example to ~/.thoth/local-secrets.env and fill in values."
WRANGLER_CONFIG_FILE="$SCRIPT_DIR/wrangler-local.toml"
REQUIRED_WORKER_SECRETS="BLOB_STORAGE_ACCESS_KEY_ID BLOB_STORAGE_SECRET_ACCESS_KEY LLM_API_KEY TEMP_BEARER_TOKEN"
REQUIRED_PROXY_SERVER_SECRETS="GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET TEMP_BEARER_TOKEN"

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
      kill "$pid"
      wait "$pid" 2>/dev/null || true
      echo "Stopped $service_name."
      stopped=0
    else
      echo "$service_name pid file was stale."
    fi
  fi

  fallback_pids="$(lsof -ti tcp:"$service_port" || true)"
  if [ -n "$fallback_pids" ]; then
    kill $fallback_pids 2>/dev/null || true
    echo "Stopped $service_name via port $service_port."
    stopped=0
  fi

  rm -f "$pid_file"
  return "$stopped"
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
      echo "$listener_pid" >"$pid_file"
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

  if [ -z "$(read_secret_value "LLM_API_KEY" "$WORKER_DEV_VARS")" ] && [ -n "${LLM_API_KEY:-}" ]; then
    printf '\nLLM_API_KEY=%s\n' "$LLM_API_KEY" >>"$WORKER_DEV_VARS"
  fi

  for secret_name in $REQUIRED_WORKER_SECRETS; do
    if [ -z "$(read_secret_value "$secret_name" "$WORKER_DEV_VARS")" ]; then
      echo "Missing $secret_name in $CREDS_FILE."
      if [ "$secret_name" = "LLM_API_KEY" ]; then
        echo "Set LLM_API_KEY in $CREDS_FILE or export LLM_API_KEY before starting the local worker."
      fi
      exit 1
    fi
  done

  for secret_name in $REQUIRED_PROXY_SERVER_SECRETS; do
    if [ -z "$(read_secret_value "$secret_name" "$CREDS_FILE")" ]; then
      echo "Missing $secret_name in $CREDS_FILE."
      exit 1
    fi
  done
}

start_worker() {
  service_name="conv-agent"
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
    # Run Wrangler through Bun with --env-file so local secret values are
    # available to both Wrangler and the Worker runtime at startup.
    nohup bun exec --env-file "$WORKER_DEV_VARS" "bun x wrangler dev --config \"$WRANGLER_CONFIG_FILE\" --port \"$WORKER_PORT\" --inspector-port 0" >"$log_file" 2>&1 &
    echo "$!" >"$pid_file"
  )

  wrapper_pid="$(cat "$pid_file")"

  wait_for_service_listener "$service_name" "$pid_file" "$WORKER_PORT" "$wrapper_pid" "$log_file"
}

stop_worker() {
  kill_service_pids "conv-agent" "$STATE_DIR/conv-agent.pid" "$WORKER_PORT" || echo "conv-agent is not running."
  rm -f "$WORKER_DEV_VARS"
}

start_proxy_server() {
  service_name="proxy-server"
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

  port_pids="$(lsof -ti tcp:"$PROXY_SERVER_PORT" || true)"
  if [ -n "$port_pids" ]; then
    echo "$service_name could not start because port $PROXY_SERVER_PORT is already in use."
    exit 1
  fi

  (
    cd "$PROXY_SERVER_PACKAGE_DIR"
    nohup env PORT="$PROXY_SERVER_PORT" CONV_AGENT_URL="http://127.0.0.1:$WORKER_PORT" WEB_ORIGIN="http://localhost:5173" bun --env-file "$CREDS_FILE" src/local/index.ts >"$log_file" 2>&1 &
    echo "$!" >"$pid_file"
  )

  wrapper_pid="$(cat "$pid_file")"

  wait_for_service_listener "$service_name" "$pid_file" "$PROXY_SERVER_PORT" "$wrapper_pid" "$log_file"
}

stop_proxy_server() {
  kill_service_pids "proxy-server" "$STATE_DIR/proxy-server.pid" "$PROXY_SERVER_PORT" || echo "proxy-server is not running."
}

wait_for_dependencies() {
  attempts=0

  while ! curl -sS -o /dev/null -f "$MINIO_ENDPOINT/minio/health/live"; do
    attempts=$((attempts + 1))

    if [ "$attempts" -ge 60 ]; then
      echo "MinIO did not become ready in time."
      exit 1
    fi

    sleep 1
  done

  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" wait minio-setup >/dev/null
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
    stop_proxy_server
    stop_worker
    stop_database
    write_dev_vars
    start_database
    start_worker
    start_proxy_server
    ;;
  stop)
    stop_proxy_server
    stop_worker
    stop_database
    ;;
  *)
    echo "Unsupported command: $COMMAND"
    echo "Usage: ./deployment/local/launch-all.sh <start|stop>"
    exit 1
    ;;
esac
