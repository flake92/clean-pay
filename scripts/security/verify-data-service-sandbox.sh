#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_NAME="clean-pay-data-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$-$RANDOM"
readonly SOURCE_COMPOSE_FILE="docker-compose.yml"
readonly POSTGRES_IMAGE="postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73"
readonly REDIS_IMAGE="redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf"

if [[ ! -f "$SOURCE_COMPOSE_FILE" || -L "$SOURCE_COMPOSE_FILE" ]]; then
  printf 'sandbox compose file must be a regular non-symlink: %s\n' "$SOURCE_COMPOSE_FILE" >&2
  exit 1
fi

readonly TEMPORARY_PROJECT_PARENT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
if [[ ! -d "$TEMPORARY_PROJECT_PARENT" || -L "$TEMPORARY_PROJECT_PARENT" ]]; then
  printf 'sandbox temporary parent must be an existing ordinary directory\n' >&2
  exit 1
fi
TEMPORARY_PROJECT_DIR="$(mktemp --directory "$TEMPORARY_PROJECT_PARENT/clean-pay-data-sandbox.XXXXXX")"
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
  timeout --signal=TERM --kill-after=10s 180s \
    docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" "$@"
}

docker_bounded() {
  timeout --signal=TERM --kill-after=10s 180s docker "$@"
}

pull_data_service_image() {
  local image=$1
  local attempt
  if docker_bounded image inspect "$image" >/dev/null 2>&1; then
    return 0
  fi
  for attempt in 1 2; do
    if docker_bounded pull --quiet "$image"; then
      return 0
    fi
  done
  printf 'bounded data-service image pull failed after %d attempts\n' "$attempt" >&2
  return 1
}

cleanup() {
  local status=$?
  local cleanup_failed=0
  local owned_resources
  trap - EXIT INT TERM
  if (( status != 0 )); then
    compose ps >&2 || true
    compose logs --no-color postgres redis >&2 || true
  fi
  if ! compose down --volumes --remove-orphans >/dev/null 2>&1; then
    cleanup_failed=1
  fi
  for resource in containers networks volumes; do
    case "$resource" in
      containers)
        owned_resources="$(docker_bounded ps --all --quiet \
          --filter "label=com.docker.compose.project=$PROJECT_NAME")" || cleanup_failed=1
        ;;
      networks)
        owned_resources="$(docker_bounded network ls --quiet \
          --filter "label=com.docker.compose.project=$PROJECT_NAME")" || cleanup_failed=1
        ;;
      volumes)
        owned_resources="$(docker_bounded volume ls --quiet \
          --filter "label=com.docker.compose.project=$PROJECT_NAME")" || cleanup_failed=1
        ;;
    esac
    if [[ -n "${owned_resources:-}" ]]; then
      cleanup_failed=1
    fi
    owned_resources=""
  done
  if [[ -n "$TEMPORARY_PROJECT_DIR" && -d "$TEMPORARY_PROJECT_DIR" ]]; then
    rm -rf -- "$TEMPORARY_PROJECT_DIR"
  fi
  if (( cleanup_failed != 0 )); then
    printf 'data-service sandbox exact cleanup was not proven\n' >&2
    if (( status == 0 )); then
      status=1
    fi
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

data_service_image_output="$(compose config --images postgres redis)"
mapfile -t data_service_images <<< "$data_service_image_output"
if (( ${#data_service_images[@]} != 2 )); then
  printf 'compose did not resolve exactly two data-service images\n' >&2
  exit 1
fi
postgres_image_count=0
redis_image_count=0
for image in "${data_service_images[@]}"; do
  case "$image" in
    "$POSTGRES_IMAGE") ((postgres_image_count += 1)) ;;
    "$REDIS_IMAGE") ((redis_image_count += 1)) ;;
    *)
      printf 'compose resolved a data-service image outside the pinned allowlist\n' >&2
      exit 1
      ;;
  esac
  pull_data_service_image "$image"
done
if (( postgres_image_count != 1 || redis_image_count != 1 )); then
  printf 'compose did not resolve the exact pinned data-service image set\n' >&2
  exit 1
fi

compose up --detach --wait --wait-timeout 120 --pull never postgres redis

postgres_id="$(compose ps --quiet postgres)"
redis_id="$(compose ps --quiet redis)"
if [[ -z "$postgres_id" || -z "$redis_id" ]]; then
  printf 'compose did not return both data-service container ids\n' >&2
  exit 1
fi

assert_equal "postgres user" "$(docker_bounded inspect --format '{{.Config.User}}' "$postgres_id")" "70:70"
assert_equal "redis user" "$(docker_bounded inspect --format '{{.Config.User}}' "$redis_id")" "999:1000"

for container_id in "$postgres_id" "$redis_id"; do
  assert_equal "read-only rootfs" \
    "$(docker_bounded inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container_id")" \
    "true"
  assert_contains "dropped capabilities" \
    "$(docker_bounded inspect --format '{{json .HostConfig.CapDrop}}' "$container_id")" \
    'ALL'
  assert_contains "no-new-privileges" \
    "$(docker_bounded inspect --format '{{json .HostConfig.SecurityOpt}}' "$container_id")" \
    'no-new-privileges'
  assert_contains "writable tmpfs" \
    "$(docker_bounded inspect --format '{{json .HostConfig.Tmpfs}}' "$container_id")" \
    '/tmp'
  assert_equal "healthy data service" \
    "$(docker_bounded inspect --format '{{.State.Health.Status}}' "$container_id")" \
    "healthy"

  docker_bounded exec "$container_id" sh -ceu '
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
  "$(docker_bounded inspect --format '{{json .HostConfig.Tmpfs}}' "$postgres_id")" \
  '/var/run/postgresql'
assert_equal "postgres data volume remains writable" \
  "$(docker_bounded inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.RW}}{{end}}{{end}}' "$postgres_id")" \
  "true"
assert_equal "redis data volume remains writable" \
  "$(docker_bounded inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.RW}}{{end}}{{end}}' "$redis_id")" \
  "true"

docker_bounded exec "$postgres_id" psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --command 'CREATE TABLE sandbox_write_probe (id integer PRIMARY KEY); INSERT INTO sandbox_write_probe VALUES (1); DROP TABLE sandbox_write_probe;'
docker_bounded exec "$redis_id" sh -ceu \
  "redis-cli SET clean-pay-sandbox-probe writable | grep -qx OK; test \"\$(redis-cli GET clean-pay-sandbox-probe)\" = writable; redis-cli DEL clean-pay-sandbox-probe >/dev/null"

printf 'PostgreSQL and Redis sandbox runtime verification passed.\n'
