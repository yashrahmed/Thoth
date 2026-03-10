#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="/tmp/thoth-local"
LOG_DIR="$STATE_DIR/logs"
CONFIG_PATH="$REPO_ROOT/config/local.launch.yaml"
RUNTIME_CONFIG_PATH="$STATE_DIR/local.launch.yaml"
KEYS_CONFIG_PATH="$REPO_ROOT/keys-config.yml"
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

read_key_config_value() {
  key_name="$1"
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
  ' "$KEYS_CONFIG_PATH"
}

write_runtime_config() {
  llm_api_key="$1"

  awk -v llm_api_key="$llm_api_key" '
    BEGIN {
      updated = 0
    }
    $1 == "LLM_API_KEY:" {
      print "LLM_API_KEY: \"" llm_api_key "\""
      updated = 1
      next
    }
    {
      print
    }
    END {
      if (!updated) {
        print ""
        print "LLM_API_KEY: \"" llm_api_key "\""
      }
    }
  ' "$CONFIG_PATH" >"$RUNTIME_CONFIG_PATH"
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
    export CONFIG_FILE="$RUNTIME_CONFIG_PATH"
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

    if [ ! -f "$KEYS_CONFIG_PATH" ]; then
      echo "Missing keys config: $KEYS_CONFIG_PATH"
      exit 1
    fi

    LLM_API_KEY="$(read_key_config_value OPENAI_API_KEY)"

    if [ -z "$LLM_API_KEY" ]; then
      echo "Missing OPENAI_API_KEY in $KEYS_CONFIG_PATH"
      exit 1
    fi

    write_runtime_config "$LLM_API_KEY"

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
    rm -f "$RUNTIME_CONFIG_PATH"
    ;;
  *)
    echo "Unsupported command: $COMMAND"
    echo "Usage: ./scripts/launch-all-local.sh <start|stop>"
    exit 1
    ;;
esac
