#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
CREDENTIALS_DIR="$HOME/.thoth"
DEFAULT_PROFILE="local"
PROFILE="$DEFAULT_PROFILE"
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
    echo "Usage: ./deployment/system-tests/run-system-tests.sh [profile=${DEFAULT_PROFILE}] [bun test args...]" >&2
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

# Dev conv-agent is fronted by Cloudflare Access. The system tests authenticate
# via a CF Access service token; Access mints the JWT that conv-agent verifies.
# Local conv-agent has no Access in front of it and runs without JWT enforcement.
if [ "$PROFILE" = "dev" ]; then
  cf_access_client_id="$(read_secret_value "CF_ACCESS_CLIENT_ID" "$CREDS_FILE")"
  cf_access_client_secret="$(read_secret_value "CF_ACCESS_CLIENT_SECRET" "$CREDS_FILE")"

  if [ -z "$cf_access_client_id" ] || [ -z "$cf_access_client_secret" ]; then
    echo "Missing CF_ACCESS_CLIENT_ID or CF_ACCESS_CLIENT_SECRET in $CREDS_FILE." >&2
    exit 1
  fi

  export CF_ACCESS_CLIENT_ID="$cf_access_client_id"
  export CF_ACCESS_CLIENT_SECRET="$cf_access_client_secret"
fi

export CONV_AGENT_URL="$CONV_AGENT_TARGET"

health_check() {
  if [ "$PROFILE" = "dev" ]; then
    curl -sS -o /dev/null -f \
      -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
      -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
      "$CONV_AGENT_URL/health"
  else
    curl -sS -o /dev/null -f "$CONV_AGENT_URL/health"
  fi
}

attempts=0
while ! health_check; do
  attempts=$((attempts + 1))

  if [ "$attempts" -ge 60 ]; then
    echo "conv-agent health check did not pass at $CONV_AGENT_URL/health."
    exit 1
  fi

  sleep 1
done

echo "Running conv-agent system tests with profile '$PROFILE'."
echo "Target: $CONV_AGENT_URL"

cd "$REPO_ROOT/packages/conv-agent"
bun test --timeout 180000 src/system-tests/conv-agent-st.test.ts "$@"
