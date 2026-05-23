#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_PROFILE="dev"
PROFILE="$DEFAULT_PROFILE"
WEB_PACKAGE_DIR="$REPO_ROOT/packages/web"
DEV_CONV_AGENT_URL="https://thoth-dev.bots-ns.com/api/v1"
CONV_AGENT_TARGET=""

if [ "${1:-}" != "" ] && [ "${1#-}" = "$1" ]; then
  PROFILE="$1"
  shift
fi

case "$PROFILE" in
  local)
    echo "Local profile is not supported for the web UI." >&2
    echo "proxy-server has been removed and conv-agent runs unauthenticated locally;" >&2
    echo "the web app cannot complete a Cloudflare Access login against localhost." >&2
    echo "Run with the 'dev' profile to point the local UI at the deployed Cloudflare-Access-protected backend:" >&2
    echo "  ./deployment/local/launch-web.sh dev" >&2
    exit 1
    ;;
  dev)
    CONV_AGENT_TARGET="$DEV_CONV_AGENT_URL"
    ;;
  *)
    echo "Unsupported profile: $PROFILE" >&2
    echo "Usage: ./deployment/local/launch-web.sh [profile=${DEFAULT_PROFILE}] [vite args...]" >&2
    echo "Supported profiles: dev" >&2
    exit 1
    ;;
esac

export VITE_THOTH_API_URL="$CONV_AGENT_TARGET"
export VITE_THOTH_PROFILE="$PROFILE"

echo "Starting web UI with profile '$PROFILE'."
echo "Calling conv-agent at $VITE_THOTH_API_URL (no Vite proxy; browser sends CF_Authorization cookie cross-origin)."

cd "$WEB_PACKAGE_DIR"
exec bunx vite "$@"
