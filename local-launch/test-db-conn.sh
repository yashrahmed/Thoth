#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
PACKAGE_DIR="$REPO_ROOT/packages/conv-agent"

DATABASE_URL_VALUE="postgresql://Thoth_App_Role:3df9a7944036479e9c5560b07102739fa2e046424472a34a@ep-rough-darkness-anhkaflo.c-6.us-east-1.aws.neon.tech/Thoth-db-dev?sslmode=require&channel_binding=require"

if [ "$DATABASE_URL_VALUE" = "" ]; then
  echo "Usage: ./local-launch/test-db-conn.sh <postgres-connection-string>"
  echo "Or set DATABASE_URL in the environment."
  exit 1
fi

export DATABASE_URL="$DATABASE_URL_VALUE"

cd "$PACKAGE_DIR"

bun run db:test:connection
