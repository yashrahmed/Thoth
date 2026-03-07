#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="/tmp/thoth-local"
LOG_DIR="$STATE_DIR/logs"
CONFIG_PATH="$REPO_ROOT/config/local.launch.yaml"
COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
  echo "Usage: ./scripts/launch-all-local.sh <start|stop>"
  exit 1
fi

mkdir -p "$LOG_DIR"

read_port() {
  port_key="$1"
  awk -v key="$port_key" '$1 == key ":" { print $2 }' "$CONFIG_PATH"
}

start_service() {
  service_name="$1"
  package_name="$2"
  service_command="$3"
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

  if [ ! -f "$pid_file" ]; then
    echo "$service_name is not running."
    return
  fi

  pid="$(cat "$pid_file")"

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    wait "$pid" 2>/dev/null || true
    echo "Stopped $service_name."
  else
    fallback_pids="$(lsof -ti tcp:"$service_port" || true)"
    if [ -n "$fallback_pids" ]; then
      kill $fallback_pids
      echo "Stopped $service_name via port $service_port."
    else
      echo "$service_name pid file was stale."
    fi
  fi

  rm -f "$pid_file"
}

case "$COMMAND" in
  start)
    if [ ! -f "$CONFIG_PATH" ]; then
      echo "Missing local launch config: $CONFIG_PATH"
      exit 1
    fi

    start_service "message-proxy" "@thoth/message-proxy" "start"
    start_service "conv-agent" "@thoth/agents" "start:conv-agent"
    start_service "kb-curate-agent" "@thoth/agents" "start:kb-curate-agent"
    start_service "planning-agent" "@thoth/agents" "start:planning-agent"
    ;;
  stop)
    stop_service "message-proxy" "$(read_port proxy)"
    stop_service "conv-agent" "$(read_port convAgent)"
    stop_service "kb-curate-agent" "$(read_port kbCurateAgent)"
    stop_service "planning-agent" "$(read_port planningAgent)"
    ;;
  *)
    echo "Unsupported command: $COMMAND"
    echo "Usage: ./scripts/launch-all-local.sh <start|stop>"
    exit 1
    ;;
esac
