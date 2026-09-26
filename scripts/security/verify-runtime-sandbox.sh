#!/usr/bin/env bash
set -euo pipefail

APP_IMAGE=${1:-clean-pay:ci}
MIGRATION_IMAGE=${2:-clean-pay-migration:ci}
[[ "$APP_IMAGE" != "$MIGRATION_IMAGE" ]] || {
  printf 'application and migration images must be distinct\n' >&2
  exit 2
}

TEMPORARY_DIR=$(mktemp -d "${RUNNER_TEMP:-/tmp}/clean-pay-runtime-sandbox.XXXXXX")
PROJECT_NAME="clean-pay-runtime-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$-${RANDOM}"
EDGE_NETWORK="${PROJECT_NAME}-edge"
COMPOSE_FILE="$(pwd)/deploy/prod/docker-compose.yml"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if (( status != 0 )); then
    compose ps --all >&2 || true
    compose logs --no-color >&2 || true
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker network rm "$EDGE_NETWORK" >/dev/null 2>&1 || true
  rm -rf -- "$TEMPORARY_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

export CLEAN_PAY_FIXTURE_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-https://pay.ci.clean-pay.dev}"
export CLEAN_PAY_FIXTURE_BRAND_NAME="${NEXT_PUBLIC_BRAND_NAME:-Clean Pay}"
export CLEAN_PAY_FIXTURE_BRAND_LOGO_URL="${NEXT_PUBLIC_BRAND_LOGO_URL:-/clean-pay-logo.png}"
export CLEAN_PAY_FIXTURE_TURNSTILE_SITE_KEY="${TURNSTILE_SITE_KEY:-ci-turnstile-site-key-not-real}"
export CLEAN_PAY_FIXTURE_DEPLOY_SOURCE=build
export CLEAN_PAY_FIXTURE_APPLICATION_IMAGE="$APP_IMAGE"
export CLEAN_PAY_FIXTURE_MIGRATION_IMAGE="$MIGRATION_IMAGE"
export CLEAN_PAY_FIXTURE_RELEASE=ci
export CLEAN_PAY_FIXTURE_REVISION="${GITHUB_SHA:-0000000000000000000000000000000000000000}"
node tests/fixtures/write-synthetic-production-env.mjs "$TEMPORARY_DIR/.env"
node deploy/prod/role-env.mjs materialize "$TEMPORARY_DIR/.env"
docker network create "$EDGE_NETWORK" >/dev/null

export CLEAN_PAY_IMAGE="$APP_IMAGE"
export CLEAN_PAY_MIGRATION_IMAGE="$MIGRATION_IMAGE"
export CLEAN_PAY_APP_ENV_FILE="$TEMPORARY_DIR/.env.app"
export CLEAN_PAY_MIGRATION_ENV_FILE="$TEMPORARY_DIR/.env.migration"
export CLEAN_PAY_HOLD_OPERATOR_ENV_FILE="$TEMPORARY_DIR/.env.hold-operator"
export CLEAN_PAY_POSTGRES_ENV_FILE="$TEMPORARY_DIR/.env.postgres"
export CLEAN_PAY_PROVISION_ENV_FILE="$TEMPORARY_DIR/.env.provision"
export CLEAN_PAY_RECONCILIATION_ENV_FILE="$TEMPORARY_DIR/.env.reconciliation"
export CLEAN_PAY_RETENTION_ENV_FILE="$TEMPORARY_DIR/.env.retention"
export CLEAN_PAY_EDGE_NETWORK="$EDGE_NETWORK"
export CLEAN_PAY_BIND=127.0.0.1
export CLEAN_PAY_PORT=4017

compose() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$TEMPORARY_DIR/.env" \
    --file "$COMPOSE_FILE" \
    --profile reconciliation \
    "$@"
}

assert_runtime_sandbox() {
  service=$1
  id=$(compose ps --all --quiet "$service")
  [[ -n "$id" ]] || {
    printf 'missing %s container\n' "$service" >&2
    return 1
  }
  test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$id")" = true
  docker inspect --format '{{json .HostConfig.CapDrop}}' "$id" | grep -q ALL
  docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$id" | grep -q no-new-privileges
}

compose up --detach --no-build --pull never --wait --wait-timeout 300

for service in migration app reconciliation-worker retention-worker postgres redis; do
  assert_runtime_sandbox "$service"
done

migration_id=$(compose ps --all --quiet migration)
test "$(docker inspect --format '{{.State.ExitCode}}' "$migration_id")" = 0
postgres_id=$(compose ps --quiet postgres)
docker exec "$postgres_id" psql -U clean_pay_bootstrap -d clean_pay -Atqc \
  "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations'" \
  | grep -qx 1

app_id=$(compose ps --quiet app)
docker exec "$app_id" node -e \
  "fetch('http://127.0.0.1:4000/api/health/liveness').then(r=>{if(!r.ok)process.exit(1)})"
docker exec "$app_id" node -e \
  "fetch('http://127.0.0.1:4000/_next/image?url=%2Fclean-pay-logo.png&w=64&q=75').then(r=>{if(!r.ok)process.exit(1)})"

for service in app reconciliation-worker retention-worker; do
  id=$(compose ps --quiet "$service")
  docker exec "$id" sh -ceu '
    if touch /app/runtime-rootfs-write 2>/dev/null; then
      echo "read-only root filesystem accepted a write" >&2
      exit 1
    fi
    mkdir -p /tmp/runtime-mount
    if mount -t tmpfs tmpfs /tmp/runtime-mount 2>/dev/null; then
      echo "capability-dropped runtime unexpectedly mounted tmpfs" >&2
      umount /tmp/runtime-mount || true
      exit 1
    fi
    rmdir /tmp/runtime-mount
  '
done

reconciliation_id=$(compose ps --quiet reconciliation-worker)
retention_id=$(compose ps --quiet retention-worker)
compose stop --timeout 120 reconciliation-worker retention-worker >/dev/null
test "$(docker inspect --format '{{.State.ExitCode}}' "$reconciliation_id")" = 0
test "$(docker inspect --format '{{.State.ExitCode}}' "$retention_id")" = 0
docker logs "$reconciliation_id" 2>&1 | grep -q 'event=reconciliation_worker_stopped'
docker logs "$retention_id" 2>&1 | grep -q 'event=retention_worker_stopped'

printf 'Full hardened migration/app/worker runtime sandbox verification passed.\n'
