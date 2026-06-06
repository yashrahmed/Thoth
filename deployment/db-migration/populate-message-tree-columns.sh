#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
CREDENTIALS_DIR="$HOME/.thoth"
PROFILE="${1:-local}"
BATCH_SIZE="${BATCH_SIZE:-100}"

if [ $# -gt 0 ]; then
  shift
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --batch-size)
      if [ $# -lt 2 ]; then
        echo "Missing value for --batch-size." >&2
        exit 1
      fi
      BATCH_SIZE="$2"
      shift 2
      ;;
    *)
      echo "Unsupported argument: $1" >&2
      echo "Usage: ./deployment/db-migration/populate-message-tree-columns.sh [local|dev] [--batch-size <count>]" >&2
      exit 1
      ;;
  esac
done

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

case "$PROFILE" in
  local)
    ;;
  dev)
    ;;
  *)
    echo "Unsupported profile: $PROFILE" >&2
    echo "Supported profiles: local, dev" >&2
    exit 1
    ;;
esac

CREDS_FILE="$CREDENTIALS_DIR/$PROFILE-secrets.env"
DATABASE_URL="$(get_env_value "MIGRATION_DATABASE_URL" "$CREDS_FILE")"

if [ "$DATABASE_URL" = "" ]; then
  echo "Missing MIGRATION_DATABASE_URL in $CREDS_FILE." >&2
  exit 1
fi

DATABASE_URL="$DATABASE_URL" BATCH_SIZE="$BATCH_SIZE" bun "$SCRIPT_DIR/populate-message-tree-columns.mjs"
