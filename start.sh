#!/usr/bin/env sh
set -eu
umask 077

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
REMNASHOP_ROLLOUT_SCRIPT="$ROOT_DIR/deploy/prod/prepare-remnashop-rollout.sh"
IMAGE_PREFLIGHT_SCRIPT="$ROOT_DIR/deploy/prod/image-preflight.sh"
BUILD_PROVENANCE_SCRIPT="$ROOT_DIR/deploy/prod/build-provenance.sh"
ROLE_ENV_SCRIPT="$ROOT_DIR/deploy/prod/role-env.mjs"
CREDENTIAL_INIT_SCRIPT="$ROOT_DIR/deploy/prod/database-credential-init.mjs"
CREDENTIAL_FILE_GUARD_SCRIPT="$ROOT_DIR/deploy/prod/credential-file-guard.mjs"
OPERATION_LOCK_SCRIPT="$ROOT_DIR/deploy/prod/production-operation-lock.mjs"
OPERATION_LOCK_PATH="$ROOT_DIR/deploy/prod/.production-operation.lock"
APP_ENV_FILE="${ENV_FILE}.app"
HOLD_OPERATOR_ENV_FILE="${ENV_FILE}.hold-operator"
MIGRATION_ENV_FILE="${ENV_FILE}.migration"
POSTGRES_ENV_FILE="${ENV_FILE}.postgres"
PROVISION_ENV_FILE="${ENV_FILE}.provision"
RECONCILIATION_ENV_FILE="${ENV_FILE}.reconciliation"
RETENTION_ENV_FILE="${ENV_FILE}.retention"
MODE="${CLEAN_PAY_MODE:-standalone}"
COMMAND="${1:-start}"
verified_image_dir=''
verified_image_output=''
CLEAN_PAY_VERIFIED_APP_IMAGE=''
CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=''
operation_lock_token=''

. "$ROOT_DIR/deploy/prod/redis-host-safety.sh"

fail() {
  printf '%s\n' "Clean Pay startup failed: $*" >&2
  exit 1
}

info() {
  printf '%s\n' "Clean Pay: $*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed or is not available in PATH"
}

assert_private_env_file() {
  if command -v node >/dev/null 2>&1; then
    node "$CREDENTIAL_FILE_GUARD_SCRIPT" file "$ENV_FILE"
    return
  fi

  [ ! -L "$ENV_FILE" ] && [ -f "$ENV_FILE" ] \
    || fail "production environment file must be a regular non-symlink file"
  command -v stat >/dev/null 2>&1 \
    || fail "node or stat is required to validate production environment metadata"
  [ "$(stat -c '%a' "$ENV_FILE")" = "600" ] \
    || fail "production environment file permissions must be exactly 600"
  [ "$(stat -c '%u' "$ENV_FILE")" = "$(id -u)" ] \
    || fail "production environment file must be owned by the current operator"
}

