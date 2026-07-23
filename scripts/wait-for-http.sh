#!/usr/bin/env bash
set -euo pipefail

url="${1:?Usage: wait-for-http.sh URL [timeout_seconds] [step_name] [method]}"
timeout_seconds="${2:-120}"
step_name="${3:-HTTP readiness}"
method="${4:-GET}"
deadline=$((SECONDS + timeout_seconds))
last_status="000"
body_file="$(mktemp)"
error_file="$(mktemp)"

cleanup() {
  rm -f "$body_file" "$error_file"
}

trap cleanup EXIT

while (( SECONDS < deadline )); do
  last_status="$(curl -fsS -X "$method" -o "$body_file" -w '%{http_code}' "$url" 2>"$error_file" || true)"

  if [[ "$last_status" =~ ^[23][0-9][0-9]$ ]]; then
    exit 0
  fi

  sleep 2
done

echo "Timed out waiting for HTTP endpoint" >&2
echo "Step: $step_name" >&2
echo "Method: $method" >&2
echo "URL: $url" >&2
echo "Last status: $last_status" >&2
if [[ -s "$error_file" ]]; then
  echo "Curl error:" >&2
  cat "$error_file" >&2
fi
if [[ -s "$body_file" ]]; then
  echo "Response body:" >&2
  head -c 4000 "$body_file" >&2
  echo >&2
fi
exit 1
