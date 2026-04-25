#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
LAUNCH="$SCRIPT_DIR/launch-all.sh"
WORKER_PORT=3001

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
