#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
LAUNCH="$SCRIPT_DIR/launch-all.sh"
WORKER_PORT=3001
LOCAL_SECRETS_FILE="$HOME/.thoth/local-secrets.env"

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

bearer_token="$(read_secret_value "TEMP_BEARER_TOKEN" "$LOCAL_SECRETS_FILE")"

if [ -z "$bearer_token" ]; then
  echo "Missing TEMP_BEARER_TOKEN in $LOCAL_SECRETS_FILE." >&2
  exit 1
fi

export CONV_AGENT_BEARER_TOKEN="$bearer_token"

cleanup() {
  status=$?
  echo
  echo "Tearing down local stack..."
  "$LAUNCH" stop || true
  exit "$status"
}
trap cleanup EXIT INT TERM

"$LAUNCH" start

attempts=0
while ! curl -sS -o /dev/null -f "http://127.0.0.1:$WORKER_PORT/health"; do
  attempts=$((attempts + 1))

  if [ "$attempts" -ge 60 ]; then
    echo "conv-agent health check did not pass at http://127.0.0.1:$WORKER_PORT/health."
    exit 1
  fi

  sleep 1
done

cd "$REPO_ROOT/packages/conv-agent"
bun test --timeout 180000 src/integration