env_value() {
  name="$1"
  fallback="${2:-}"

  if [ ! -e "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ]; then
    printf '%s' "$fallback"
    return
  fi

  assert_private_env_file

  value=$(
    grep -E "^${name}=" "$ENV_FILE" 2>/dev/null \
      | tail -n 1 \
      | sed -e "s/^${name}=//" -e 's/\r$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
  )

  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

require_env_file() {
  [ -f "$ENV_FILE" ] || fail "missing .env. Create it from .env.example and fill real values"
  assert_private_env_file
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  if [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    printf '\n'
    return
  fi

  fail "openssl or /dev/urandom with od is required to generate secrets"
}

is_placeholder_secret() {
  case "$1" in
    ""|change-me|change-me-*|build-time-placeholder) return 0 ;;
    *) return 1 ;;
  esac
}

write_env_value() {
  name="$1"
  value="$2"
  printf '%s' "$value" \
    | node "$CREDENTIAL_FILE_GUARD_SCRIPT" env-set "$ENV_FILE" "$name" \
    || fail "failed to safely update $name in .env"
  assert_private_env_file
}

ensure_generated_secret() {
  name="$1"
  value=$(env_value "$name")

  if ! is_placeholder_secret "$value"; then
    return
  fi

  write_env_value "$name" "$(generate_secret)"
  info "generated $name in .env"
}

ensure_generated_secrets() {
  require_env_file
  node "$CREDENTIAL_INIT_SCRIPT" init "$ENV_FILE"
  ensure_generated_secret WEB_JWT_SECRET
  ensure_generated_secret WEB_REFRESH_SECRET
  ensure_generated_secret AUDIT_IP_HASH_SECRET
  ensure_generated_secret RATE_LIMIT_IDENTITY_SECRET
  ensure_generated_secret READINESS_INTERNAL_SECRET
  ensure_generated_secret PAYMENT_RECONCILIATION_SECRET
}

validate_env() {
  require_command node
  require_env_file
  ensure_generated_secrets
  node "$ROOT_DIR/deploy/prod/validate-env.mjs" --clean-pay-env-file "$ENV_FILE"
  node "$ROLE_ENV_SCRIPT" materialize "$ENV_FILE"
  info "production environment file is valid"
}

ensure_network() {
  edge_network=$(env_value CLEAN_PAY_EDGE_NETWORK remnawave-network)
  ensure_named_network "$edge_network" "Clean Pay edge"

  [ "$MODE" = "remnashop" ] || return 0
  remnashop_network=$(env_value REMNASHOP_DOCKER_NETWORK remnawave-network)
  [ "$remnashop_network" = "$edge_network" ] \
    || ensure_named_network "$remnashop_network" "Remnashop integration"
}

ensure_named_network() {
  network_name=$1
  network_role=$2

  if docker network inspect "$network_name" >/dev/null 2>&1; then
    info "$network_role network $network_name already exists"
    return
  fi

  info "$network_role network $network_name not found, creating it"
  docker network create "$network_name" >/dev/null \
    || fail "failed to create Docker network $network_name"
}

ensure_redis_host_memory_policy() {
  # redis-host-safety.sh reads /proc/sys/vm/overcommit_memory inside the
  # selected Docker daemon, rather than from this script's local host.
  probe_redis_host_memory_policy || fail "$REDIS_HOST_MEMORY_POLICY_FAILURE"
}

compose() (
  unset \
    CLEAN_PAY_BIND \
    CLEAN_PAY_APP_ENV_FILE \
    CLEAN_PAY_EDGE_NETWORK \
    CLEAN_PAY_IMAGE \
    CLEAN_PAY_HOLD_OPERATOR_ENV_FILE \
    CLEAN_PAY_MIGRATION_IMAGE \
    CLEAN_PAY_MIGRATION_ENV_FILE \
    CLEAN_PAY_MIN_FREE_DISK_MB \
    CLEAN_PAY_PORT \
    CLEAN_PAY_POSTGRES_ENV_FILE \
    CLEAN_PAY_PROVISION_ENV_FILE \
    CLEAN_PAY_RECONCILIATION_ENV_FILE \
    CLEAN_PAY_RELEASE \
    CLEAN_PAY_REVISION \
    CLEAN_PAY_RETENTION_ENV_FILE \
    COMPOSE_ENV_FILES \
    COMPOSE_FILE \
    COMPOSE_PROFILES \
    COMPOSE_PROJECT_NAME \
    LOG_LEVEL \
    NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_BRAND_LOGO_URL \
    NEXT_PUBLIC_BRAND_NAME \
    POSTGRES_DB \
    POSTGRES_PASSWORD \
    POSTGRES_USER \
    REMNASHOP_DOCKER_NETWORK \
    TURNSTILE_ENABLED \
    TURNSTILE_SITE_KEY

  if [ -n "$CLEAN_PAY_VERIFIED_APP_IMAGE" ] || [ -n "$CLEAN_PAY_VERIFIED_MIGRATION_IMAGE" ]; then
    [ -n "$CLEAN_PAY_VERIFIED_APP_IMAGE" ] && [ -n "$CLEAN_PAY_VERIFIED_MIGRATION_IMAGE" ] \
      || fail "verified mode requires both immutable application and migration image IDs"
    CLEAN_PAY_IMAGE=$CLEAN_PAY_VERIFIED_APP_IMAGE
    CLEAN_PAY_MIGRATION_IMAGE=$CLEAN_PAY_VERIFIED_MIGRATION_IMAGE
    export CLEAN_PAY_IMAGE CLEAN_PAY_MIGRATION_IMAGE
  fi

  CLEAN_PAY_APP_ENV_FILE=$APP_ENV_FILE
  CLEAN_PAY_HOLD_OPERATOR_ENV_FILE=$HOLD_OPERATOR_ENV_FILE
  CLEAN_PAY_MIGRATION_ENV_FILE=$MIGRATION_ENV_FILE
  CLEAN_PAY_POSTGRES_ENV_FILE=$POSTGRES_ENV_FILE
  CLEAN_PAY_PROVISION_ENV_FILE=$PROVISION_ENV_FILE
  CLEAN_PAY_RECONCILIATION_ENV_FILE=$RECONCILIATION_ENV_FILE
  CLEAN_PAY_RETENTION_ENV_FILE=$RETENTION_ENV_FILE
  export \
    CLEAN_PAY_APP_ENV_FILE \
    CLEAN_PAY_HOLD_OPERATOR_ENV_FILE \
    CLEAN_PAY_MIGRATION_ENV_FILE \
    CLEAN_PAY_POSTGRES_ENV_FILE \
    CLEAN_PAY_PROVISION_ENV_FILE \
    CLEAN_PAY_RECONCILIATION_ENV_FILE \
    CLEAN_PAY_RETENTION_ENV_FILE

  if [ "$MODE" = "remnashop" ]; then
    if [ "$(env_value PAYMENT_RECONCILIATION_ENABLED true)" = "true" ]; then
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$ROOT_DIR/docker-compose.remnashop.yml" --profile reconciliation "$@"
    else
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$ROOT_DIR/docker-compose.remnashop.yml" "$@"
    fi
  else
    if [ "$(env_value PAYMENT_RECONCILIATION_ENABLED true)" = "true" ]; then
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile reconciliation "$@"
    else
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    fi
  fi
)

deployment_source() {
  env_value CLEAN_PAY_DEPLOY_SOURCE build
}

prepare_images() {
  deploy_source=$(deployment_source)

  case "$deploy_source" in
    build)
      sh "$BUILD_PROVENANCE_SCRIPT" \
        "$ROOT_DIR" \
        "$deploy_source" \
        "$(env_value CLEAN_PAY_RELEASE local)" \
        "$(env_value CLEAN_PAY_REVISION local)"
      info "building application and migration images"
      compose build migration app
      ;;
    pull)
      info "pulling digest-pinned application and migration images"
      compose pull migration app
      ;;
    *)
      fail "CLEAN_PAY_DEPLOY_SOURCE must be build or pull"
      ;;
  esac
}

