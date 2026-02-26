#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="22.12.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOP_LEVEL_PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load nvm for non-interactive shell execution.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$NVM_DIR/nvm.sh"
else
  echo "nvm not found at $NVM_DIR/nvm.sh"
  exit 1
fi

# 1) Use required Node version
nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"
node -v

# 2) Enable pnpm (via Corepack)
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm -v

# 3) From repo root
cd "$TOP_LEVEL_PROJECT_DIR"

# 4) Install deps
pnpm install

# 5) Build UI + core dist
pnpm ui:build
pnpm build
