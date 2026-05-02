#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="/tmp/thoth-local"
LOG_DIR="$STATE_DIR/logs"
CREDENTIALS_DIR="$HOME/.thoth"
COMMAND="${1:-}"
DEFAULT_PROFILE="local"
PROFILE="${2:-$DEFAULT_PROFILE}"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
COMPOSE_ENV_FILE="$SCRIPT_DIR/data/.env"
MINIO_ENDPOINT="http://127.0.0.1:9000"
WORKER_PORT=3001
WORKER_PACKAGE_DIR="$REPO_ROOT/packages/conv-agent"
WORKER_DEV_VARS="$SCRIPT_DIR/.dev.vars"
CREDS_FILE=""
CREDS_HINT=""
USE_LOCAL_INFRA=0
WRANGLER_CONFIG_FILE=""

if [ -z "$COMMAND" ]; then
  echo "Usage: ./local-launch/launch-all.sh <start|stop> [profile=${DEFAULT_PROFILE}]"
  exit 1
fi

mkdir -p "$LOG_DIR"

configure_profile() {
  CREDS_FILE="$CREDENTIALS_DIR/$PROFILE-secrets.env"

  case "$PROFILE" in
    local)
      CREDS_HINT="Copy local-launch/local-secrets.env.example to ~/.thoth/local-secrets.env and fill in values."
      USE_LOCAL_INFRA=1
      WRANGLER_CONFIG_FILE="$SCRIPT_DIR/wrangler-local.toml"
      ;;
    dev)
      CREDS_HINT="Populate ~/.thoth/dev-secrets.env and local-launch/wrangler-cloud-dev.toml with your cloud development values."
      USE_LOCAL_INFRA=0
      WRANGLER_CONFIG_FILE="$SCRIPT_DIR/wrangler-cloud-dev.toml"
      ;;
    *)
      echo "Unsupported profile: $PROFILE"
      echo "Usage: ./local-launch/launch-all.sh <start|stop> [profile=${DEFAULT_PROFILE}]"
      echo "Supported profiles: local, dev"
      exit 1
      ;;
  esac
}

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

    if [ -n "$listener_pid" ]; then
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
  echo "$service_name did not bind port $service_port in time. Logs: $log_file"
  return 1
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
    # At the time of writing with wrangler 4.85.0, relying on Wrangler to
    # auto-discover local-launch/.dev.vars was not sufficient for
    # CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE in the dev
    # profile. Run Wrangler through Bun with --env-file so the Hyperdrive local
    # override is present in Wrangler's own process environment at startup.
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
  if [ "$USE_LOCAL_INFRA" -ne 1 ]; then
    echo "Skipping local Postgres and MinIO for profile $PROFILE."
    return
  fi

  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" up -d postgres minio minio-setup
  wait_for_dependencies
}

stop_database() {
  if [ "$USE_LOCAL_INFRA" -ne 1 ]; then
    return
  fi

  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" down
}

configure_profile

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
    echo "Usage: ./local-launch/launch-all.sh <start|stop> [profile=${DEFAULT_PROFILE}]"
    exit 1
    ;;
esac
