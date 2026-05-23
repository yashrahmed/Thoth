#!/bin/sh

set -eu

CREDENTIALS_FILE="${THOTH_DEV_SECRETS_FILE:-$HOME/.thoth/dev-secrets.env}"
CONV_AGENT_URL="${CONV_AGENT_URL:-https://thoth-dev.bots-ns.com/api/v1}"

read_env_value() {
  key="$1"
  file="$2"

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

if [ ! -f "$CREDENTIALS_FILE" ]; then
  echo "Missing credentials file: $CREDENTIALS_FILE" >&2
  exit 1
fi

CF_ACCESS_CLIENT_ID="$(read_env_value "CF_ACCESS_CLIENT_ID" "$CREDENTIALS_FILE")"
CF_ACCESS_CLIENT_SECRET="$(read_env_value "CF_ACCESS_CLIENT_SECRET" "$CREDENTIALS_FILE")"

if [ -z "$CF_ACCESS_CLIENT_ID" ]; then
  echo "Missing CF_ACCESS_CLIENT_ID in $CREDENTIALS_FILE" >&2
  exit 1
fi

if [ -z "$CF_ACCESS_CLIENT_SECRET" ]; then
  echo "Missing CF_ACCESS_CLIENT_SECRET in $CREDENTIALS_FILE" >&2
  exit 1
fi

echo "Testing Cloudflare Access service-token auth for $CONV_AGENT_URL/health"

response_headers="$(mktemp)"
response_body="$(mktemp)"
trap 'rm -f "$response_headers" "$response_body"' EXIT

status="$(
  curl -sS \
    -D "$response_headers" \
    -o "$response_body" \
    -w '%{http_code}' \
    -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
    -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
    "$CONV_AGENT_URL/health"
)"

echo "HTTP status: $status"

if [ "$status" -ge 300 ] && [ "$status" -lt 400 ]; then
  location="$(sed -n 's/^[Ll]ocation: //p' "$response_headers" | tr -d '\r' | head -n 1)"
  echo "Unexpected redirect. Location: $location" >&2
  exit 1
fi

cat "$response_body"
printf '\n'
