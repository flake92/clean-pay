#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
ENV_FILE=${CLEAN_PAY_ZDT_ENV_FILE:-"$ROOT_DIR/deploy/prod/.env"}
COMPOSE_FILE="$ROOT_DIR/deploy/prod/docker-compose.yml"
IMAGE_PREFLIGHT_SCRIPT="$ROOT_DIR/deploy/prod/image-preflight.sh"
VALIDATE_ENV_SCRIPT="$ROOT_DIR/deploy/prod/validate-env.mjs"
ENV_GUARD_SCRIPT="$ROOT_DIR/deploy/prod/zero-downtime-env.mjs"
ROLE_ENV_SCRIPT="$ROOT_DIR/deploy/prod/role-env.mjs"
OPERATION_LOCK_SCRIPT="$ROOT_DIR/deploy/prod/production-operation-lock.mjs"
OPERATION_LOCK_PATH="$ROOT_DIR/deploy/prod/.production-operation.lock"
STATE_FILE=${CLEAN_PAY_ZDT_STATE_FILE:-"$ROOT_DIR/deploy/prod/.zero-downtime-state"}
LOCK_DIR="${STATE_FILE}.lock"
ROLLBACK_ENV_FILE=${CLEAN_PAY_ZDT_ROLLBACK_ENV_FILE:-}
CANARY_READINESS_TELEGRAM_OIDC_JWKS_URL=${CLEAN_PAY_ZDT_CANARY_READINESS_TELEGRAM_OIDC_JWKS_URL:-}
APP_ENV_FILE="${ENV_FILE}.app"
HOLD_OPERATOR_ENV_FILE="${ENV_FILE}.hold-operator"
MIGRATION_ENV_FILE="${ENV_FILE}.migration"
POSTGRES_ENV_FILE="${ENV_FILE}.postgres"
PROVISION_ENV_FILE="${ENV_FILE}.provision"
RECONCILIATION_ENV_FILE="${ENV_FILE}.reconciliation"
RETENTION_ENV_FILE="${ENV_FILE}.retention"

OWNER_LABEL='clean-pay-zdt-v1'
COMMAND=${1:-help}
ACKNOWLEDGEMENT=${2:-}

lock_held=0
operation_lock_token=''
verified_image_dir=''
verified_image_output=''
state_temp=''
cleanup_canary_on_failure=0
rollback_compose_on_failure=0

CANARY_NAME=''
CANARY_ALIAS=''
CANARY_PORT=''
PROJECT_NAME=''
INTERNAL_NETWORK=''
EDGE_NETWORK=''
PREVIOUS_APP_IMAGE=''
PREVIOUS_MIGRATION_IMAGE=''
TARGET_APP_IMAGE=''
TARGET_MIGRATION_IMAGE=''
RECONCILIATION_ENABLED=''
PROMOTED='false'
DISPOSABLE_CANARY_PROVIDER_VALIDATED=false

fail() {
  printf '%s\n' "Zero-downtime deployment failed: $*" >&2
  exit 1
}

info() {
  printf '%s\n' "Zero-downtime deployment: $*"
}

