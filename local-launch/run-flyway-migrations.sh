#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
PROFILE="${1:-local}"
CREDS_FILE=""
MIGRATIONS_DIR="$REPO_ROOT/packages/conv-agent/resources/db/migrations"

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

build_flyway_jdbc_url() {
  DATABASE_URL="$1" bun -e '
    const raw = process.env.DATABASE_URL;
    if (!raw) {
      throw new Error("DATABASE_URL is required.");
    }

    const url = new URL(raw);
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      throw new Error(`Unsupported database URL protocol: ${url.protocol}`);
    }

    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      url.hostname = "host.docker.internal";
    }

    const jdbcUrl = new URL(`postgresql://${url.host}${url.pathname}${url.search}`);
    if (url.username.length > 0) {
      jdbcUrl.searchParams.set("user", decodeURIComponent(url.username));
    }
    if (url.password.length > 0) {
      jdbcUrl.searchParams.set("password", decodeURIComponent(url.password));
    }

    process.stdout.write(`jdbc:${jdbcUrl.toString()}`);
  '
}

case "$PROFILE" in
  local)
    CREDS_FILE="$SCRIPT_DIR/local-secrets.env"
    ;;
  dev)
    CREDS_FILE="$SCRIPT_DIR/cloud-dev-secrets.env"
    ;;
  *)
    echo "Unsupported profile: $PROFILE" >&2
    echo "Supported profiles: local, dev" >&2
    exit 1
    ;;
esac

migration_database_url="$(get_env_value "MIGRATION_DATABASE_URL" "$CREDS_FILE")"

if [ "$migration_database_url" = "" ]; then
  echo "Missing MIGRATION_DATABASE_URL in $CREDS_FILE." >&2
  exit 1
fi

flyway_jdbc_url="$(build_flyway_jdbc_url "$migration_database_url")"

docker run --rm \
  --platform linux/amd64 \
  --add-host=host.docker.internal:host-gateway \
  -e FLYWAY_DEFAULT_SCHEMA=flyway \
  -e FLYWAY_SCHEMAS=flyway,thoth \
  -e FLYWAY_LOCATIONS=filesystem:/flyway/sql \
  -e FLYWAY_URL="$flyway_jdbc_url" \
  -v "$MIGRATIONS_DIR:/flyway/sql:ro" \
  redgate/flyway:11-alpine \
  migrate
