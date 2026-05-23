#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
CREDENTIALS_DIR="$HOME/.thoth"
PROFILE="dev"
CREDS_FILE="$CREDENTIALS_DIR/$PROFILE-secrets.env"
WRANGLER_CONFIG_FILE="$SCRIPT_DIR/wrangler-server-dev.toml"
WORKER_PACKAGE_DIR="$REPO_ROOT/packages/conv-agent"
COMMAND="${1:-}"

CONV_AGENT_REQUIRED_SECRETS="BLOB_STORAGE_ACCESS_KEY_ID BLOB_STORAGE_SECRET_ACCESS_KEY LLM_API_KEY ALLOWED_USER_EMAILS ALLOWED_SERVICE_TOKEN_CLIENT_IDS"

usage() {
  echo "Usage: ./deployment/dev/deploy-server-dev.sh <deploy|teardown>"
}

if [ -z "$COMMAND" ]; then
  usage
  exit 1
fi

get_env_value() {
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

ensure_wrangler_config() {
  if [ ! -f "$WRANGLER_CONFIG_FILE" ]; then
    echo "Missing Wrangler config file: $WRANGLER_CONFIG_FILE." >&2
    exit 1
  fi
}

ensure_deploy_inputs() {
  ensure_wrangler_config

  if [ ! -f "$CREDS_FILE" ]; then
    echo "Missing credentials file: $CREDS_FILE." >&2
    exit 1
  fi

  for secret_name in $CONV_AGENT_REQUIRED_SECRETS; do
    secret_value="$(get_env_value "$secret_name" "$CREDS_FILE")"
    if [ -z "$secret_value" ]; then
      echo "Missing $secret_name in $CREDS_FILE." >&2
      exit 1
    fi
  done
}

ensure_logged_in() {
  if bun x wrangler whoami >/dev/null 2>&1; then
    return
  fi

  echo "Wrangler is not authenticated. Launching browser login..."
  bun x wrangler login
}

deploy_worker() {
  echo "Deploying conv-agent Worker..."
  cd "$WORKER_PACKAGE_DIR"
  bun x wrangler deploy --config "$WRANGLER_CONFIG_FILE"
}

upload_conv_agent_secrets() {
  cd "$WORKER_PACKAGE_DIR"

  for secret_name in $CONV_AGENT_REQUIRED_SECRETS; do
    secret_value="$(get_env_value "$secret_name" "$CREDS_FILE")"
    echo "Uploading conv-agent secret: $secret_name"
    printf '%s' "$secret_value" | bun x wrangler secret put "$secret_name" --config "$WRANGLER_CONFIG_FILE"
  done
}

read_toml_string() {
  key="$1"
  file="$2"
  sed -n "s/^${key} = \"\\(.*\\)\"/\\1/p" "$file" | head -n 1
}

read_hyperdrive_id() {
  awk '
    /^\[\[hyperdrive\]\]/ { in_block = 1; next }
    /^\[/ { in_block = 0 }
    in_block && /^id = / {
      sub(/^id = "/, "")
      sub(/"$/, "")
      print
      exit
    }
  ' "$1"
}

smoke_test_dependencies() {
  echo "Smoke testing Cloudflare dependencies..."

  hyperdrive_id="$(read_hyperdrive_id "$WRANGLER_CONFIG_FILE")"
  bucket_name="$(read_toml_string "BLOB_STORAGE_BUCKET" "$WRANGLER_CONFIG_FILE")"

  if [ -z "$hyperdrive_id" ] || [ -z "$bucket_name" ]; then
    echo "Could not parse dependency identifiers from $WRANGLER_CONFIG_FILE." >&2
    exit 1
  fi

  cd "$WORKER_PACKAGE_DIR"

  if ! bun x wrangler hyperdrive list --config "$WRANGLER_CONFIG_FILE" 2>/dev/null | grep -q "$hyperdrive_id"; then
    echo "Hyperdrive config $hyperdrive_id not found on this Cloudflare account." >&2
    exit 1
  fi
  echo "  Hyperdrive: $hyperdrive_id ok"

  if ! bun x wrangler r2 bucket list --config "$WRANGLER_CONFIG_FILE" 2>/dev/null | grep -q "$bucket_name"; then
    echo "R2 bucket $bucket_name not found on this Cloudflare account." >&2
    exit 1
  fi
  echo "  R2 bucket: $bucket_name ok"
}

teardown_worker() {
  echo "Deleting conv-agent Worker (Hyperdrive and R2 bindings are left intact)..."
  cd "$WORKER_PACKAGE_DIR"
  bun x wrangler delete --config "$WRANGLER_CONFIG_FILE"
}

case "$COMMAND" in
  deploy)
    ensure_deploy_inputs
    ensure_logged_in
    smoke_test_dependencies
    deploy_worker
    upload_conv_agent_secrets
    echo "Deploy complete."
    ;;
  teardown)
    ensure_wrangler_config
    ensure_logged_in
    teardown_worker
    echo "Teardown complete."
    ;;
  *)
    usage
    exit 1
    ;;
esac