cleanup_verified_images() {
  if [ -n "$verified_image_output" ]; then
    rm -f "$verified_image_output"
  fi
  if [ -n "$verified_image_dir" ]; then
    rmdir "$verified_image_dir" 2>/dev/null || true
  fi
  verified_image_output=''
  verified_image_dir=''
  CLEAN_PAY_VERIFIED_APP_IMAGE=''
  CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=''
}

acquire_production_operation_lock() {
  operation_name=$1
  require_command node
  operation_lock_token=$(node "$OPERATION_LOCK_SCRIPT" \
    acquire "$OPERATION_LOCK_PATH" "$operation_name" "$$") \
    || fail "another production operation is active or the fail-closed operation lock needs reviewed recovery"
  printf '%s\n' "$operation_lock_token" | grep -Eq '^[0-9a-f]{64}$' \
    || fail "production operation lock returned an invalid ownership token"
}

release_production_operation_lock() {
  [ -n "$operation_lock_token" ] || return 0
  if ! node "$OPERATION_LOCK_SCRIPT" \
    release "$OPERATION_LOCK_PATH" "$operation_lock_token"; then
    return 1
  fi
  operation_lock_token=''
}

cleanup_start_state() {
  status=$?
  trap - 0 HUP INT TERM
  set +e
  cleanup_verified_images
  if ! release_production_operation_lock; then
    printf '%s\n' "WARNING: production operation lock release failed; inspect the fail-closed lock before retrying." >&2
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  exit "$status"
}

trap cleanup_start_state 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

