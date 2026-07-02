#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$root_dir/.devcontainer/docker-compose.yml"
host_devcontainer_dir="${CLEAN_PAY_HOST_DEVCONTAINER_DIR:-}"

project="${CLEAN_PAY_DEVCONTAINER_PROJECT:-clean-pay-dev}"
base_url="${CLEAN_PAY_E2E_BASE_URL:-http://localhost:4000}"
mailpit_default_url="http://localhost:8025"
oidc_default_url="http://localhost:8090"

if [[ "$root_dir" =~ ^/workspace/clean-pay$ ]]; then
  mailpit_default_url="http://smtp:8025"
  oidc_default_url="http://telegram-oidc-mock:8090"
fi

mailpit_url="${CLEAN_PAY_E2E_MAILPIT_URL:-$mailpit_default_url}"
oidc_url="${CLEAN_PAY_E2E_OIDC_URL:-$oidc_default_url}"
next_pid=""
current_step="startup"

services=(
  postgres
  redis
  remnashop
  remnashop-worker
  remnashop-scheduler
  remnawave-mock
  telegram-mock
  telegram-oidc-mock
  smtp
  smtp-log
)

log_step() {
  current_step="$1"
  printf '\n== %s ==\n' "$1"
}

compose() {
  docker compose -p "$project" -f "$compose_file" "$@"
}

is_valid_host_devcontainer_dir() {
  local candidate="$1"

  docker run --rm -v "$candidate/telegram-oidc-mock:/mock:ro" node:24-alpine ls /mock/server.js >/dev/null 2>&1
}

workspace_mount_sources() {
  docker inspect "$(hostname)" --format '{{json .Mounts}}' 2>/dev/null \
    | node -e '
      let input = "";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => {
        if (!input.trim()) return;
        for (const mount of JSON.parse(input)) {
          if (mount.Destination === "/workspace/clean-pay" && mount.Source) {
            console.log(mount.Source);
          }
        }
      });
    ' 2>/dev/null || true
}

host_workspace_candidates() {
  local source="$1"
  local drive rest

  printf '%s\n' "$source"

  if [[ "$source" =~ ^([A-Za-z]):\\(.*)$ ]]; then
    drive="$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
    rest="${BASH_REMATCH[2]//\\//}"
    printf '/host_mnt/%s/%s\n' "$drive" "$rest"
    printf '/run/desktop/mnt/host/%s/%s\n' "$drive" "$rest"
    printf '/%s/%s\n' "$drive" "$rest"
  fi
}

detect_host_devcontainer_dir() {
  local source candidate

  if [[ -n "$host_devcontainer_dir" ]]; then
    if is_valid_host_devcontainer_dir "$host_devcontainer_dir"; then
      return 0
    fi

    echo "CLEAN_PAY_HOST_DEVCONTAINER_DIR does not expose telegram-oidc-mock/server.js: $host_devcontainer_dir" >&2
    return 1
  fi

  while IFS= read -r source; do
    while IFS= read -r candidate; do
      candidate="$candidate/.devcontainer"

      if is_valid_host_devcontainer_dir "$candidate"; then
        host_devcontainer_dir="$candidate"
        return 0
      fi
    done < <(host_workspace_candidates "$source")
  done < <(workspace_mount_sources)

  return 0
}

print_diagnostics() {
  local exit_code="$1"

  if [[ "$exit_code" -eq 0 ]]; then
    return
  fi

  log_step "e2e diagnostics"
  echo "Exit code: $exit_code"
  echo "Failed step: $current_step"
  echo "Base URL: $base_url"
  echo "Mailpit URL: $mailpit_url"
  echo "OIDC URL: $oidc_url"
  compose ps || true

  for service in app remnashop remnashop-worker remnashop-scheduler smtp smtp-log telegram-oidc-mock remnawave-mock; do
    printf '\n== %s logs ==\n' "$service" >&2
    compose logs --tail=160 "$service" >&2 || true
  done
}

cleanup() {
  local exit_code=$?

  if [[ -n "$next_pid" ]]; then
    kill "$next_pid" >/dev/null 2>&1 || true
    wait "$next_pid" >/dev/null 2>&1 || true
  fi

  print_diagnostics "$exit_code"

  if [[ "${KEEP_E2E_STACK:-0}" != "1" ]]; then
    log_step "Stopping devcontainer compose services"
    compose stop "${services[@]}" || true
  fi

  exit "$exit_code"
}

trap cleanup EXIT

log_step "Checking Docker"
docker version >/dev/null

log_step "Checking Docker Compose"
docker compose version >/dev/null

detect_host_devcontainer_dir

if [[ -n "$host_devcontainer_dir" ]]; then
  export CLEAN_PAY_HOST_DEVCONTAINER_DIR="$host_devcontainer_dir"
fi

if [[ "${RESET_E2E:-0}" == "1" ]]; then
  log_step "Resetting clean-pay-dev compose volumes"
  compose down --remove-orphans --volumes
fi

log_step "Starting devcontainer compose stack"
compose up -d --build "${services[@]}"
"$root_dir/scripts/wait-for-compose.sh" "$project" "$compose_file" 300 "${services[@]}"

log_step "Preparing Clean Pay application"
npm ci
npm run prisma:generate
npx prisma migrate deploy

log_step "Resetting e2e rate-limit counters"
redis-cli -h redis --scan --pattern 'clean-pay:rate-limit:*' | while IFS= read -r key; do
  redis-cli -h redis DEL "$key" >/dev/null
done

log_step "Starting Next.js on 0.0.0.0:4000"
pkill -f "next dev" >/dev/null 2>&1 || true
CLEAN_PAY_E2E_BASE_URL="$base_url" \
CLEAN_PAY_E2E_MAILPIT_URL="$mailpit_url" \
CLEAN_PAY_E2E_OIDC_URL="$oidc_url" \
npm run dev -- --hostname 0.0.0.0 --port 4000 &
next_pid="$!"

"$root_dir/scripts/wait-for-http.sh" "$base_url/api/health" 180 "Wait for Clean Pay health" "GET"
"$root_dir/scripts/wait-for-http.sh" "$mailpit_url/api/v1/messages" 60 "Wait for Mailpit API" "GET"
"$root_dir/scripts/wait-for-http.sh" "$oidc_url/.well-known/jwks.json" 60 "Wait for Telegram OIDC JWKS" "GET"

log_step "Running full-stack e2e tests"
CLEAN_PAY_E2E_BASE_URL="$base_url" \
CLEAN_PAY_E2E_MAILPIT_URL="$mailpit_url" \
CLEAN_PAY_E2E_OIDC_URL="$oidc_url" \
npx vitest run --config "$root_dir/vitest.e2e.config.ts"
