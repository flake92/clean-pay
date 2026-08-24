#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
REMNASHOP_ROLLOUT_SCRIPT="$ROOT_DIR/deploy/prod/prepare-remnashop-rollout.sh"
IMAGE_PREFLIGHT_SCRIPT="$ROOT_DIR/deploy/prod/image-preflight.sh"
BUILD_PROVENANCE_SCRIPT="$ROOT_DIR/deploy/prod/build-provenance.sh"
MODE="${CLEAN_PAY_MODE:-standalone}"
COMMAND="${1:-start}"
verified_image_dir=''
verified_image_output=''
CLEAN_PAY_VERIFIED_APP_IMAGE=''
CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=''

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

env_value() {
  name="$1"
  fallback="${2:-}"

  if [ ! -f "$ENV_FILE" ]; then
    printf '%s' "$fallback"
    return
  fi

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
  tmp_file="${ENV_FILE}.tmp.$$"

  awk -v name="$name" -v value="$value" '
    index($0, name "=") == 1 {
      if (!done) {
        print name "=" value
        done = 1
      }
      next
    }
    { print }
    END {
      if (!done) {
        print name "=" value
      }
    }
  ' "$ENV_FILE" > "$tmp_file" \
    && mv "$tmp_file" "$ENV_FILE" \
    || {
      rm -f "$tmp_file"
      fail "failed to update $name in .env"
    }
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
  ensure_generated_secret WEB_JWT_SECRET
  ensure_generated_secret WEB_REFRESH_SECRET
  ensure_generated_secret AUDIT_IP_HASH_SECRET
  ensure_generated_secret RATE_LIMIT_IDENTITY_SECRET
  ensure_generated_secret READINESS_INTERNAL_SECRET
}

validate_env() {
  require_env_file
  ensure_generated_secrets
  require_command node
  node "$ROOT_DIR/deploy/prod/validate-env.mjs" --clean-pay-env-file "$ENV_FILE"
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
    CLEAN_PAY_EDGE_NETWORK \
    CLEAN_PAY_IMAGE \
    CLEAN_PAY_MIGRATION_IMAGE \
    CLEAN_PAY_MIN_FREE_DISK_MB \
    CLEAN_PAY_PORT \
    CLEAN_PAY_RELEASE \
    CLEAN_PAY_REVISION \
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

  if [ -n "$CLEAN_PAY_VERIFIED_APP_IMAGE" ]; then
    CLEAN_PAY_IMAGE=$CLEAN_PAY_VERIFIED_APP_IMAGE
    CLEAN_PAY_MIGRATION_IMAGE=$CLEAN_PAY_VERIFIED_MIGRATION_IMAGE
    export CLEAN_PAY_IMAGE CLEAN_PAY_MIGRATION_IMAGE
  fi

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

trap cleanup_verified_images EXIT
trap 'cleanup_verified_images; exit 129' HUP
trap 'cleanup_verified_images; exit 130' INT
trap 'cleanup_verified_images; exit 143' TERM

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
}

run_verified_migration() {
  compose up -d --no-build --pull never --wait --wait-timeout 120 postgres redis \
    || return 1
  compose rm -f -s migration || return 1
  compose run --rm --no-deps --pull never migration || return 1
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
  port=$(env_value CLEAN_PAY_PORT 4000)
  url="http://127.0.0.1:${port}/api/internal/health/readiness"
  readiness_secret=$(env_value READINESS_INTERNAL_SECRET)
  attempts=0
  response=""

  while [ "$attempts" -lt 60 ]; do
    if command -v curl >/dev/null 2>&1; then
      if response=$(curl --fail --show-error --silent --max-time 10 -H "x-clean-pay-readiness-secret: ${readiness_secret}" "$url" 2>/dev/null); then
        break
      fi
    elif command -v wget >/dev/null 2>&1; then
      if response=$(wget -qO- -T 10 --header="x-clean-pay-readiness-secret: ${readiness_secret}" "$url" 2>/dev/null); then
        break
      fi
    else
      fail "curl or wget is required to verify ${url}"
    fi

    attempts=$((attempts + 1))
    sleep 2
  done

  [ -n "$response" ] || fail "readiness did not become healthy within 120 seconds: ${url}"
  printf '%s\n' "$response"

  assert_reconciliation_worker
  assert_retention_worker
}

case "$COMMAND" in
  start|up)
    start
    ;;
  stop|down)
    require_env_file
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