preflight_images() {
  cleanup_verified_images
  verified_image_dir=$(mktemp -d "${TMPDIR:-/tmp}/clean-pay-verified.XXXXXX") \
    || fail "could not create a private verified-image directory"
  verified_image_output="$verified_image_dir/images.env"

  sh "$IMAGE_PREFLIGHT_SCRIPT" \
    "$deploy_source" \
    "$(env_value CLEAN_PAY_IMAGE)" \
    "$(env_value CLEAN_PAY_MIGRATION_IMAGE)" \
    "$ENV_FILE" \
    "$(env_value NEXT_PUBLIC_APP_URL)" \
    "$(env_value NEXT_PUBLIC_BRAND_NAME Clean Pay)" \
    "$(env_value NEXT_PUBLIC_BRAND_LOGO_URL /clean-pay-logo.png)" \
    "$(env_value TURNSTILE_SITE_KEY)" \
    "$(env_value CLEAN_PAY_RELEASE local)" \
    "$(env_value CLEAN_PAY_REVISION local)" \
    "$verified_image_output"

  [ "$(wc -l < "$verified_image_output" | tr -d ' ')" = "2" ] \
    || fail "image preflight returned malformed verified-image output"
  CLEAN_PAY_VERIFIED_APP_IMAGE=$(sed -n 's/^CLEAN_PAY_VERIFIED_APP_IMAGE=//p' "$verified_image_output")
  CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=$(sed -n 's/^CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=//p' "$verified_image_output")
  printf '%s\n' "$CLEAN_PAY_VERIFIED_APP_IMAGE" | grep -Eq '^sha256:[a-f0-9]{64}$' \
    || fail "image preflight returned an invalid application image ID"
  printf '%s\n' "$CLEAN_PAY_VERIFIED_MIGRATION_IMAGE" | grep -Eq '^sha256:[a-f0-9]{64}$' \
    || fail "image preflight returned an invalid migration image ID"
  [ "$CLEAN_PAY_VERIFIED_APP_IMAGE" != "$CLEAN_PAY_VERIFIED_MIGRATION_IMAGE" ] \
    || fail "image preflight returned the same ID for both image roles"
}

prepare_runtime_dependencies() {
  compose pull --policy missing postgres redis
}

stop_runtime_services() {
  info "stopping application runtimes for migration; PostgreSQL and Redis stay running"
  compose stop reconciliation-worker retention-worker app
  compose --profile operations rm -f -s retention-hold db-grant-sync db-role-provision migration
}

prepare_database_roles() {
  compose rm -f -s db-role-provision || return 1
  compose run --rm --no-deps --pull never db-role-provision || return 1
}

fence_database_roles() {
  compose rm -f -s db-role-provision || return 1
  compose run --rm --no-deps --pull never db-role-provision \
    node deploy/prod/database-role-provision.mjs fence || return 1
}

sync_database_privileges() {
  compose rm -f -s db-grant-sync || return 1
  compose run --rm --no-deps --pull never db-grant-sync || return 1
}

run_verified_migration() {
  compose up -d --no-build --pull never --wait --wait-timeout 120 postgres redis \
    || return 1
  migration_status=0
  prepare_database_roles || migration_status=$?
  if [ "$migration_status" -eq 0 ]; then
    compose rm -f -s migration || migration_status=$?
  fi
  if [ "$migration_status" -eq 0 ]; then
    compose run --rm --no-deps --pull never migration || migration_status=$?
  fi
  if [ "$migration_status" -eq 0 ]; then
    sync_database_privileges || migration_status=$?
  fi
  [ "$migration_status" -ne 0 ] || return 0
  printf '%s\n' "Migration/grant synchronization failed; re-fencing every non-bootstrap database role..." >&2
  fence_database_roles \
    || printf '%s\n' "WARNING: automatic database-role re-fence failed; keep all runtimes stopped and repair the fence before retrying." >&2
  return "$migration_status"
}

start_verified_runtimes() {
  compose up -d --no-deps --no-build --pull never --wait --wait-timeout 180 app \
    || return 1

  if [ "$(env_value PAYMENT_RECONCILIATION_ENABLED true)" = "true" ]; then
    compose up -d --no-deps --no-build --pull never --wait --wait-timeout 180 \
      retention-worker reconciliation-worker || return 1
  else
    compose up -d --no-deps --no-build --pull never --wait --wait-timeout 180 \
      retention-worker || return 1
  fi
}

assert_reconciliation_worker() {
  [ "$(env_value PAYMENT_RECONCILIATION_ENABLED true)" = "true" ] || return 0

  attempts=0
  last_status="container not found"

  while [ "$attempts" -lt 60 ]; do
    container_id=$(compose ps -q reconciliation-worker) \
      || fail "failed to inspect reconciliation-worker"

    if [ -n "$container_id" ]; then
      last_status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || printf '%s' "inspect failed")

      if [ "$last_status" = "healthy" ]; then
        info "reconciliation-worker is healthy"
        return 0
      fi
    fi

    attempts=$((attempts + 1))
    sleep 2
  done

  fail "PAYMENT_RECONCILIATION_ENABLED=true, but reconciliation-worker is not healthy ($last_status)"
}

