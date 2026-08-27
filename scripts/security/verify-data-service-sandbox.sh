#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_NAME="clean-pay-data-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$-$RANDOM"
readonly SOURCE_COMPOSE_FILE="docker-compose.yml"

if [[ ! -f "$SOURCE_COMPOSE_FILE" || -L "$SOURCE_COMPOSE_FILE" ]]; then
  printf 'sandbox compose file must be a regular non-symlink: %s\n' "$SOURCE_COMPOSE_FILE" >&2
  exit 1
fi

TEMPORARY_PROJECT_DIR="$(mktemp -d ./.clean-pay-data-sandbox.XXXXXX)"
readonly TEMPORARY_PROJECT_DIR
readonly COMPOSE_FILE="$TEMPORARY_PROJECT_DIR/docker-compose.yml"

# Compose validates env_file paths for unselected services too. Work from an
# isolated copy with synthetic role files instead of reading or touching an
# operator's repository environment files.
cp -- "$SOURCE_COMPOSE_FILE" "$COMPOSE_FILE"
printf '%s\n' \
  'NEXT_PUBLIC_APP_URL=https://sandbox.clean-pay.invalid' \
  'TURNSTILE_ENABLED=true' \
  'TURNSTILE_SITE_KEY=sandbox-site-key-not-real' \
  'POSTGRES_DB=clean_pay_sandbox' \
  'POSTGRES_USER=clean_pay_sandbox' \
  'POSTGRES_PASSWORD=sandbox-postgres-password-not-real' \
  > "$TEMPORARY_PROJECT_DIR/.env"
for role_file in \
  .env.app \
  .env.hold-operator \
  .env.migration \
  .env.provision \
  .env.reconciliation \
  .env.retention; do
  : > "$TEMPORARY_PROJECT_DIR/$role_file"
done
printf '%s\n' \
  'POSTGRES_DB=clean_pay_sandbox' \
  'POSTGRES_USER=clean_pay_sandbox' \
  'POSTGRES_PASSWORD=sandbox-postgres-password-not-real' \
  > "$TEMPORARY_PROJECT_DIR/.env.postgres"

export NEXT_PUBLIC_APP_URL="https://sandbox.clean-pay.invalid"
export TURNSTILE_ENABLED="true"
export TURNSTILE_SITE_KEY="sandbox-site-key-not-real"
export POSTGRES_DB="clean_pay_sandbox"
export POSTGRES_USER="clean_pay_sandbox"
export POSTGRES_PASSWORD="sandbox-postgres-password-not-real"

compose() {
  docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" "$@"
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if (( status != 0 )); then
    compose ps >&2 || true
    compose logs --no-color postgres redis >&2 || true
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  if [[ -n "$TEMPORARY_PROJECT_DIR" && -d "$TEMPORARY_PROJECT_DIR" ]]; then
    rm -rf -- "$TEMPORARY_PROJECT_DIR"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

assert_equal() {
  local label=$1
  local actual=$2
  local expected=$3
  if [[ "$actual" != "$expected" ]]; then
    printf '%s: expected %s, received %s\n' "$label" "$expected" "$actual" >&2
    return 1
  fi
}

assert_contains() {
  local label=$1
  local actual=$2
  local expected=$3
  if [[ "$actual" != *"$expected"* ]]; then
    printf '%s: expected %s in %s\n' "$label" "$expected" "$actual" >&2
    return 1
  fi
}

compose up --detach --wait --wait-timeout 120 postgres redis

postgres_id="$(compose ps --quiet postgres)"
redis_id="$(compose ps --quiet redis)"
if [[ -z "$postgres_id" || -z "$redis_id" ]]; then
  printf 'compose did not return both data-service container ids\n' >&2
  exit 1
fi

assert_equal "postgres user" "$(docker inspect --format '{{.Config.User}}' "$postgres_id")" "70:70"
assert_equal "redis user" "$(docker inspect --format '{{.Config.User}}' "$redis_id")" "999:1000"

for container_id in "$postgres_id" "$redis_id"; do
  assert_equal "read-only rootfs" \
    "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container_id")" \
    "true"
  assert_contains "dropped capabilities" \
    "$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$container_id")" \
    'ALL'
  assert_contains "no-new-privileges" \
    "$(docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$container_id")" \
    'no-new-privileges'
  assert_contains "writable tmpfs" \
    "$(docker inspect --format '{{json .HostConfig.Tmpfs}}' "$container_id")" \
    '/tmp'
  assert_equal "healthy data service" \
    "$(docker inspect --format '{{.State.Health.Status}}' "$container_id")" \
    "healthy"

  docker exec "$container_id" sh -ceu '
    if touch /usr/local/clean-pay-sandbox-write 2>/dev/null; then
      echo "read-only root filesystem accepted a write" >&2
      rm -f /usr/local/clean-pay-sandbox-write
      exit 1
    fi
    touch /tmp/clean-pay-sandbox-write
    rm /tmp/clean-pay-sandbox-write
  '
done

assert_contains "postgres socket tmpfs" \
  "$(docker inspect --format '{{json .HostConfig.Tmpfs}}' "$postgres_id")" \
  '/var/run/postgresql'
assert_equal "postgres data volume remains writable" \
  "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.RW}}{{end}}{{end}}' "$postgres_id")" \
  "true"
assert_equal "redis data volume remains writable" \
  "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.RW}}{{end}}{{end}}' "$redis_id")" \
  "true"

docker exec "$postgres_id" psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --command 'CREATE TABLE sandbox_write_probe (id integer PRIMARY KEY); INSERT INTO sandbox_write_probe VALUES (1); DROP TABLE sandbox_write_probe;'
docker exec "$redis_id" sh -ceu \
  'redis-cli SET clean-pay-sandbox-probe writable | grep -qx OK; test "$(redis-cli GET clean-pay-sandbox-probe)" = writable; redis-cli DEL clean-pay-sandbox-probe >/dev/null'

printf 'PostgreSQL and Redis sandbox runtime verification passed.\n'
