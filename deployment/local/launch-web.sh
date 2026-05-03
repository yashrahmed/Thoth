#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
CREDENTIALS_DIR="$HOME/.thoth"
DEFAULT_PROFILE="local"
PROFILE="$DEFAULT_PROFILE"
WEB_PACKAGE_DIR="$REPO_ROOT/packages/web"
LOCAL_CONV_AGENT_URL="http://127.0.0.1:3001"
DEV_CONV_AGENT_URL="https://conv-agent.yashrahmed.workers.dev"
CONV_AGENT_TARGET=""

if [ "${1:-}" != "" ] && [ "${1#-}" = "$1" ]; then
  PROFILE="$1"
  shift
fi

case "$PROFILE" in
  local)
    CONV_AGENT_TARGET="$LOCAL_CONV_AGENT_URL"
    ;;
  dev)
    CONV_AGENT_TARGET="$DEV_CONV_AGENT_URL"
    ;;
  *)
    echo "Unsupported profile: $PROFILE" >&2
    echo "Usage: ./deployment/local/launch-web.sh [profile=${DEFAULT_PROFILE}] [vite args...]" >&2
    echo "Supported profiles: local, dev" >&2
    exit 1
    ;;
esac

CREDS_FILE="$CREDENTIALS_DIR/$PROFILE-secrets.env"

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

if [ ! -f "$CREDS_FILE" ]; then
  echo "Missing credentials file: $CREDS_FILE." >&2
  echo "Create it from deployment/local/local-secrets.env.example for local, or create ~/.thoth/dev-secrets.env for dev." >&2
  exit 1
fi

bearer_token="$(read_secret_value "TEMP_BEARER_TOKEN" "$CREDS_FILE")"

if [ -z "$bearer_token" ]; then
  echo "Missing TEMP_BEARER_TOKEN in $CREDS_FILE." >&2
  exit 1
fi

export CONV_AGENT_BEARER_TOKEN="$bearer_token"
export CONV_AGENT_URL="$CONV_AGENT_TARGET"
export VITE_CONV_AGENT_URL="/api"
export VITE_THOTH_PROFILE="$PROFILE"

echo "Starting web UI with profile '$PROFILE'."
echo "Proxying $VITE_CONV_AGENT_URL -> $CONV_AGENT_URL"

cd "$WEB_PACKAGE_DIR"
exec bun run dev -- "$@"