env_file_value() {
  value_file=$1
  name=$2
  fallback=${3:-}
  value=$(
    grep -E "^${name}=" "$value_file" 2>/dev/null \
      | tail -n 1 \
      | sed -e "s/^${name}=//" -e 's/\r$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
  )

  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

env_value() {
  env_file_value "$ENV_FILE" "$1" "${2:-}"
}

validate_absolute_state_path() {
  path_value=$1
  path_label=$2
  case "$path_value" in
    /*) ;;
    *) fail "$path_label path must be absolute" ;;
  esac
  if printf '%s' "$path_value" | LC_ALL=C grep -q '[[:cntrl:]=]'; then
    fail "$path_label path contains an unsupported character"
  fi
}

validate_container_name() {
  name=$1
  printf '%s' "$name" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' \
    || fail "invalid Docker container name: $name"
}

validate_network_name() {
  name=$1
  printf '%s' "$name" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' \
    || fail "invalid Docker network name: $name"
}

validate_project_name() {
  name=$1
  printf '%s' "$name" | grep -Eq '^[a-z0-9][a-z0-9_-]{0,62}$' \
    || fail "COMPOSE_PROJECT_NAME is not safe for the zero-downtime flow"
}

validate_alias() {
  alias_name=$1
  printf '%s' "$alias_name" | grep -Eq '^[a-z0-9][a-z0-9-]{0,62}$' \
    || fail "canary alias must be a lowercase DNS label"

  case "$alias_name" in
    clean-pay|app|postgres|redis)
      fail "canary alias $alias_name is reserved and could receive production traffic early"
      ;;
  esac
}

validate_port() {
  port=$1
  printf '%s' "$port" | grep -Eq '^[1-9][0-9]{0,4}$' \
    || fail "canary port must be a canonical integer"
  [ "$port" -le 65535 ] || fail "canary port must be at most 65535"
}

validate_canary_readiness_telegram_oidc_jwks_url() {
  DISPOSABLE_CANARY_PROVIDER_VALIDATED=false
  [ -n "$CANARY_READINESS_TELEGRAM_OIDC_JWKS_URL" ] || return 0
  printf '%s' "$PROJECT_NAME" | grep -Eq '^clean-pay-zdt-[a-f0-9]{16}$' \
    || fail "canary Telegram readiness override requires the disposable rehearsal project"
  suffix=${PROJECT_NAME#clean-pay-zdt-}
  expected_origin="http://zdt-readiness-${suffix}:4190"
  [ "$EDGE_NETWORK" = "clean-pay-zdt-edge-${suffix}" ] \
    || fail "canary Telegram readiness override requires the disposable rehearsal network"
  [ "$CANARY_READINESS_TELEGRAM_OIDC_JWKS_URL" = "$expected_origin/.well-known/jwks.json" ] \
    || fail "canary Telegram readiness override does not match the owned provider"
  [ "$(env_value REMNASHOP_API_BASE_URL)" = "$expected_origin/api/v1/public" ] \
    || fail "canary Telegram readiness override must share the Remnashop provider origin"
  DISPOSABLE_CANARY_PROVIDER_VALIDATED=true
}

validate_image_id() {
  image=$1
  printf '%s' "$image" | grep -Eq '^sha256:[a-f0-9]{64}$' \
    || fail "invalid immutable image ID in zero-downtime state"
}

compose() (
  # Preserve the reviewed path before scrubbing Compose's environment control
  # variable. Reusing COMPOSE_FILE after `unset COMPOSE_FILE` fails under
  # `set -u` and prevents every live rollout command from reaching Docker.
  compose_path=$COMPOSE_FILE
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

  if [ -n "$TARGET_APP_IMAGE" ]; then
    CLEAN_PAY_IMAGE=$TARGET_APP_IMAGE
    CLEAN_PAY_MIGRATION_IMAGE=$TARGET_MIGRATION_IMAGE
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

  if [ "$(env_value PAYMENT_RECONCILIATION_ENABLED true)" = "true" ]; then
    docker compose --env-file "$ENV_FILE" -f "$compose_path" \
      --profile reconciliation "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$compose_path" "$@"
  fi
)

acquire_lock() {
  state_parent=$(dirname -- "$STATE_FILE")
  [ -d "$state_parent" ] || fail "state directory does not exist: $state_parent"
  [ ! -L "$state_parent" ] || fail "state directory must not be a symbolic link"
  mkdir "$LOCK_DIR" 2>/dev/null \
    || fail "another zero-downtime command may be running; lock exists: $LOCK_DIR"
  lock_held=1
}

release_lock() {
  [ "$lock_held" -eq 1 ] || return 0
  if ! rmdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "WARNING: could not remove exact lock directory $LOCK_DIR" >&2
    return 1
  fi
  lock_held=0
}

acquire_production_operation_lock() {
  operation_name=$1
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

cleanup_private_files() {
  if [ -n "$verified_image_output" ] && [ -f "$verified_image_output" ]; then
    rm -f -- "$verified_image_output"
  fi
  if [ -n "$verified_image_dir" ] && [ -d "$verified_image_dir" ]; then
    rmdir "$verified_image_dir" 2>/dev/null || true
  fi
  if [ -n "$state_temp" ] && [ -f "$state_temp" ]; then
    rm -f -- "$state_temp"
  fi
  verified_image_output=''
  verified_image_dir=''
  state_temp=''
}

owned_canary_value() {
  container_name=$1
  format=$2
  docker inspect --format "$format" "$container_name" 2>/dev/null
}

assert_owned_canary_identity() {
  container_name=$1
  expected_owner=$(owned_canary_value "$container_name" \
    '{{ index .Config.Labels "io.clean-pay.zero-downtime.owner" }}') \
    || fail "canary container was not found: $container_name"
  expected_project=$(owned_canary_value "$container_name" \
    '{{ index .Config.Labels "io.clean-pay.zero-downtime.project" }}') \
    || fail "could not inspect canary project label"
  expected_alias=$(owned_canary_value "$container_name" \
    '{{ index .Config.Labels "io.clean-pay.zero-downtime.alias" }}') \
    || fail "could not inspect canary alias label"

  [ "$expected_owner" = "$OWNER_LABEL" ] \
    || fail "refusing to manage existing container $container_name: ownership label does not match"
  [ "$expected_project" = "$PROJECT_NAME" ] \
    || fail "refusing to manage $container_name: project label does not match"
  [ "$expected_alias" = "$CANARY_ALIAS" ] \
    || fail "refusing to manage $container_name: alias label does not match"
}

remove_owned_canary() {
  container_name=$1
  if ! docker inspect "$container_name" >/dev/null 2>&1; then
    return 0
  fi

  if ! (assert_owned_canary_identity "$container_name"); then
    printf '%s\n' "WARNING: preserving unverified container $container_name" >&2
    return 1
  fi

  docker rm -f "$container_name" >/dev/null \
    || {
      printf '%s\n' "WARNING: could not remove owned canary $container_name" >&2
      return 1
    }
}

restore_previous_compose() {
  rollback_compose_on_failure=0
  info "restoring the previous Compose application image while the canary remains available"
  TARGET_APP_IMAGE=$PREVIOUS_APP_IMAGE
  TARGET_MIGRATION_IMAGE=$PREVIOUS_MIGRATION_IMAGE

  if ! node "$ENV_GUARD_SCRIPT" restore-images "$ENV_FILE" "$ROLLBACK_ENV_FILE"; then
    printf '%s\n' \
      "CRITICAL: authoritative image configuration could not be restored; keep Caddy on the canary and investigate" >&2
    return 1
  fi
  if ! node "$ROLE_ENV_SCRIPT" materialize "$ENV_FILE"; then
    printf '%s\n' \
      "CRITICAL: role-scoped environments could not be refreshed after rollback" >&2
    return 1
  fi

  if ! compose up -d --no-deps --no-build --pull never --wait \
      --wait-timeout 180 app; then
    printf '%s\n' \
      "CRITICAL: previous app image could not be restored; keep Caddy on the canary and investigate" >&2
    return 1
  fi

  if [ "$RECONCILIATION_ENABLED" = "true" ]; then
    if ! compose up -d --no-deps --no-build --pull never --wait \
        --wait-timeout 180 retention-worker reconciliation-worker; then
      printf '%s\n' \
        "CRITICAL: previous workers could not be restored; keep Caddy on the canary and investigate" >&2
      return 1
    fi
  elif ! compose up -d --no-deps --no-build --pull never --wait \
      --wait-timeout 180 retention-worker; then
    printf '%s\n' \
      "CRITICAL: previous retention worker could not be restored; keep Caddy on the canary and investigate" >&2
    return 1
  fi

  assert_compose_stack_image "$PREVIOUS_APP_IMAGE"
  TARGET_APP_IMAGE=$PREVIOUS_APP_IMAGE
  return 0
}

on_exit() {
  status=$?
  trap - 0 HUP INT TERM
  set +e

  if [ "$status" -ne 0 ] && [ "$rollback_compose_on_failure" -eq 1 ]; then
    (restore_previous_compose) || true
  fi
  if [ "$status" -ne 0 ] && [ "$cleanup_canary_on_failure" -eq 1 ] \
      && [ -n "$CANARY_NAME" ]; then
    remove_owned_canary "$CANARY_NAME" || true
  fi

  cleanup_private_files
  if ! release_lock && [ "$status" -eq 0 ]; then
    status=1
  fi
  if [ -n "$operation_lock_token" ]; then
    if ! release_production_operation_lock; then
      printf '%s\n' \
        "WARNING: production operation lock release failed; inspect the fail-closed lock before retrying." >&2
      if [ "$status" -eq 0 ]; then
        status=1
      fi
    fi
  fi
  exit "$status"
}

trap on_exit 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

require_tools_and_environment() {
  command -v docker >/dev/null 2>&1 || fail "docker is required"
  command -v node >/dev/null 2>&1 || fail "node is required"
  command -v curl >/dev/null 2>&1 || fail "curl is required for host-port liveness"
  command -v stat >/dev/null 2>&1 || fail "GNU stat is required"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
  [ -f "$ENV_FILE" ] || fail "authoritative environment file not found: $ENV_FILE"
  [ ! -L "$ENV_FILE" ] || fail "authoritative environment file must not be a symbolic link"
  validate_absolute_state_path "$ENV_FILE" "authoritative environment file"
  node "$VALIDATE_ENV_SCRIPT" --clean-pay-env-file "$ENV_FILE"
  node "$ROLE_ENV_SCRIPT" materialize "$ENV_FILE"

  PROJECT_NAME=$(env_value COMPOSE_PROJECT_NAME clean-pay-prod)
  EDGE_NETWORK=$(env_value CLEAN_PAY_EDGE_NETWORK remnawave-network)
  RECONCILIATION_ENABLED=$(env_value PAYMENT_RECONCILIATION_ENABLED true)
  CANARY_NAME=${CLEAN_PAY_ZDT_CANARY_NAME:-"${PROJECT_NAME}-app-canary"}
  CANARY_ALIAS=${CLEAN_PAY_ZDT_CANARY_ALIAS:-clean-pay-canary}
  CANARY_PORT=${CLEAN_PAY_ZDT_CANARY_PORT:-4001}

  validate_project_name "$PROJECT_NAME"
  validate_network_name "$EDGE_NETWORK"
  validate_container_name "$CANARY_NAME"
  validate_alias "$CANARY_ALIAS"
  validate_port "$CANARY_PORT"
  validate_canary_readiness_telegram_oidc_jwks_url
  case "$RECONCILIATION_ENABLED" in true|false) ;; *) fail "invalid reconciliation setting" ;; esac
}

preflight_image_pair() {
  image_env_file=$1
  cleanup_private_files
  verified_image_dir=$(mktemp -d "${TMPDIR:-/tmp}/clean-pay-zdt-verified.XXXXXX") \
    || fail "could not create a private image-preflight directory"
  verified_image_output="$verified_image_dir/images.env"

  sh "$IMAGE_PREFLIGHT_SCRIPT" \
    "$(env_file_value "$image_env_file" CLEAN_PAY_DEPLOY_SOURCE build)" \
    "$(env_file_value "$image_env_file" CLEAN_PAY_IMAGE)" \
    "$(env_file_value "$image_env_file" CLEAN_PAY_MIGRATION_IMAGE)" \
    "$image_env_file" \
    "$(env_file_value "$image_env_file" NEXT_PUBLIC_APP_URL)" \
    "$(env_file_value "$image_env_file" NEXT_PUBLIC_BRAND_NAME 'Clean Pay')" \
    "$(env_file_value "$image_env_file" NEXT_PUBLIC_BRAND_LOGO_URL /clean-pay-logo.png)" \
    "$(env_file_value "$image_env_file" TURNSTILE_SITE_KEY)" \
    "$(env_file_value "$image_env_file" CLEAN_PAY_RELEASE local)" \
    "$(env_file_value "$image_env_file" CLEAN_PAY_REVISION local)" \
    "$verified_image_output"

  [ "$(wc -l < "$verified_image_output" | tr -d ' ')" = "2" ] \
    || fail "image preflight returned malformed output"
  PREFLIGHT_APP_IMAGE=$(sed -n 's/^CLEAN_PAY_VERIFIED_APP_IMAGE=//p' "$verified_image_output")
  PREFLIGHT_MIGRATION_IMAGE=$(sed -n 's/^CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=//p' "$verified_image_output")
  validate_image_id "$PREFLIGHT_APP_IMAGE"
  validate_image_id "$PREFLIGHT_MIGRATION_IMAGE"
  [ "$PREFLIGHT_APP_IMAGE" != "$PREFLIGHT_MIGRATION_IMAGE" ] \
    || fail "application and migration images must be different"

  cleanup_private_files
}

preflight_target_images() {
  preflight_image_pair "$ENV_FILE"
  TARGET_APP_IMAGE=$PREFLIGHT_APP_IMAGE
  TARGET_MIGRATION_IMAGE=$PREFLIGHT_MIGRATION_IMAGE
}

resolve_local_image_id() {
  image_ref=$1
  image_label=$2
  resolved_image=$(docker image inspect --format '{{.Id}}' "$image_ref") \
    || fail "cannot resolve $image_label image $image_ref to a local immutable ID"
  validate_image_id "$resolved_image"
  printf '%s' "$resolved_image"
}

image_role_label() {
  image_id=$1
  role_value=$(docker image inspect --format \
    '{{with .Config.Labels}}{{index . "io.clean-pay.role"}}{{end}}' \
    "$image_id") || fail "cannot inspect rollback image ID $image_id"

  case "$role_value" in
    ''|'<no value>') printf '' ;;
    *) printf '%s' "$role_value" ;;
  esac
}

resolve_rollback_image_references() {
  rollback_app_ref=$1
  rollback_migration_ref=$2
  RESOLVED_ROLLBACK_APP_IMAGE=$(resolve_local_image_id \
    "$rollback_app_ref" "rollback application")
  RESOLVED_ROLLBACK_MIGRATION_IMAGE=$(resolve_local_image_id \
    "$rollback_migration_ref" "rollback migration")
  [ "$RESOLVED_ROLLBACK_APP_IMAGE" != "$RESOLVED_ROLLBACK_MIGRATION_IMAGE" ] \
    || fail "rollback application and migration images must be different"

  rollback_app_role=$(image_role_label "$RESOLVED_ROLLBACK_APP_IMAGE")
  rollback_migration_role=$(image_role_label "$RESOLVED_ROLLBACK_MIGRATION_IMAGE")
  case "$rollback_app_role:$rollback_migration_role" in
    app:migration)
      ROLLBACK_IMAGE_MODE=strict
      ;;
    :)
      # Releases built before role/provenance labels existed cannot pass the
      # modern pair preflight. They are safe only as a rollback of the exact
      # healthy app/worker image discovered from running Compose containers.
      [ "$RESOLVED_ROLLBACK_APP_IMAGE" = "$PREVIOUS_APP_IMAGE" ] \
        || fail "legacy rollback application image does not match the running Compose image"
      ROLLBACK_IMAGE_MODE=legacy
      ;;
    *)
      fail "rollback images have partial or invalid io.clean-pay.role metadata"
      ;;
  esac
}

validate_legacy_rollback_environment() {
  case "$ROLLBACK_ENV_FILE" in
    *,*) fail "legacy rollback environment path cannot contain a comma" ;;
  esac

  docker run --rm \
    --pull never \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --user 0:0 \
    --mount "type=bind,src=$ROLLBACK_ENV_FILE,dst=/run/clean-pay-rollback.env,readonly" \
    --entrypoint node \
    "$RESOLVED_ROLLBACK_APP_IMAGE" \
    deploy/prod/validate-env.mjs --env-file /run/clean-pay-rollback.env \
    >/dev/null 2>&1 \
    || fail "the running legacy application image rejected the rollback environment"
}

preflight_rollback_images() {
  [ -n "$ROLLBACK_ENV_FILE" ] \
    || fail "CLEAN_PAY_ZDT_ROLLBACK_ENV_FILE is required for stage"
  validate_absolute_state_path "$ROLLBACK_ENV_FILE" "rollback environment file"
  node "$ENV_GUARD_SCRIPT" verify "$ENV_FILE" "$ROLLBACK_ENV_FILE"
  node "$VALIDATE_ENV_SCRIPT" --clean-pay-env-file "$ROLLBACK_ENV_FILE"
  resolve_rollback_image_references \
    "$(env_file_value "$ROLLBACK_ENV_FILE" CLEAN_PAY_IMAGE)" \
    "$(env_file_value "$ROLLBACK_ENV_FILE" CLEAN_PAY_MIGRATION_IMAGE)"

  if [ "$ROLLBACK_IMAGE_MODE" = "strict" ]; then
    preflight_image_pair "$ROLLBACK_ENV_FILE"
    [ "$PREFLIGHT_APP_IMAGE" = "$RESOLVED_ROLLBACK_APP_IMAGE" ] \
      || fail "rollback application image reference changed during preflight"
    [ "$PREFLIGHT_MIGRATION_IMAGE" = "$RESOLVED_ROLLBACK_MIGRATION_IMAGE" ] \
      || fail "rollback migration image reference changed during preflight"
  else
    validate_legacy_rollback_environment
    info "accepted a label-less legacy rollback pair pinned to local immutable image IDs"
  fi

  [ "$RESOLVED_ROLLBACK_APP_IMAGE" = "$PREVIOUS_APP_IMAGE" ] \
    || fail "rollback env application image does not match the running Compose image"
  PREVIOUS_MIGRATION_IMAGE=$RESOLVED_ROLLBACK_MIGRATION_IMAGE
}

compose_container_id() {
  service=$1
  ids=$(compose ps -q "$service") || fail "could not locate Compose service $service"
  [ -n "$ids" ] || fail "Compose service $service has no running container"
  [ "$(printf '%s\n' "$ids" | wc -l | tr -d ' ')" = "1" ] \
    || fail "Compose service $service must have exactly one running replica"
  printf '%s' "$ids" | grep -Eq '^[a-f0-9]{64}$' \
    || fail "Compose service $service returned an invalid container ID"
  printf '%s' "$ids"
}

assert_compose_service() {
  service=$1
  expected_image=${2:-}
  container_id=$(compose_container_id "$service")
  container_name=$(docker inspect --format '{{.Name}}' "$container_id" 2>/dev/null) \
    || fail "could not inspect Compose service $service"
  container_name=${container_name#/}
  project_label=$(docker inspect --format \
    '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id")
  service_label=$(docker inspect --format \
    '{{ index .Config.Labels "com.docker.compose.service" }}' "$container_id")
  oneoff_label=$(docker inspect --format \
    '{{ index .Config.Labels "com.docker.compose.oneoff" }}' "$container_id")
  running=$(docker inspect --format '{{.State.Running}}' "$container_id")
  health=$(docker inspect --format \
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")
  image_id=$(docker inspect --format '{{.Image}}' "$container_id")

  case "$container_name" in
    "${PROJECT_NAME}-${service}-1"|"${PROJECT_NAME}_${service}_1") ;;
    *) fail "unexpected Compose container name for $service: $container_name" ;;
  esac
  [ "$project_label" = "$PROJECT_NAME" ] || fail "$service project label does not match"
  [ "$service_label" = "$service" ] || fail "$service service label does not match"
  [ "$oneoff_label" = "False" ] || fail "$service is unexpectedly a one-off container"
  [ "$running" = "true" ] || fail "$service is not running"
  [ "$health" = "healthy" ] || fail "$service is not healthy ($health)"
  validate_image_id "$image_id"
  if [ -n "$expected_image" ]; then
    [ "$image_id" = "$expected_image" ] \
      || fail "$service image $image_id does not match expected $expected_image"
  fi

  ASSERTED_CONTAINER_ID=$container_id
  ASSERTED_IMAGE_ID=$image_id
}

assert_compose_stack_image() {
  expected_image=$1
  assert_compose_service app "$expected_image"
  assert_compose_service retention-worker "$expected_image"
  if [ "$RECONCILIATION_ENABLED" = "true" ]; then
    assert_compose_service reconciliation-worker "$expected_image"
  fi
}

discover_internal_network() {
  app_container_id=$1
  INTERNAL_NETWORK=''
  network_names=$(docker inspect --format \
    '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}' \
    "$app_container_id") || fail "could not inspect application networks"

  for network_name in $network_names; do
    validate_network_name "$network_name"
    network_project=$(docker network inspect --format \
      '{{ index .Labels "com.docker.compose.project" }}' "$network_name" 2>/dev/null || true)
    network_logical_name=$(docker network inspect --format \
      '{{ index .Labels "com.docker.compose.network" }}' "$network_name" 2>/dev/null || true)
    if [ "$network_project" = "$PROJECT_NAME" ] && [ "$network_logical_name" = "default" ]; then
      [ -z "$INTERNAL_NETWORK" ] \
        || fail "multiple Compose default networks matched project $PROJECT_NAME"
      INTERNAL_NETWORK=$network_name
    fi
  done

  [ -n "$INTERNAL_NETWORK" ] \
    || fail "could not find the labelled Compose default network for $PROJECT_NAME"
  [ "$INTERNAL_NETWORK" != "$EDGE_NETWORK" ] \
    || fail "internal and edge networks must be different"
  printf '%s\n' "$network_names" | grep -Fxq "$EDGE_NETWORK" \
    || fail "old application is not attached to configured edge network $EDGE_NETWORK"
  docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1 \
    || fail "edge network does not exist: $EDGE_NETWORK"
}

assert_no_pending_migrations() {
  info "validating the verified migration image role environment without network access"
  docker run --rm \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 128 \
    --memory 1g \
    --cpus 1.0 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --network none \
    --env-file "$MIGRATION_ENV_FILE" \
    --env CLEAN_PAY_RUNTIME_ROLE=migration \
    --entrypoint /usr/bin/env \
    "$TARGET_MIGRATION_IMAGE" \
    node deploy/prod/validate-env.mjs \
    || fail "migration image role environment validation failed"

  info "checking that the verified migration image has no pending Prisma migrations"
  # The wrapper parses the provision role contract, verifies the exact reviewed
  # database state, and then runs pinned Prisma `migrate status` with a minimal
  # child environment. The separately validated migration role remains NOLOGIN.
  docker run --rm \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 128 \
    --memory 1g \
    --cpus 1.0 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --network "$INTERNAL_NETWORK" \
    --env-file "$PROVISION_ENV_FILE" \
    --env CLEAN_PAY_RUNTIME_ROLE=migration \
    --entrypoint node \
    "$TARGET_MIGRATION_IMAGE" \
    deploy/prod/prisma-migration-status.mjs migrate status \
    || fail "pending, failed, or divergent Prisma migrations block this zero-downtime flow"
}

canary_network_aliases() {
  docker inspect --format \
    "{{range (index .NetworkSettings.Networks \"$EDGE_NETWORK\").Aliases}}{{println .}}{{end}}" \
    "$CANARY_NAME" 2>/dev/null
}

assert_canary_topology() {
  assert_owned_canary_identity "$CANARY_NAME"
  running=$(owned_canary_value "$CANARY_NAME" '{{.State.Running}}') \
    || fail "could not inspect canary state"
  restart_policy=$(owned_canary_value "$CANARY_NAME" '{{.HostConfig.RestartPolicy.Name}}') \
    || fail "could not inspect canary restart policy"
  image_id=$(owned_canary_value "$CANARY_NAME" '{{.Image}}') \
    || fail "could not inspect canary image"
  target_label=$(owned_canary_value "$CANARY_NAME" \
    '{{ index .Config.Labels "io.clean-pay.zero-downtime.target-image" }}') \
    || fail "could not inspect canary target label"
  previous_label=$(owned_canary_value "$CANARY_NAME" \
    '{{ index .Config.Labels "io.clean-pay.zero-downtime.previous-image" }}') \
    || fail "could not inspect canary previous-image label"
  network_names=$(owned_canary_value "$CANARY_NAME" \
    "{{range \$name, \$network := .NetworkSettings.Networks}}{{println \$name}}{{end}}") \
    || fail "could not inspect canary networks"

  [ "$running" = "true" ] || fail "canary is not running"
  [ "$restart_policy" = "unless-stopped" ] \
    || fail "canary restart policy does not survive a Docker daemon restart"
  [ "$image_id" = "$TARGET_APP_IMAGE" ] || fail "canary image does not match state"
  [ "$target_label" = "$TARGET_APP_IMAGE" ] || fail "canary target label does not match state"
  [ "$previous_label" = "$PREVIOUS_APP_IMAGE" ] \
    || fail "canary previous-image label does not match state"
  printf '%s\n' "$network_names" | grep -Fxq "$INTERNAL_NETWORK" \
    || fail "canary is not attached to internal network $INTERNAL_NETWORK"
  printf '%s\n' "$network_names" | grep -Fxq "$EDGE_NETWORK" \
    || fail "canary is not attached to edge network $EDGE_NETWORK"
  canary_network_aliases | grep -Fxq "$CANARY_ALIAS" \
    || fail "canary edge alias does not match state"
  canary_network_aliases | grep -Fxq 'clean-pay' \
    && fail "canary has the production clean-pay alias before traffic switch"
  return 0
}

diagnose_disposable_canary_provider() {
  [ "$DISPOSABLE_CANARY_PROVIDER_VALIDATED" = true ] || return 0
  if provider_contract_result=$(timeout --signal=TERM --kill-after=2s 8s \
    docker exec "$CANARY_NAME" node -e "
    (async()=>{
      const emit=(value)=>process.stdout.write(value+'\n');
      const override=process.env.CLEAN_PAY_READINESS_TELEGRAM_OIDC_JWKS_URL;
      const base=process.env.REMNASHOP_API_BASE_URL;
      const key=process.env.REMNASHOP_AUTH_SERVICE_KEY;
      const prefix='http://zdt-readiness-';
      const portSuffix=':4190';
      const jwksSuffix='/.well-known/jwks.json';
      const origin=typeof override==='string'&&override.endsWith(jwksSuffix)
        ?override.slice(0,-jwksSuffix.length):'';
      const resource=origin.startsWith(prefix)&&origin.endsWith(portSuffix)
        ?origin.slice(prefix.length,-portSuffix.length):'';
      const exactResource=resource.length===16
        &&Array.from(resource).every((value)=>'0123456789abcdef'.includes(value));
      if(!exactResource||override!==prefix+resource+portSuffix+jwksSuffix
        ||base!==origin+'/api/v1/public')return emit('provider-env-mismatch');
      if(typeof key!=='string'||key.length<24)return emit('provider-key-missing');
      const signal=AbortSignal.timeout(5000);
      const maximumJwksBytes=1048576;
      const readBounded=async(response)=>{
        const declared=response.headers.get('content-length');
        if(declared!==null&&/^\d+$/.test(declared)&&Number(declared)>maximumJwksBytes)throw new Error();
        if(!response.body)return '';
        const reader=response.body.getReader();const chunks=[];let bytes=0;
        try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
          if(bytes>maximumJwksBytes){await reader.cancel();throw new Error()}chunks.push(Buffer.from(value))}}
        finally{reader.releaseLock()}
        return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes));
      };
      const probe=async(input,expected,init)=>{
        const response=await fetch(input,{...(init??{}),cache:'no-store',redirect:'error',signal});
        const matches=response.status===expected;
        try{await response.body?.cancel()}catch{}
        return matches;
      };
      if(!await probe(base+'/plans/public',200))return emit('provider-plans-contract');
      const auth={method:'POST',headers:{'content-type':'application/json','x-remnashop-auth-service-key':key},body:'{}'};
      if(!await probe(base+'/auth/email/start',422,auth))return emit('provider-email-start-contract');
      if(!await probe(base+'/auth/identify',422,auth))return emit('provider-identify-contract');
      if(!await probe(base+'/auth/service-session',422,auth))return emit('provider-service-session-contract');
      if(!await probe(base+'/auth/notification-preferences',405,auth))return emit('provider-notification-contract');
      const jwksResponse=await fetch(override,{cache:'no-store',redirect:'error',signal});
      let jwks;
      try{
        if(jwksResponse.status!==200)throw new Error();
        jwks=JSON.parse(await readBounded(jwksResponse));
      }catch{
        try{await jwksResponse.body?.cancel()}catch{}
        return emit('provider-jwks-contract');
      }
      if(!jwks||typeof jwks!=='object'||Array.isArray(jwks)
        ||!Array.isArray(jwks.keys)||jwks.keys.length===0)return emit('provider-jwks-contract');
      return emit('provider-contract-ok');
    })().catch(()=>process.stdout.write('provider-transport-failed\n'));
  " 2>/dev/null); then
    :
  else
    provider_contract_result=provider-probe-failed
  fi
  case "$provider_contract_result" in
    provider-contract-ok|provider-env-mismatch|provider-key-missing|provider-plans-contract|provider-email-start-contract|provider-identify-contract|provider-service-session-contract|provider-notification-contract|provider-jwks-contract|provider-transport-failed|provider-probe-failed) ;;
    *) provider_contract_result=provider-probe-invalid ;;
  esac
  printf '%s\n' "$provider_contract_result" >&2
  return 0
}

wait_for_canary_readiness() {
  attempt=0
  last_readiness_result=request-failed
  while [ "$attempt" -lt 90 ]; do
    if readiness_result=$(docker exec "$CANARY_NAME" node -e "
      const maximumBytes=65536;
      const allowed=['database','redis','remnashop','telegramOidc','mailpit','remnawave'];
      const required=['database','redis','remnashop','telegramOidc'];
      const emit=(value,ok)=>{process.stdout.write(value+'\n');if(!ok)process.exitCode=1};
      const readBounded=async(response)=>{
        const declared=response.headers.get('content-length');
        if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maximumBytes))throw new Error();
        if(!response.body)return '';
        const reader=response.body.getReader();const chunks=[];let bytes=0;
        try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
          if(bytes>maximumBytes){await reader.cancel();throw new Error()}chunks.push(Buffer.from(value))}
        }finally{reader.releaseLock()}
        return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes));
      };
      fetch('http://127.0.0.1:4000/api/internal/health/readiness',{
        cache:'no-store',redirect:'error',
        headers:{'x-clean-pay-readiness-secret':process.env.READINESS_INTERNAL_SECRET},
        signal:AbortSignal.timeout(10000),
      }).then(async(response)=>{
        let body;try{body=JSON.parse(await readBounded(response))}catch{return emit('invalid-response',false)}
        const entries=body&&body.checks!==null&&typeof body.checks==='object'&&!Array.isArray(body.checks)
          ?Object.entries(body.checks):[];
        const checks=entries.map(([,check])=>check);
        const shaped=entries.length>0&&required.every((name)=>Object.hasOwn(body.checks,name))
          &&entries.every(([name,check])=>allowed.includes(name)&&check&&typeof check==='object'
            &&(check.status==='ok'||check.status==='down'));
        const valid=checks.length>0&&checks.every(check=>check&&typeof check==='object'&&check.status==='ok');
        if(response.status===200&&body.status==='ok'&&shaped&&valid)return emit('ready',true);
        const failed=shaped?allowed.find((name)=>body.checks[name]?.status==='down'):undefined;
        return emit(failed?'not-ready:'+failed:'invalid-response',false);
      }).catch(()=>emit('request-failed',false));
    " 2>/dev/null); then
      [ "$readiness_result" = ready ] \
        || fail "canary readiness probe returned an invalid success result"
      curl --fail --silent --show-error --max-time 10 \
        "http://127.0.0.1:${CANARY_PORT}/api/health/liveness" >/dev/null \
        || fail "canary is ready internally but its dedicated host port is unavailable"
      return 0
    fi
    case "$readiness_result" in
      not-ready:database|not-ready:redis|not-ready:remnashop|not-ready:telegramOidc|not-ready:mailpit|not-ready:remnawave|invalid-response|request-failed)
        last_readiness_result=$readiness_result
        ;;
      *) last_readiness_result=invalid-response ;;
    esac

    running=$(owned_canary_value "$CANARY_NAME" '{{.State.Running}}' 2>/dev/null || true)
    [ "$running" = "true" ] || {
      docker logs --tail=100 "$CANARY_NAME" >&2 || true
      fail "canary exited before readiness"
    }
    attempt=$((attempt + 1))
    sleep 2
  done

  case "$last_readiness_result" in
    not-ready:remnashop|not-ready:telegramOidc)
      diagnose_disposable_canary_provider
      ;;
  esac
  docker logs --tail=100 "$CANARY_NAME" >&2 || true
  fail "canary did not become ready within 180 seconds ($last_readiness_result)"
}

write_state() {
  promoted_value=$1
  state_temp="${STATE_FILE}.tmp.$$"
  if [ -e "$state_temp" ] || [ -L "$state_temp" ]; then
    fail "refusing to overwrite existing state temp file: $state_temp"
  fi
  umask 077
  (
    set -C
    {
      printf 'VERSION=2\n'
      printf 'PROJECT_NAME=%s\n' "$PROJECT_NAME"
      printf 'CANARY_NAME=%s\n' "$CANARY_NAME"
      printf 'CANARY_ALIAS=%s\n' "$CANARY_ALIAS"
      printf 'CANARY_PORT=%s\n' "$CANARY_PORT"
      printf 'INTERNAL_NETWORK=%s\n' "$INTERNAL_NETWORK"
      printf 'EDGE_NETWORK=%s\n' "$EDGE_NETWORK"
      printf 'ROLLBACK_ENV_FILE=%s\n' "$ROLLBACK_ENV_FILE"
      printf 'PREVIOUS_APP_IMAGE=%s\n' "$PREVIOUS_APP_IMAGE"
      printf 'PREVIOUS_MIGRATION_IMAGE=%s\n' "$PREVIOUS_MIGRATION_IMAGE"
      printf 'TARGET_APP_IMAGE=%s\n' "$TARGET_APP_IMAGE"
      printf 'TARGET_MIGRATION_IMAGE=%s\n' "$TARGET_MIGRATION_IMAGE"
      printf 'RECONCILIATION_ENABLED=%s\n' "$RECONCILIATION_ENABLED"
      printf 'PROMOTED=%s\n' "$promoted_value"
    } > "$state_temp"
  ) || fail "could not create private zero-downtime state"
  chmod 600 "$state_temp" || fail "could not protect zero-downtime state"
  mv "$state_temp" "$STATE_FILE" || fail "could not atomically publish zero-downtime state"
  state_temp=''
}

state_value() {
  name=$1
  matches=$(grep -c "^${name}=" "$STATE_FILE" 2>/dev/null || true)
  [ "$matches" = "1" ] || fail "state must contain exactly one $name entry"
  sed -n "s/^${name}=//p" "$STATE_FILE"
}

load_state() {
  [ -f "$STATE_FILE" ] || fail "zero-downtime state does not exist: $STATE_FILE"
  [ ! -L "$STATE_FILE" ] || fail "zero-downtime state must not be a symbolic link"
  [ "$(stat -c '%a' "$STATE_FILE")" = "600" ] \
    || fail "zero-downtime state permissions must be exactly 600"
  [ "$(stat -c '%u' "$STATE_FILE")" = "$(id -u)" ] \
    || fail "zero-downtime state must be owned by the current operator"
  [ "$(wc -l < "$STATE_FILE" | tr -d ' ')" = "14" ] \
    || fail "zero-downtime state has an unexpected number of entries"

  allowed_names='VERSION PROJECT_NAME CANARY_NAME CANARY_ALIAS CANARY_PORT INTERNAL_NETWORK EDGE_NETWORK ROLLBACK_ENV_FILE PREVIOUS_APP_IMAGE PREVIOUS_MIGRATION_IMAGE TARGET_APP_IMAGE TARGET_MIGRATION_IMAGE RECONCILIATION_ENABLED PROMOTED'
  while IFS='=' read -r state_name state_value_rest; do
    case " $allowed_names " in
      *" $state_name "*) ;;
      *) fail "zero-downtime state contains unsupported entry $state_name" ;;
    esac
    [ -n "$state_value_rest" ] || fail "zero-downtime state entry $state_name is empty"
  done < "$STATE_FILE"

  [ "$(state_value VERSION)" = "2" ] || fail "unsupported zero-downtime state version"
  state_project=$(state_value PROJECT_NAME)
  [ "$state_project" = "$PROJECT_NAME" ] || fail "state belongs to another Compose project"
  CANARY_NAME=$(state_value CANARY_NAME)
  CANARY_ALIAS=$(state_value CANARY_ALIAS)
  CANARY_PORT=$(state_value CANARY_PORT)
  INTERNAL_NETWORK=$(state_value INTERNAL_NETWORK)
  state_edge=$(state_value EDGE_NETWORK)
  [ "$state_edge" = "$EDGE_NETWORK" ] || fail "state belongs to another edge network"
  ROLLBACK_ENV_FILE=$(state_value ROLLBACK_ENV_FILE)
  PREVIOUS_APP_IMAGE=$(state_value PREVIOUS_APP_IMAGE)
  PREVIOUS_MIGRATION_IMAGE=$(state_value PREVIOUS_MIGRATION_IMAGE)
  TARGET_APP_IMAGE=$(state_value TARGET_APP_IMAGE)
  TARGET_MIGRATION_IMAGE=$(state_value TARGET_MIGRATION_IMAGE)
  state_reconciliation=$(state_value RECONCILIATION_ENABLED)
  [ "$state_reconciliation" = "$RECONCILIATION_ENABLED" ] \
    || fail "reconciliation configuration changed during zero-downtime deployment"
  PROMOTED=$(state_value PROMOTED)

  validate_container_name "$CANARY_NAME"
  validate_alias "$CANARY_ALIAS"
  validate_port "$CANARY_PORT"
  validate_network_name "$INTERNAL_NETWORK"
  validate_absolute_state_path "$ROLLBACK_ENV_FILE" "rollback environment file"
  validate_image_id "$PREVIOUS_APP_IMAGE"
  validate_image_id "$PREVIOUS_MIGRATION_IMAGE"
  validate_image_id "$TARGET_APP_IMAGE"
  validate_image_id "$TARGET_MIGRATION_IMAGE"
  case "$PROMOTED" in true|false) ;; *) fail "invalid PROMOTED state" ;; esac
  node "$ENV_GUARD_SCRIPT" verify "$ENV_FILE" "$ROLLBACK_ENV_FILE"
}

stage_canary() {
  [ "$ACKNOWLEDGEMENT" = "--require-no-pending-migrations" ] \
    || fail "stage requires --require-no-pending-migrations"
  if [ -e "$STATE_FILE" ] || [ -L "$STATE_FILE" ]; then
    fail "zero-downtime state already exists; finish or abort the active rollout"
  fi
  if docker inspect "$CANARY_NAME" >/dev/null 2>&1; then
    fail "container $CANARY_NAME already exists; refusing to replace an unverified canary"
  fi

  assert_compose_service app
  PREVIOUS_APP_IMAGE=$ASSERTED_IMAGE_ID
  old_app_container_id=$ASSERTED_CONTAINER_ID
  assert_compose_stack_image "$PREVIOUS_APP_IMAGE"
  discover_internal_network "$old_app_container_id"
  preflight_rollback_images
  preflight_target_images
  [ "$TARGET_APP_IMAGE" != "$PREVIOUS_APP_IMAGE" ] \
    || fail "target application image is already running"
  assert_no_pending_migrations

  cleanup_canary_on_failure=1
  docker create \
    --name "$CANARY_NAME" \
    --restart unless-stopped \
    --init \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 256 \
    --memory 1g \
    --cpus 1.0 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --tmpfs /app/.next/cache:rw,noexec,nosuid,nodev,size=128m,mode=0700,uid=1001,gid=1001 \
    --env-file "$APP_ENV_FILE" \
    --env CLEAN_PAY_RUNTIME_ROLE=application \
    --env "CLEAN_PAY_READINESS_TELEGRAM_OIDC_JWKS_URL=$CANARY_READINESS_TELEGRAM_OIDC_JWKS_URL" \
    --network "$INTERNAL_NETWORK" \
    --publish "127.0.0.1:${CANARY_PORT}:4000" \
    --label "io.clean-pay.zero-downtime.owner=$OWNER_LABEL" \
    --label "io.clean-pay.zero-downtime.project=$PROJECT_NAME" \
    --label "io.clean-pay.zero-downtime.alias=$CANARY_ALIAS" \
    --label "io.clean-pay.zero-downtime.previous-image=$PREVIOUS_APP_IMAGE" \
    --label "io.clean-pay.zero-downtime.target-image=$TARGET_APP_IMAGE" \
    "$TARGET_APP_IMAGE" >/dev/null \
    || fail "could not create canary"
  docker network connect --alias "$CANARY_ALIAS" "$EDGE_NETWORK" "$CANARY_NAME" \
    || fail "could not attach canary to the edge network"
  docker start "$CANARY_NAME" >/dev/null || fail "could not start canary"
  assert_canary_topology
  wait_for_canary_readiness
  write_state false
  cleanup_canary_on_failure=0

  info "canary is ready at edge alias ${CANARY_ALIAS}:4000 and host port 127.0.0.1:${CANARY_PORT}"
  info "the old Compose app and workers are still healthy on image $PREVIOUS_APP_IMAGE"
  info "validate and atomically switch Caddy using deploy/prod/zero-downtime-production-runbook.md"
}

verify_canary() {
  load_state
  assert_canary_topology
  wait_for_canary_readiness
  info "canary topology and detailed readiness are healthy"
}

promote_compose() {
  [ "$ACKNOWLEDGEMENT" = "--traffic-on-canary" ] \
    || fail "promote requires --traffic-on-canary after a verified Caddy switch"
  load_state
  [ "$PROMOTED" = "false" ] || fail "target Compose revision is already promoted"
  assert_canary_topology
  wait_for_canary_readiness
  preflight_target_images
  [ "$TARGET_APP_IMAGE" = "$(state_value TARGET_APP_IMAGE)" ] \
    || fail "configured application image changed after canary staging"
  [ "$TARGET_MIGRATION_IMAGE" = "$(state_value TARGET_MIGRATION_IMAGE)" ] \
    || fail "configured migration image changed after canary staging"
  assert_compose_stack_image "$PREVIOUS_APP_IMAGE"

  rollback_compose_on_failure=1
  compose up -d --no-deps --no-build --pull never --wait \
    --wait-timeout 180 app
  if [ "$RECONCILIATION_ENABLED" = "true" ]; then
    compose up -d --no-deps --no-build --pull never --wait \
      --wait-timeout 180 retention-worker reconciliation-worker
  else
    compose up -d --no-deps --no-build --pull never --wait \
      --wait-timeout 180 retention-worker
  fi
  assert_compose_stack_image "$TARGET_APP_IMAGE"
  write_state true
  rollback_compose_on_failure=0

  info "Compose app and workers are healthy on the target image while Caddy remains on the canary"
  info "atomically switch Caddy back to clean-pay:4000, verify externally, then remove the canary"
}

rollback_compose() {
  [ "$ACKNOWLEDGEMENT" = "--traffic-on-canary" ] \
    || fail "rollback requires --traffic-on-canary so restoration cannot interrupt HTTP traffic"
  load_state
  assert_canary_topology
  wait_for_canary_readiness
  staged_target_app=$TARGET_APP_IMAGE
  staged_target_migration=$TARGET_MIGRATION_IMAGE
  restore_previous_compose
  TARGET_APP_IMAGE=$staged_target_app
  TARGET_MIGRATION_IMAGE=$staged_target_migration
  write_state false
  info "previous Compose app and workers are healthy; return Caddy to clean-pay:4000 and verify"
}

remove_canary() {
  [ "$ACKNOWLEDGEMENT" = "--traffic-off-canary" ] \
    || fail "remove requires --traffic-off-canary after Caddy has been switched away"
  load_state
  assert_canary_topology
  if [ "$PROMOTED" = "true" ]; then
    assert_compose_stack_image "$TARGET_APP_IMAGE"
  else
    assert_compose_stack_image "$PREVIOUS_APP_IMAGE"
  fi
  remove_owned_canary "$CANARY_NAME" \
    || fail "could not remove the owned canary"
  rm -f -- "$STATE_FILE"
  info "owned canary and private rollout state were removed"
}

show_status() {
  load_state
  assert_canary_topology
  printf '%s\n' \
    "project=$PROJECT_NAME" \
    "canary=$CANARY_NAME" \
    "edge_alias=$CANARY_ALIAS" \
    "host_port=$CANARY_PORT" \
    "previous_image=$PREVIOUS_APP_IMAGE" \
    "target_image=$TARGET_APP_IMAGE" \
    "promoted=$PROMOTED"
}

usage() {
  cat <<'EOF'
Usage: deploy/prod/zero-downtime-app.sh <command> [guard]

  stage    --require-no-pending-migrations  Start and verify a separate canary.
  verify                                    Recheck canary topology and readiness.
  promote  --traffic-on-canary              Replace Compose app/workers behind canary traffic.
  rollback --traffic-on-canary              Restore the captured previous Compose image.
  remove   --traffic-off-canary             Remove only the owned canary and private state.
  status                                    Print non-secret rollout state.

This script never edits or reloads Caddy and never applies a database migration.
Follow deploy/prod/zero-downtime-production-runbook.md for the guarded proxy switches.
EOF
}

case "$COMMAND" in
  stage|verify|promote|rollback|remove|status)
    acquire_production_operation_lock "zero-downtime-$COMMAND"
    ;;
esac

case "$COMMAND" in
  help|-h|--help)
    usage
    ;;
  stage|verify|promote|rollback|remove|status)
    require_tools_and_environment
    acquire_lock
    case "$COMMAND" in
      stage) stage_canary ;;
      verify) verify_canary ;;
      promote) promote_compose ;;
      rollback) rollback_compose ;;
      remove) remove_canary ;;
      status) show_status ;;
    esac
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
