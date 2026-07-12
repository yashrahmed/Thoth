#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$HOME/.thoth/llm-test-secrets.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
if ! . "$ENV_FILE"; then
  echo "Failed to load env file: $ENV_FILE" >&2
  exit 1
fi
set +a

cd "$REPO_ROOT"
bun test --timeout 180000 packages/conv-agent/src/system-tests/temporal-tools-st.test.ts
