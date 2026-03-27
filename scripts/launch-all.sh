#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="/tmp/thoth-local"
LOG_DIR="$STATE_DIR/logs"
CONFIG_PATH="$REPO_ROOT/config/launch.yaml"
COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
  echo "Usage: ./scripts/launch-all.sh <start|stop>"
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
    export CONFIG_FILE="$CONFIG_PATH"
    nohup bun run --filter "$package_name" "$service_command" >"$log_file" 2>&1 &
    echo "$!" >"$pid_file"
  )

  echo "Started $service_name. Logs: $log_file"
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
  start_service "kb-curate-agent" "@thoth/kb-curate-agent" "start" "$(read_port kbCurateAgent)"
  start_service "planning-agent" "@thoth/planning-agent" "start" "$(read_port planningAgent)"
}

stop_all_services() {
  stop_service "message-proxy" "$(read_port proxy)"
  stop_service "conv-agent" "$(read_port convAgent)"
  stop_service "kb-curate-agent" "$(read_port kbCurateAgent)"
  stop_service "planning-agent" "$(read_port planningAgent)"
}

require_config() {
  if [ ! -f "$CONFIG_PATH" ]; then
    echo "Missing local launch config: $CONFIG_PATH"
    exit 1
  fi
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
    echo "Usage: ./scripts/launch-all.sh <start|stop>"
    exit 1
    ;;
esac