assert_retention_worker() {
  attempts=0
  last_status="container not found"

  while [ "$attempts" -lt 60 ]; do
    container_id=$(compose ps -q retention-worker) \
      || fail "failed to inspect retention-worker"

    if [ -n "$container_id" ]; then
      last_status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || printf '%s' "inspect failed")

      if [ "$last_status" = "healthy" ]; then
        info "retention-worker is healthy"
        return 0
      fi
    fi

    attempts=$((attempts + 1))
    sleep 2
  done

  fail "retention-worker is not healthy ($last_status)"
}

start() {
  require_command docker
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available"
  validate_env
  ensure_redis_host_memory_policy
  ensure_network
  if [ "$MODE" = "remnashop" ]; then
    sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" check
  fi
  prepare_images
  preflight_images
  prepare_runtime_dependencies
  stop_runtime_services
  info "running the verified one-shot migration before application runtimes"
  run_verified_migration
  start_verified_runtimes
  cleanup_verified_images
  verify
  if [ "$MODE" = "remnashop" ]; then
    sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" finalize
  fi
  info "started. Use 'sh start.sh logs' to follow app logs"
}

verify() {
  require_env_file
  require_command node
  attempts=0

  while [ "$attempts" -lt 60 ]; do
    # Read the credential only inside the already-running app container. A
    # host-side curl/wget header would expose it in the process argument list.
    # Treat malformed JSON, an empty checks object and every degraded check as
    # a failure even if the endpoint accidentally returns HTTP 200.
    if compose exec -T app node -e "fetch('http://127.0.0.1:4000/api/internal/health/readiness',{headers:{'x-clean-pay-readiness-secret':process.env.READINESS_INTERNAL_SECRET},signal:AbortSignal.timeout(10000)}).then(async response=>{const text=await response.text();let body;try{body=JSON.parse(text)}catch{throw new Error('readiness returned invalid JSON')}const checks=body&&body.checks&&typeof body.checks==='object'&&!Array.isArray(body.checks)?Object.entries(body.checks):[];const failed=checks.filter(([,check])=>!check||check.status!=='ok').map(([name])=>name);if(!response.ok||body.status!=='ok'||checks.length===0||failed.length)throw new Error('dependencies are not ready: '+(failed.join(', ')||body.status||response.status));process.exit(0)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      info "detailed application readiness is healthy"
      assert_reconciliation_worker
      assert_retention_worker
      return 0
    fi

    attempts=$((attempts + 1))
    sleep 2
  done

  fail "detailed application readiness did not become healthy within 120 seconds"
}

case "$MODE" in
  standalone|remnashop) ;;
  *) fail "CLEAN_PAY_MODE must be standalone or remnashop" ;;
esac

case "$COMMAND" in
  start|up|stop|down|restart|build)
    acquire_production_operation_lock "$COMMAND"
    ;;
esac

case "$COMMAND" in
  start|up)
    start
    ;;
  stop|down)
    require_env_file
    require_command node
    node "$ROLE_ENV_SCRIPT" materialize "$ENV_FILE"
    compose down
    ;;
  restart)
    start
    ;;
  logs)
    require_env_file
    compose logs -f app
    ;;
  status|ps)
    require_env_file
    compose ps
    assert_reconciliation_worker
    assert_retention_worker
    ;;
  verify|health)
    verify
    ;;
  build)
    require_command docker
    docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available"
    validate_env
    prepare_images
    preflight_images
    ;;
  *)
    cat <<'EOF'
Usage:
  sh start.sh          Start Clean Pay (standalone/external API mode)
  CLEAN_PAY_MODE=remnashop sh start.sh  Start beside Remnashop on its Docker network
  sh start.sh stop     Stop containers
  sh start.sh restart  Restart containers
  sh start.sh logs     Show app logs
  sh start.sh status   Show container status
  sh start.sh verify   Check the health endpoint
  sh start.sh build    Build or pull the configured image targets
EOF
    exit 1
    ;;
esac
