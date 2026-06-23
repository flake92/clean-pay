#!/usr/bin/env sh
set -eu

BASE_URL="${BASE_URL:-http://127.0.0.1:4001}"
EMAIL="${SMOKE_EMAIL:-smoke-$(date +%s)@example.com}"
PASSWORD="${SMOKE_PASSWORD:-password}"
TMP_DIR="${TMPDIR:-/tmp}/clean-pay-smoke"
mkdir -p "$TMP_DIR"

request() {
  method="$1"
  path="$2"
  expected="$3"
  shift 3
  status=$(curl -s -o "$TMP_DIR/response.json" -w "%{http_code}" -X "$method" "$BASE_URL$path" "$@")
  if [ "$status" != "$expected" ]; then
    echo "Expected $method $path to return $expected, got $status" >&2
    cat "$TMP_DIR/response.json" >&2 || true
    exit 1
  fi
}

echo "Smoke target: $BASE_URL"
request GET /api/health 200

printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD" > "$TMP_DIR/login.json"
status=$(curl -s -o "$TMP_DIR/login-response.json" -w "%{http_code}" -c "$TMP_DIR/cookies.txt" -H 'content-type: application/json' --data-binary "@$TMP_DIR/login.json" "$BASE_URL/api/bff/auth/login")
if [ "$status" != "200" ]; then
  echo "Login failed with $status" >&2
  cat "$TMP_DIR/login-response.json" >&2 || true
  exit 1
fi

status=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMP_DIR/cookies.txt" "$BASE_URL/cabinet")
if [ "$status" != "200" ]; then
  echo "Cabinet failed with $status" >&2
  exit 1
fi

login_html=$(curl -s "$BASE_URL/login")
css_path=$(printf "%s" "$login_html" | sed -n 's/.*href="\([^"?]*_next\/static\/chunks\/[^"?]*\.css\)".*/\1/p' | head -n 1)
if [ -z "$css_path" ]; then
  echo "Could not find bundled CSS path on login page" >&2
  exit 1
fi
request GET "$css_path" 200
request GET /api/health/readiness 200 -b "$TMP_DIR/cookies.txt"

echo "Smoke passed"
