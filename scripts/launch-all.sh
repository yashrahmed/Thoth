#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="/tmp/thoth-local"
LOG_DIR="$STATE_DIR/logs"
COMMAND="${1:-}"
PROFILE="${2:-local}"
CONFIG_PATH="$REPO_ROOT/config/${PROFILE}.yaml"
CREDS_FILE="$REPO_ROOT/config/${PROFILE}-secrets.env"

if [ -z "$COMMAND" ]; then
  echo "Usage: ./scripts/launch-all.sh <start|stop> [profile]"
  exit 1
fi

mkdir -p "$LOG_DIR"

read_port() {
  service_key="$1"
  awk -v service="$service_key" '
    $1 == service ":" {
      in_service = 1
      next
    }

    in_service && $1 == "port:" {
      print $2
      exit
    }

    in_service && $0 ~ /^[^[:space:]]/ {
      in_service = 0
    }
  ' "$CONFIG_PATH"
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

  while [ "$attempts" -lt 30 ]; do
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

start_service() {
  service_name="$1"
  package_name="$2"
  service_command="$3"
  service_port="$4"
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

  port_pids="$(lsof -ti tcp:"$service_port" || true)"
  if [ -n "$port_pids" ]; then
    echo "$service_name could not start because port $service_port is already in use."
    echo "Run ./scripts/launch-all.sh start to replace the existing process."
    exit 1
  fi

  (
    cd "$REPO_ROOT"
    nohup bun run --filter "$package_name" "$service_command" -- "$PROFILE" >"$log_file" 2>&1 &
    echo "$!" >"$pid_file"
  )

  wrapper_pid="$(cat "$pid_file")"

  wait_for_service_listener "$service_name" "$pid_file" "$service_port" "$wrapper_pid" "$log_file"
}

stop_service() {
  service_name="$1"
  service_port="$2"
  pid_file="$STATE_DIR/$service_name.pid"

  if ! kill_service_pids "$service_name" "$pid_file" "$service_port"; then
    echo "$service_name is not running."
  fi
}

start_all_services() {
  start_service "message-proxy" "@thoth/message-proxy" "start" "$(read_port proxy)"
  start_service "conv-agent" "@thoth/conv-agent" "start" "$(read_port convAgent)"
}

stop_all_services() {
  stop_service "message-proxy" "$(read_port proxy)"
  stop_service "conv-agent" "$(read_port convAgent)"
}

require_config() {
  if [ ! -f "$CONFIG_PATH" ]; then
    echo "Missing launch config for profile '$PROFILE': $CONFIG_PATH"
    exit 1
  fi
}

load_credentials() {
  if [ ! -f "$CREDS_FILE" ]; then
    echo "Missing credentials file: $CREDS_FILE. Copy config/${PROFILE}-secrets.env.example (if present) and fill in values."
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$CREDS_FILE"
  set +a
}

start_database() {
  "$SCRIPT_DIR/db-local.sh" start
}

stop_database() {
  "$SCRIPT_DIR/db-local.sh" stop
}

case "$COMMAND" in
  start)
    require_config
    load_credentials
    stop_all_services
    stop_database
    start_database
    start_all_services
    ;;
  stop)
    stop_all_services
    stop_database
    ;;
  *)
    echo "Unsupported command: $COMMAND"
    echo "Usage: ./scripts/launch-all.sh <start|stop> [profile]"
    exit 1
    ;;
esac
