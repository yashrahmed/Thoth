#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_PROFILE="local"
PROFILE="$DEFAULT_PROFILE"
WEB_PACKAGE_DIR="$REPO_ROOT/packages/web"
LOCAL_PROXY_SERVER_URL="http://127.0.0.1:8788"
DEV_PROXY_SERVER_URL="https://proxy-server.yashrahmed.workers.dev"
PROXY_SERVER_TARGET=""

if [ "${1:-}" != "" ] && [ "${1#-}" = "$1" ]; then
  PROFILE="$1"
  shift
fi

case "$PROFILE" in
  local)
    PROXY_SERVER_TARGET="$LOCAL_PROXY_SERVER_URL"
    ;;
  dev)
    PROXY_SERVER_TARGET="$DEV_PROXY_SERVER_URL"
    ;;
  *)
    echo "Unsupported profile: $PROFILE" >&2
    echo "Usage: ./deployment/local/launch-web.sh [profile=${DEFAULT_PROFILE}] [vite args...]" >&2
    echo "Supported profiles: local, dev" >&2
    exit 1
    ;;
esac

export THOTH_PROXY_URL="$PROXY_SERVER_TARGET"
export VITE_THOTH_API_URL="/api"
export VITE_THOTH_PROFILE="$PROFILE"

echo "Starting web UI with profile '$PROFILE'."
echo "Proxying $VITE_THOTH_API_URL and /auth -> $THOTH_PROXY_URL"

cd "$WEB_PACKAGE_DIR"
exec bunx vite "$@"
