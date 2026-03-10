#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="/tmp/thoth-local"
LOG_DIR="$STATE_DIR/logs"
CONFIG_PATH="$REPO_ROOT/config/local.launch.yaml"
RUNTIME_CONFIG_PATH="$STATE_DIR/local.launch.yaml"
LLM_CREDS_PATH="$REPO_ROOT/llm-creds.yaml"
CLOUDFLARE_CREDS_PATH="$REPO_ROOT/cloudflare-creds.yaml"
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

write_runtime_config() {
  cp "$CONFIG_PATH" "$RUNTIME_CONFIG_PATH"
}

start_service() {
  service_name="$1"
  package_name="$2"
  service_command="$3"
  openai_api_key="$4"
  r2_access_key_id="$5"
  r2_secret_access_key="$6"
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
    export CONFIG_FILE="$RUNTIME_CONFIG_PATH"
    export OPENAI_API_KEY="$openai_api_key"
    export R2_ACCESS_KEY_ID="$r2_access_key_id"
    export R2_SECRET_ACCESS_KEY="$r2_secret_access_key"
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

    OPENAI_API_KEY="$(read_yaml_value "$LLM_CREDS_PATH" OPENAI_API_KEY)"
    R2_ACCESS_KEY_ID="$(read_yaml_value "$CLOUDFLARE_CREDS_PATH" R2_ACCESS_KEY_ID)"
    R2_SECRET_ACCESS_KEY="$(read_yaml_value "$CLOUDFLARE_CREDS_PATH" R2_SECRET_ACCESS_KEY)"

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

    write_runtime_config

    start_service "message-proxy" "@thoth/message-proxy" "start" "$OPENAI_API_KEY" "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY"
    start_service "conv-agent" "@thoth/agents" "start:conv-agent" "$OPENAI_API_KEY" "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY"
    start_service "kb-curate-agent" "@thoth/agents" "start:kb-curate-agent" "$OPENAI_API_KEY" "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY"
    start_service "planning-agent" "@thoth/agents" "start:planning-agent" "$OPENAI_API_KEY" "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY"
    ;;
  stop)
    stop_service "message-proxy" "$(read_port proxy)"
    stop_service "conv-agent" "$(read_port convAgent)"
    stop_service "kb-curate-agent" "$(read_port kbCurateAgent)"
    stop_service "planning-agent" "$(read_port planningAgent)"
    rm -f "$RUNTIME_CONFIG_PATH"
    ;;
  *)
    echo "Unsupported command: $COMMAND"
    echo "Usage: ./scripts/launch-all-local.sh <start|stop>"
    exit 1
    ;;
esac
