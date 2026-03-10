#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="/tmp/thoth-local"
LOG_DIR="$STATE_DIR/logs"
CONFIG_PATH="$REPO_ROOT/config/launch.yaml"
LLM_CREDS_PATH="$REPO_ROOT/config/llm-creds.yaml"
CLOUDFLARE_CREDS_PATH="$REPO_ROOT/config/cloudflare-creds.yaml"
DB_CREDS_PATH="$REPO_ROOT/config/db-creds.yaml"
COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
  echo "Usage: ./scripts/launch-all-servers-local.sh <start|stop>"
  exit 1
fi

mkdir -p "$LOG_DIR"

read_port() {
  port_key="$1"
  awk -v key="$port_key" '$1 == key ":" { print $2 }' "$CONFIG_PATH"
}

read_yaml_value() {
  config_path="$1"
  key_name="$2"
  awk -v key="$key_name" '
    $1 == key ":" {
      value = substr($0, index($0, ":") + 1)
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)

      if (value ~ /^".*"$/) {
        value = substr(value, 2, length(value) - 2)
      } else if (value ~ /^'\''.*'\''$/) {
        value = substr(value, 2, length(value) - 2)
      }

      print value
      exit
    }
  ' "$config_path"
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

    if [ ! -f "$LLM_CREDS_PATH" ]; then
      echo "Missing LLM creds config: $LLM_CREDS_PATH"
      exit 1
    fi

    if [ ! -f "$CLOUDFLARE_CREDS_PATH" ]; then
      echo "Missing Cloudflare creds config: $CLOUDFLARE_CREDS_PATH"
      exit 1
    fi

    if [ ! -f "$DB_CREDS_PATH" ]; then
      echo "Missing DB creds config: $DB_CREDS_PATH"
      exit 1
    fi

    OPENAI_API_KEY="$(read_yaml_value "$LLM_CREDS_PATH" OPENAI_API_KEY)"
    R2_ACCESS_KEY_ID="$(read_yaml_value "$CLOUDFLARE_CREDS_PATH" R2_ACCESS_KEY_ID)"
    R2_SECRET_ACCESS_KEY="$(read_yaml_value "$CLOUDFLARE_CREDS_PATH" R2_SECRET_ACCESS_KEY)"
    CONV_STORE_DB_HOST="$(read_yaml_value "$DB_CREDS_PATH" CONV_STORE_DB_HOST)"
    CONV_STORE_DB_PORT="$(read_yaml_value "$DB_CREDS_PATH" CONV_STORE_DB_PORT)"
    CONV_STORE_DB_NAME="$(read_yaml_value "$DB_CREDS_PATH" CONV_STORE_DB_NAME)"
    CONV_STORE_DB_USER="$(read_yaml_value "$DB_CREDS_PATH" CONV_STORE_DB_USER)"
    CONV_STORE_DB_PASSWORD="$(read_yaml_value "$DB_CREDS_PATH" CONV_STORE_DB_PASSWORD)"
    CONV_STORE_DB_SSL="$(read_yaml_value "$DB_CREDS_PATH" CONV_STORE_DB_SSL)"

    if [ -z "$OPENAI_API_KEY" ]; then
      echo "Missing OPENAI_API_KEY in $LLM_CREDS_PATH"
      exit 1
    fi

    if [ -z "$R2_ACCESS_KEY_ID" ]; then
      echo "Missing R2_ACCESS_KEY_ID in $CLOUDFLARE_CREDS_PATH"
      exit 1
    fi

    if [ -z "$R2_SECRET_ACCESS_KEY" ]; then
      echo "Missing R2_SECRET_ACCESS_KEY in $CLOUDFLARE_CREDS_PATH"
      exit 1
    fi

    if [ -z "$CONV_STORE_DB_HOST" ]; then
      echo "Missing CONV_STORE_DB_HOST in $DB_CREDS_PATH"
      exit 1
    fi

    if [ -z "$CONV_STORE_DB_PORT" ]; then
      echo "Missing CONV_STORE_DB_PORT in $DB_CREDS_PATH"
      exit 1
    fi

    if [ -z "$CONV_STORE_DB_NAME" ]; then
      echo "Missing CONV_STORE_DB_NAME in $DB_CREDS_PATH"
      exit 1
    fi

    if [ -z "$CONV_STORE_DB_USER" ]; then
      echo "Missing CONV_STORE_DB_USER in $DB_CREDS_PATH"
      exit 1
    fi

    if [ -z "$CONV_STORE_DB_PASSWORD" ]; then
      echo "Missing CONV_STORE_DB_PASSWORD in $DB_CREDS_PATH"
      exit 1
    fi

    if [ -z "$CONV_STORE_DB_SSL" ]; then
      echo "Missing CONV_STORE_DB_SSL in $DB_CREDS_PATH"
      exit 1
    fi

    export OPENAI_API_KEY
    export R2_ACCESS_KEY_ID
    export R2_SECRET_ACCESS_KEY
    export CONV_STORE_DB_HOST
    export CONV_STORE_DB_PORT
    export CONV_STORE_DB_NAME
    export CONV_STORE_DB_USER
    export CONV_STORE_DB_PASSWORD
    export CONV_STORE_DB_SSL

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
    echo "Usage: ./scripts/launch-all-servers-local.sh <start|stop>"
    exit 1
    ;;
esac
