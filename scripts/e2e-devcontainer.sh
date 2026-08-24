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
next_log=""
current_step="startup"

services=(
  postgres
  redis
  remnashop
  remnashop-cache
  remnashop-postgres
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

next_port_is_available() {
  node <<'NODE'
const net = require("node:net");
const server = net.createServer();

server.once("error", () => process.exit(1));
server.listen(4000, "0.0.0.0", () => {
  server.close((error) => process.exit(error ? 1 : 0));
});
NODE
}

wait_for_next_port() {
  local deadline=$((SECONDS + 10))

  while (( SECONDS < deadline )); do
    if next_port_is_available; then
      return 0
    fi

    sleep 1
  done

  echo "Port 4000 is already owned by another process; refusing to run E2E against a stale server" >&2
  return 1
}

wait_for_started_next() {
  local timeout_seconds="${NEXT_START_TIMEOUT_SECONDS:-180}"
  local deadline last_status

  if [[ ! "$timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
    echo "NEXT_START_TIMEOUT_SECONDS must be a positive integer" >&2
    return 1
  fi

  deadline=$((SECONDS + timeout_seconds))
  last_status="000"

  while (( SECONDS < deadline )); do
    if ! kill -0 "$next_pid" >/dev/null 2>&1; then
      echo "The Next.js process exited before its health endpoint became ready" >&2
      return 1
    fi

    last_status="$(
      curl -fsS -o /dev/null -w '%{http_code}' \
        --connect-timeout 2 \
        --max-time 5 \
        "$base_url/api/health" 2>/dev/null || true
    )"

    if [[ "$last_status" =~ ^[23][0-9][0-9]$ ]]; then
      echo "Next.js health endpoint is ready (HTTP $last_status)"
      return 0
    fi

    echo "Waiting for Next.js health endpoint (last HTTP status: $last_status)"
    sleep 2
  done

  echo "Timed out waiting for the newly started Next.js process" >&2
  echo "URL: $base_url/api/health" >&2
  echo "Last status: $last_status" >&2
  return 1
}

warm_next_routes() {
  local route

  # Turbopack compiles routes lazily in development. Warm the public pages so
  # cold CI workers test HTTP behavior rather than contend with first-compile
  # latency inside an individual Vitest timeout.
  for route in /login /register /tariffs /support; do
    echo "Warming Next.js route: $route"
    curl --fail --silent --show-error \
      --connect-timeout 5 \
      --max-time 45 \
      --output /dev/null \
      "$base_url$route"
  done
}

container_image_id() {
  local service="$1"
  local container_id

  container_id="$(compose ps -q "$service")"

  if [[ -z "$container_id" ]]; then
    echo "Compose service '$service' has no running container" >&2
    return 1
  fi

  docker inspect "$container_id" --format '{{.Image}}'
}

wait_for_remnashop_payment_schema() {
  local timeout_seconds="${REMNASHOP_SCHEMA_TIMEOUT_SECONDS:-300}"
  local minimum_revision="${REMNASHOP_MINIMUM_ALEMBIC_REVISION:-0058}"
  local deadline schema_ready current_revision

  if [[ ! "$timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
    echo "REMNASHOP_SCHEMA_TIMEOUT_SECONDS must be a positive integer" >&2
    return 1
  fi

  if [[ ! "$minimum_revision" =~ ^[0-9]+$ ]]; then
    echo "REMNASHOP_MINIMUM_ALEMBIC_REVISION must contain only digits" >&2
    return 1
  fi

  deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    schema_ready="$(
      compose exec -T remnashop-postgres \
        psql -Atq -U remnashop -d remnashop \
          -c "SELECT to_regclass('public.alembic_version') IS NOT NULL
                     AND to_regclass('public.payment_runtime_control') IS NOT NULL
                     AND to_regclass('public.payment_operations') IS NOT NULL;" \
        2>/dev/null || true
    )"

    if [[ "$schema_ready" == "t" ]]; then
      current_revision="$(
        compose exec -T remnashop-postgres \
          psql -Atq -U remnashop -d remnashop \
            -c "SELECT version_num FROM alembic_version;" \
          2>/dev/null || true
      )"

      if [[ "$current_revision" =~ ^[0-9]+$ ]] && (( 10#$current_revision >= 10#$minimum_revision )); then
        return 0
      fi
    fi

    echo "Waiting for Remnashop payment schema revision >= $minimum_revision (current: ${current_revision:-unknown})..." >&2
    sleep 2
  done

  echo "Timed out waiting for Remnashop payment schema revision >= $minimum_revision" >&2
  compose logs --tail=100 remnashop >&2 || true
  return 1
}

prepare_remnashop_payment_rollout_gate() {
  local minimum_revision="${REMNASHOP_MINIMUM_ALEMBIC_REVISION:-0058}"
  local api_image worker_image scheduler_image

  wait_for_remnashop_payment_schema

  api_image="$(container_image_id remnashop)"
  worker_image="$(container_image_id remnashop-worker)"
  scheduler_image="$(container_image_id remnashop-scheduler)"

  if [[ "$api_image" != "$worker_image" || "$api_image" != "$scheduler_image" ]]; then
    echo "Remnashop API, worker and scheduler must use the same image before the payment rollout gate is opened" >&2
    echo "API image: $api_image" >&2
    echo "Worker image: $worker_image" >&2
    echo "Scheduler image: $scheduler_image" >&2
    return 1
  fi

  compose exec -T remnashop-postgres \
    psql -v ON_ERROR_STOP=1 -v minimum_revision="$minimum_revision" -U remnashop -d remnashop <<'SQL'
BEGIN;

SELECT set_config('cleanpay.minimum_revision', :'minimum_revision', true);

DO $$
DECLARE
  current_revision text;
  rollout_gate_active boolean;
  payment_operation_count bigint;
BEGIN
  SELECT version_num
  INTO STRICT current_revision
  FROM alembic_version;

  IF current_revision !~ '^[0-9]+$'
     OR current_revision::bigint < current_setting('cleanpay.minimum_revision')::bigint THEN
    RAISE EXCEPTION
      'Expected Remnashop Alembic revision >= % before opening the e2e rollout gate, got %',
      current_setting('cleanpay.minimum_revision'), current_revision;
  END IF;

  SELECT legacy_rollout_gate_active
  INTO STRICT rollout_gate_active
  FROM payment_runtime_control
  WHERE id = 1
  FOR UPDATE;

  IF rollout_gate_active THEN
    SELECT count(*)
    INTO payment_operation_count
    FROM payment_operations;

    IF payment_operation_count <> 0 THEN
      RAISE EXCEPTION
        'Refusing to open the e2e rollout gate with % payment operations',
        payment_operation_count;
    END IF;

    UPDATE payment_runtime_control
    SET legacy_rollout_gate_active = false
    WHERE id = 1;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payment_runtime_control
    WHERE id = 1
      AND legacy_rollout_gate_active
  ) THEN
    RAISE EXCEPTION 'Remnashop e2e rollout gate remained active';
  END IF;
END
$$;

COMMIT;
SQL
}

install_node_dependencies() {
  local attempt

  for attempt in 1 2 3; do
    if npm ci --no-audit --no-fund; then
      return 0
    fi

    if [[ "$attempt" -lt 3 ]]; then
      echo "npm ci failed on attempt $attempt; retrying from the lockfile..." >&2
      sleep $((attempt * 2))
    fi
  done

  echo "npm ci failed after 3 attempts" >&2
  return 1
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
  local failed_step="$current_step"

  if [[ "$exit_code" -eq 0 ]]; then
    return
  fi

  if [[ "${CLEAN_PAY_E2E_DIAGNOSTICS:-1}" == "0" ]]; then
    return
  fi

  log_step "e2e diagnostics"
  echo "Exit code: $exit_code"
  echo "Failed step: $failed_step"
  echo "Base URL: $base_url"
  echo "Mailpit URL: $mailpit_url"
  echo "OIDC URL: $oidc_url"
  compose ps || true

  if [[ -n "$next_log" && -f "$next_log" ]]; then
    printf '\n== Next.js logs ==\n' >&2
    tail -n 240 "$next_log" >&2 || true
  fi

  for service in app remnashop remnashop-worker remnashop-scheduler smtp smtp-log telegram-oidc-mock remnawave-mock; do
    printf '\n== %s logs ==\n' "$service" >&2
    compose logs --tail=160 "$service" >&2 || true
  done
}

cleanup() {
  local exit_code=$?

  if [[ -n "$next_pid" ]]; then
    kill -- "-$next_pid" >/dev/null 2>&1 || true

    for _ in $(seq 1 10); do
      if ! kill -0 "$next_pid" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done

    if kill -0 "$next_pid" >/dev/null 2>&1; then
      kill -KILL -- "-$next_pid" >/dev/null 2>&1 || true
    fi

    wait "$next_pid" >/dev/null 2>&1 || true
  fi

  print_diagnostics "$exit_code"
  if [[ -n "$next_log" ]]; then
    rm -f -- "$next_log"
  fi

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
bash "$root_dir/scripts/wait-for-compose.sh" "$project" "$compose_file" 300 "${services[@]}"

log_step "Preparing isolated Remnashop payment rollout"
prepare_remnashop_payment_rollout_gate

log_step "Preparing Clean Pay application"
install_node_dependencies
npm run prisma:generate
npx prisma migrate deploy

log_step "Resetting e2e rate-limit counters"
redis-cli -h redis --scan --pattern 'clean-pay:rate-limit:*' | while IFS= read -r key; do
  redis-cli -h redis DEL "$key" >/dev/null
done

log_step "Starting Next.js on 0.0.0.0:4000"
pkill -f "next dev" >/dev/null 2>&1 || true
pkill -f "npm run dev" >/dev/null 2>&1 || true
wait_for_next_port
next_log="$(mktemp -t clean-pay-next.XXXXXX.log)"
CLEAN_PAY_E2E_BASE_URL="$base_url" \
CLEAN_PAY_E2E_MAILPIT_URL="$mailpit_url" \
CLEAN_PAY_E2E_OIDC_URL="$oidc_url" \
setsid npm run dev -- --hostname 0.0.0.0 --port 4000 >"$next_log" 2>&1 &
next_pid="$!"

wait_for_started_next
warm_next_routes
bash "$root_dir/scripts/wait-for-http.sh" "$mailpit_url/api/v1/messages" 60 "Wait for Mailpit API" "GET"
bash "$root_dir/scripts/wait-for-http.sh" "$oidc_url/.well-known/jwks.json" 60 "Wait for Telegram OIDC JWKS" "GET"

log_step "Running full-stack e2e tests"
timeout --signal=TERM --kill-after=10s 360s \
  env CLEAN_PAY_E2E_BASE_URL="$base_url" \
  CLEAN_PAY_E2E_MAILPIT_URL="$mailpit_url" \
  CLEAN_PAY_E2E_OIDC_URL="$oidc_url" \
  npx vitest run --config "$root_dir/config/vitest/vitest.e2e.config.mts" --configLoader native
