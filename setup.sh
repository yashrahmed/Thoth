#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="22.12.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_ROOT="$SCRIPT_DIR"
LOCAL_STATE_DIR="$LOCAL_ROOT/openclaw-state"
LOCAL_WORKSPACE_DIR="$LOCAL_ROOT/workspace"

# Load nvm for non-interactive shell execution.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$NVM_DIR/nvm.sh"
else
  echo "nvm not found at $NVM_DIR/nvm.sh"
  exit 1
fi

nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"

mkdir -p "$LOCAL_STATE_DIR" "$LOCAL_WORKSPACE_DIR"

cd "$ROOT_DIR"
OPENCLAW_STATE_DIR="$LOCAL_STATE_DIR" node openclaw.mjs setup --workspace "$LOCAL_WORKSPACE_DIR"
OPENCLAW_STATE_DIR="$LOCAL_STATE_DIR" node openclaw.mjs config set gateway.mode '"local"' --json
OPENCLAW_STATE_DIR="$LOCAL_STATE_DIR" node openclaw.mjs config set gateway.bind '"loopback"' --json
