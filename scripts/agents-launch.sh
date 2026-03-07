#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

cleanup() {
  kill "$CONV_AGENT_PID" "$KB_CURATE_AGENT_PID" "$PLANNING_AGENT_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

(
  cd "$REPO_ROOT"
  bun run --filter @thoth/agents start:conv-agent
) &
CONV_AGENT_PID=$!

(
  cd "$REPO_ROOT"
  bun run --filter @thoth/agents start:kb-curate-agent
) &
KB_CURATE_AGENT_PID=$!

(
  cd "$REPO_ROOT"
  bun run --filter @thoth/agents start:planning-agent
) &
PLANNING_AGENT_PID=$!

wait "$CONV_AGENT_PID" "$KB_CURATE_AGENT_PID" "$PLANNING_AGENT_PID"
