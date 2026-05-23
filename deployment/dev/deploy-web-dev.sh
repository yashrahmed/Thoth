#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
WRANGLER_CONFIG_FILE="$SCRIPT_DIR/wrangler-web-dev.toml"
WEB_PACKAGE_DIR="$REPO_ROOT/packages/web"
COMMAND="${1:-}"

usage() {
  echo "Usage: ./deployment/dev/deploy-web-dev.sh <deploy|teardown>"
}

if [ -z "$COMMAND" ]; then
  usage
  exit 1
fi

ensure_wrangler_config() {
  if [ ! -f "$WRANGLER_CONFIG_FILE" ]; then
    echo "Missing Wrangler config file: $WRANGLER_CONFIG_FILE." >&2
    exit 1
  fi
}

ensure_logged_in() {
  if bun x wrangler whoami >/dev/null 2>&1; then
    return
  fi

  echo "Wrangler is not authenticated. Launching browser login..."
  bun x wrangler login
}

build_web() {
  echo "Building web UI for dev..."
  cd "$WEB_PACKAGE_DIR"
  export VITE_THOTH_API_URL="/api/v1"
  export VITE_THOTH_PROFILE="dev"
  bun run build
}

deploy_web() {
  echo "Deploying web UI Worker..."
  cd "$WEB_PACKAGE_DIR"
  bun x wrangler deploy --config "$WRANGLER_CONFIG_FILE"
}

teardown_web() {
  echo "Deleting web UI Worker..."
  cd "$WEB_PACKAGE_DIR"
  bun x wrangler delete --config "$WRANGLER_CONFIG_FILE"
}

case "$COMMAND" in
  deploy)
    ensure_wrangler_config
    ensure_logged_in
    build_web
    deploy_web
    echo "Deploy complete."
    ;;
  teardown)
    ensure_wrangler_config
    ensure_logged_in
    teardown_web
    echo "Teardown complete."
    ;;
  *)
    usage
    exit 1
    ;;
esac
