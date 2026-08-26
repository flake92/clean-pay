#!/usr/bin/env sh
set -eu
umask 077

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$ROOT_DIR/deploy/prod/.env"
ENV_EXAMPLE="$ROOT_DIR/deploy/prod/.env.example"
COMPOSE_PATH="$ROOT_DIR/deploy/prod/docker-compose.yml"
REMNASHOP_ROLLOUT_SCRIPT="$ROOT_DIR/deploy/prod/prepare-remnashop-rollout.sh"
IMAGE_PREFLIGHT_SCRIPT="$ROOT_DIR/deploy/prod/image-preflight.sh"
BUILD_PROVENANCE_SCRIPT="$ROOT_DIR/deploy/prod/build-provenance.sh"
ROLE_ENV_SCRIPT="$ROOT_DIR/deploy/prod/role-env.mjs"
CREDENTIAL_INIT_SCRIPT="$ROOT_DIR/deploy/prod/database-credential-init.mjs"
CREDENTIAL_FILE_GUARD_SCRIPT="$ROOT_DIR/deploy/prod/credential-file-guard.mjs"
OPERATION_LOCK_SCRIPT="$ROOT_DIR/deploy/prod/production-operation-lock.mjs"
OPERATION_LOCK_PATH="$ROOT_DIR/deploy/prod/.production-operation.lock"
NODE_TOOLING_IMAGE="node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d"
APP_ENV_FILE="${ENV_FILE}.app"
HOLD_OPERATOR_ENV_FILE="${ENV_FILE}.hold-operator"
MIGRATION_ENV_FILE="${ENV_FILE}.migration"
POSTGRES_ENV_FILE="${ENV_FILE}.postgres"
PROVISION_ENV_FILE="${ENV_FILE}.provision"
RECONCILIATION_ENV_FILE="${ENV_FILE}.reconciliation"
RETENTION_ENV_FILE="${ENV_FILE}.retention"
verified_image_dir=''
verified_image_output=''
CLEAN_PAY_VERIFIED_APP_IMAGE=''
CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=''
secret_input_stty=''
operation_lock_token=''

. "$ROOT_DIR/deploy/prod/redis-host-safety.sh"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n%s\n' "$*"; }
ok() { printf 'OK: %s\n' "$*"; }

is_interactive() { [ -t 0 ] && [ -t 1 ]; }

confirm() {
  question=$1
  default=${2:-no}
  if [ "$default" = "yes" ]; then
    suffix='[Y/n]'
  else
    suffix='[y/N]'
  fi

  printf '%s %s ' "$question" "$suffix"
  IFS= read -r answer || answer=''
  case "$answer" in
    y|Y|yes|YES|Yes|д|Д|да|ДА|Да) return 0 ;;
    n|N|no|NO|No|н|Н|нет|НЕТ|Нет) return 1 ;;
    '') [ "$default" = "yes" ] ;;
    *) printf 'Введите «да» или «нет».\n'; confirm "$question" "$default" ;;
  esac
}

need_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install it with: curl -fsSL https://get.docker.com | sh"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is not installed."
}

assert_private_env_file() {
  if command -v node >/dev/null 2>&1; then
    node "$CREDENTIAL_FILE_GUARD_SCRIPT" file "$ENV_FILE"
    return
  fi

  [ ! -L "$ENV_FILE" ] && [ -f "$ENV_FILE" ] \
    || die "Production environment file must be a regular non-symlink file."
  command -v stat >/dev/null 2>&1 \
    || die "node or stat is required to validate production environment metadata."
  [ "$(stat -c '%a' "$ENV_FILE")" = "600" ] \
    || die "Production environment file permissions must be exactly 600."
  [ "$(stat -c '%u' "$ENV_FILE")" = "$(id -u)" ] \
    || die "Production environment file must be owned by the current operator."
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

compose() (
  # Compose gives the parent shell precedence over --env-file. Remove every
  # variable used for interpolation so deploy/prod/.env remains authoritative.
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
      || die 'Verified mode requires both immutable application and migration image IDs.'
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

  if [ "$(env_value PAYMENT_RECONCILIATION_ENABLED true)" = "true" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_PATH" --profile reconciliation "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_PATH" "$@"
  fi
)

replace_env() {
  name=$1
  value=$2
  assert_private_env_file
  case "$value" in
    *'$'*|*'#'*) die "$name contains a value that is unsafe for an env file." ;;
    *'
'*) die "$name contains a newline that is unsafe for an env file." ;;
  esac
  if printf '%s' "$value" | LC_ALL=C grep -q '[[:cntrl:]]'; then
    die "$name contains a control character that is unsafe for an env file."
  fi

  if command -v node >/dev/null 2>&1; then
    printf '%s' "$value" \
      | node "$CREDENTIAL_FILE_GUARD_SCRIPT" env-set "$ENV_FILE" "$name" \
      || die "Could not safely update $name in the production environment file."
  else
    need_docker
    printf '%s' "$value" \
      | docker run --rm --interactive --read-only --network none \
        --cap-drop ALL \
        --security-opt no-new-privileges \
        --pids-limit 64 \
        --memory 256m \
        --cpus 0.5 \
        --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
        --user "$(id -u):$(id -g)" \
        --mount "type=bind,source=$ROOT_DIR,target=/workspace" \
        --workdir /workspace \
        "$NODE_TOOLING_IMAGE" \
        node deploy/prod/credential-file-guard.mjs env-set \
          deploy/prod/.env "$name" \
      || die "Could not safely update $name in the production environment file."
  fi
  assert_private_env_file
}

ensure_generated_secret() {
  name=$1
  value=$(env_value "$name")
  case "$value" in
    ''|*change-me*) replace_env "$name" "$(openssl rand -hex 32)" ;;
  esac
}

ensure_internal_secrets() {
  ensure_generated_secret WEB_JWT_SECRET
  ensure_generated_secret WEB_REFRESH_SECRET
  ensure_generated_secret AUDIT_IP_HASH_SECRET
  ensure_generated_secret RATE_LIMIT_IDENTITY_SECRET
  ensure_generated_secret READINESS_INTERNAL_SECRET
  ensure_generated_secret PAYMENT_RECONCILIATION_SECRET
  ensure_generated_secret REMNASHOP_AUTH_SERVICE_KEY
}

initialize_database_credentials() {
  if command -v node >/dev/null 2>&1; then
    node "$CREDENTIAL_INIT_SCRIPT" init "$ENV_FILE"
    return
  fi

  need_docker
  docker run --rm --read-only --network none \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 256m \
    --cpus 0.5 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
    --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$ROOT_DIR,target=/workspace" \
    --workdir /workspace \
    "$NODE_TOOLING_IMAGE" \
    node deploy/prod/database-credential-init.mjs init deploy/prod/.env
}

init() {
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."
  if [ -e "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
    assert_private_env_file
    initialize_database_credentials
    ensure_internal_secrets
    printf 'Configuration already exists: %s\nExisting values were preserved; missing internal secrets were generated.\n' "$ENV_FILE"
    return
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  assert_private_env_file
  initialize_database_credentials
  ensure_internal_secrets
  printf '\nCreated %s and generated local secrets.\n' "$ENV_FILE"
  printf 'Run ./deploy.sh setup to continue in the interactive installer.\n'
}

require_env() {
  [ -e "$ENV_FILE" ] || [ -L "$ENV_FILE" ] \
    || die "Configuration is missing. Run ./deploy.sh init first."
  assert_private_env_file
}

ensure_network() {
  network=$(env_value CLEAN_PAY_EDGE_NETWORK)
  [ -n "$network" ] || network=remnawave-network
  docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network" >/dev/null
}

ensure_redis_host_memory_policy() {
  # redis-host-safety.sh reads /proc/sys/vm/overcommit_memory inside the
  # selected Docker daemon, rather than from this script's local host.
  probe_redis_host_memory_policy || die "$REDIS_HOST_MEMORY_POLICY_FAILURE"
}

prompt_value() {
  name=$1
  label=$2
  fallback=${3:-}
  current=$(env_value "$name" "$fallback")
  printf '%s\n' "$label"
  printf '  [%s]: ' "$current"
  IFS= read -r answer || answer=''
  [ -n "$answer" ] || answer=$current
  [ -n "$answer" ] || die "$name is required."
  replace_env "$name" "$answer"
}

prompt_secret() {
  name=$1
  label=$2
  current=$(env_value "$name")
  keep_hint=''
  case "$current" in
    ''|*change-me*) ;;
    *) keep_hint=' (Enter — оставить текущее значение)' ;;
  esac

  printf '%s%s: ' "$label" "$keep_hint"
  secret_input_stty=''
  if command -v stty >/dev/null 2>&1; then
    secret_input_stty=$(stty -g 2>/dev/null || true)
    stty -echo 2>/dev/null || true
  fi
  IFS= read -r answer || answer=''
  restore_secret_input_terminal
  printf '\n'

  if [ -z "$answer" ]; then
    case "$current" in
      ''|*change-me*) die "$name is required." ;;
      *) return ;;
    esac
  fi
  replace_env "$name" "$answer"
}

configure() {
  is_interactive || die "Interactive configuration requires a terminal. Use ./deploy.sh init and edit deploy/prod/.env manually."
  init

  info '[1/3] Настройка Clean Pay'
  printf 'Нажимайте Enter, чтобы сохранить предложенное значение. Секреты на экране не отображаются.\n\n'

  prompt_value APP_URL 'Публичный HTTPS-адрес Clean Pay, без пути' 'https://pay.example.com'
  replace_env NEXT_PUBLIC_APP_URL "$(env_value APP_URL)"
  prompt_value NEXT_PUBLIC_BRAND_NAME 'Название сервиса' 'Clean Pay'
  prompt_value CLEAN_PAY_EDGE_NETWORK 'Docker-сеть reverse proxy и Remnashop' 'remnawave-network'

  prompt_value REMNASHOP_API_BASE_URL 'Публичный API Remnashop (должен оканчиваться /api/v1/public)' 'http://remnashop:5000/api/v1/public'
  public_api=$(env_value REMNASHOP_API_BASE_URL)
  admin_default=$(printf '%s' "$public_api" | sed 's|/api/v1/public$|/api/v1/admin|')
  admin_current=$(env_value REMNASHOP_ADMIN_API_BASE_URL)
  case "$admin_current" in
    ''|*example.com*) replace_env REMNASHOP_ADMIN_API_BASE_URL "$admin_default" ;;
  esac
  prompt_value REMNASHOP_ADMIN_API_BASE_URL 'Admin API Remnashop (должен оканчиваться /api/v1/admin)' "$admin_default"
  prompt_secret REMNASHOP_API_KEY 'APP_API_KEY из Remnashop'

  auth_service_key=$(env_value REMNASHOP_AUTH_SERVICE_KEY)
  case "$auth_service_key" in
    ''|*change-me*) replace_env REMNASHOP_AUTH_SERVICE_KEY "$(openssl rand -hex 32)" ;;
  esac

  prompt_value REMNAWAVE_API_BASE_URL 'Публичный HTTPS-адрес Remnawave, без пути' 'https://panel.example.com'
  replace_env CLEAN_PAY_READINESS_REMNAWAVE_URL "$(env_value REMNAWAVE_API_BASE_URL)"
  prompt_secret REMNAWAVE_TOKEN 'API-токен Remnawave'
  prompt_value REMNAWAVE_SUBSCRIPTION_ORIGINS 'Разрешённые HTTPS origin ссылок подписки (через запятую)' 'https://sub.example.com'

  prompt_secret TELEGRAM_BOT_TOKEN 'Токен Telegram-бота'
  bot_token=$(env_value TELEGRAM_BOT_TOKEN)
  bot_id=${bot_token%%:*}
  case "$bot_id" in
    ''|*[!0-9]*) die 'TELEGRAM_BOT_TOKEN must start with a numeric bot ID followed by a colon.' ;;
  esac
  replace_env TELEGRAM_OIDC_CLIENT_ID "$bot_id"
  prompt_secret TELEGRAM_OIDC_CLIENT_SECRET 'Telegram OIDC client secret'

  prompt_secret TURNSTILE_SITE_KEY 'Cloudflare Turnstile site key для домена Clean Pay'
  prompt_secret TURNSTILE_SECRET_KEY 'Cloudflare Turnstile secret key'

  if confirm 'Включить фоновую сверку платежей?' yes; then
    replace_env PAYMENT_RECONCILIATION_ENABLED true
  else
    replace_env PAYMENT_RECONCILIATION_ENABLED false
  fi

  assert_private_env_file
  ok "конфигурация сохранена в $ENV_FILE"
  printf 'Важно: скопируйте REMNASHOP_AUTH_SERVICE_KEY из этого файла в APP_AUTH_SERVICE_KEY Remnashop.\n'

  if confirm 'Открыть расширенные настройки в текстовом редакторе?' no; then
    editor=${EDITOR:-}
    if [ -z "$editor" ]; then
      if command -v nano >/dev/null 2>&1; then editor=nano; else editor=vi; fi
    fi
    "$editor" "$ENV_FILE"
    assert_private_env_file
  fi
}

assert_required_env() {
  required_names='APP_URL NEXT_PUBLIC_APP_URL REMNASHOP_API_BASE_URL REMNASHOP_ADMIN_API_BASE_URL REMNASHOP_API_KEY REMNASHOP_AUTH_SERVICE_KEY REMNAWAVE_API_BASE_URL REMNAWAVE_TOKEN REMNAWAVE_SUBSCRIPTION_ORIGINS TELEGRAM_OIDC_CLIENT_ID TELEGRAM_OIDC_CLIENT_SECRET TELEGRAM_BOT_TOKEN TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY'
  for name in $required_names; do
    value=$(env_value "$name")
    [ -n "$value" ] || die "$name is empty. Run ./deploy.sh setup."
    case "$value" in
      *change-me*|*example.com*) die "$name still contains a placeholder. Run ./deploy.sh setup." ;;
    esac
  done
}

validate_env_file() {
  if command -v node >/dev/null 2>&1; then
    node "$ROOT_DIR/deploy/prod/validate-env.mjs" --clean-pay-env-file "$ENV_FILE"
    return
  fi

  docker run --rm --read-only --network none \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 256m \
    --cpus 0.5 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
    --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$ROOT_DIR,target=/workspace,readonly" \
    --workdir /workspace \
    "$NODE_TOOLING_IMAGE" \
    node deploy/prod/validate-env.mjs --clean-pay-env-file deploy/prod/.env
}

materialize_role_env_files() {
  if command -v node >/dev/null 2>&1; then
    node "$ROLE_ENV_SCRIPT" materialize "$ENV_FILE"
    return
  fi

  operator_uid=$(id -u)
  operator_gid=$(id -g)
  docker run --rm --read-only --network none \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 256m \
    --cpus 0.5 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
    --user "${operator_uid}:${operator_gid}" \
    --mount "type=bind,source=$ROOT_DIR,target=/workspace" \
    --workdir /workspace \
    "$NODE_TOOLING_IMAGE" \
    node deploy/prod/role-env.mjs materialize deploy/prod/.env
}

prepare_compose() {
  init
  need_docker
  assert_required_env
  info '[2/3] Подготовка Docker Compose'
  [ -f "$COMPOSE_PATH" ] || die "Compose file is missing: $COMPOSE_PATH"
  validate_env_file
  materialize_role_env_files
  ensure_redis_host_memory_policy
  ensure_network
  compose config --quiet
  ok "Compose-файл проверен: $COMPOSE_PATH"
  ok "Docker-сеть готова: $(env_value CLEAN_PAY_EDGE_NETWORK remnawave-network)"
}

available_disk_kb() {
  df -Pk "$ROOT_DIR" | awk 'NR == 2 { print $4 }'
}

ensure_build_disk_space() {
  min_mb=$(env_value CLEAN_PAY_MIN_FREE_DISK_MB 8192)
  case "$min_mb" in
    ''|*[!0-9]*) die "CLEAN_PAY_MIN_FREE_DISK_MB must be a positive integer." ;;
  esac
  [ "$min_mb" -gt 0 ] || die "CLEAN_PAY_MIN_FREE_DISK_MB must be greater than zero."
  min_kb=$((min_mb * 1024))
  available_kb=$(available_disk_kb)
  [ -n "$available_kb" ] || die "Could not determine available disk space."

  if [ "$available_kb" -lt "$min_kb" ]; then
    printf 'Only %s MB is free. Removing unused Docker build cache and dangling images...\n' "$((available_kb / 1024))"
    docker builder prune -af >/dev/null
    docker image prune -f >/dev/null
    available_kb=$(available_disk_kb)
  fi

  [ "$available_kb" -ge "$min_kb" ] || die "Only $((available_kb / 1024)) MB is free after safe Docker cleanup; at least ${min_mb} MB is required before a build."
}

deployment_source() {
  env_value CLEAN_PAY_DEPLOY_SOURCE build
}

prepare_images() {
  deploy_source=$(deployment_source)

  case "$deploy_source" in
    build)
      ensure_build_disk_space
      sh "$BUILD_PROVENANCE_SCRIPT" \
        "$ROOT_DIR" \
        "$deploy_source" \
        "$(env_value CLEAN_PAY_RELEASE local)" \
        "$(env_value CLEAN_PAY_REVISION local)"
      printf 'Building reviewed Clean Pay application and migration images...\n'
      compose build migration app
      ;;
    pull)
      printf 'Pulling digest-pinned Clean Pay application and migration images...\n'
      compose pull migration app
      ;;
    *)
      die 'CLEAN_PAY_DEPLOY_SOURCE must be build or pull.'
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

restore_secret_input_terminal() {
  if [ -n "$secret_input_stty" ]; then
    stty "$secret_input_stty" 2>/dev/null || true
    secret_input_stty=''
  fi
}

cleanup_deploy_state() {
  status=$?
  trap - 0 HUP INT TERM
  set +e
  restore_secret_input_terminal
  cleanup_verified_images
  if [ -n "$operation_lock_token" ]; then
    if release_production_operation_lock; then
      operation_lock_token=''
    else
      printf '%s\n' 'WARNING: production operation lock release failed; inspect the fail-closed lock before retrying.' >&2
      if [ "$status" -eq 0 ]; then
        status=1
      fi
    fi
  fi
  exit "$status"
}

operation_lock_command() {
  if command -v node >/dev/null 2>&1; then
    node "$OPERATION_LOCK_SCRIPT" "$@"
    return
  fi
  lock_mode=$1
  shift
  shift
  need_docker
  docker run --rm --read-only --network none \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 32 \
    --memory 128m \
    --cpus 0.25 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=8m,mode=1777 \
    --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$ROOT_DIR,target=/workspace" \
    --workdir /workspace \
    "$NODE_TOOLING_IMAGE" \
    node deploy/prod/production-operation-lock.mjs \
      "$lock_mode" deploy/prod/.production-operation.lock "$@"
}

acquire_production_operation_lock() {
  operation_name=$1
  operation_lock_token=$(operation_lock_command \
    acquire "$OPERATION_LOCK_PATH" "$operation_name" "$$") \
    || die 'Another production operation is active or the fail-closed operation lock needs reviewed recovery.'
  printf '%s\n' "$operation_lock_token" | grep -Eq '^[0-9a-f]{64}$' \
    || die 'Production operation lock returned an invalid ownership token.'
}

release_production_operation_lock() {
  operation_lock_command release "$OPERATION_LOCK_PATH" "$operation_lock_token"
}

trap cleanup_deploy_state 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

preflight_images() {
  preflight_app_image=${1:-$(env_value CLEAN_PAY_IMAGE)}
  preflight_migration_image=${2:-$(env_value CLEAN_PAY_MIGRATION_IMAGE)}
  preflight_deploy_source=$(deployment_source)
  case "$preflight_deploy_source" in
    build|pull) ;;
    *) die 'CLEAN_PAY_DEPLOY_SOURCE must be build or pull.' ;;
  esac
  cleanup_verified_images
  verified_image_dir=$(mktemp -d "${TMPDIR:-/tmp}/clean-pay-verified.XXXXXX") \
    || die 'Could not create a private verified-image directory.'
  verified_image_output="$verified_image_dir/images.env"

  sh "$IMAGE_PREFLIGHT_SCRIPT" \
    "$preflight_deploy_source" \
    "$preflight_app_image" \
    "$preflight_migration_image" \
    "$ENV_FILE" \
    "$(env_value NEXT_PUBLIC_APP_URL)" \
    "$(env_value NEXT_PUBLIC_BRAND_NAME Clean Pay)" \
    "$(env_value NEXT_PUBLIC_BRAND_LOGO_URL /clean-pay-logo.png)" \
    "$(env_value TURNSTILE_SITE_KEY)" \
    "$(env_value CLEAN_PAY_RELEASE local)" \
    "$(env_value CLEAN_PAY_REVISION local)" \
    "$verified_image_output"

  [ "$(wc -l < "$verified_image_output" | tr -d ' ')" = "2" ] \
    || die 'Image preflight returned malformed verified-image output.'
  CLEAN_PAY_VERIFIED_APP_IMAGE=$(sed -n 's/^CLEAN_PAY_VERIFIED_APP_IMAGE=//p' "$verified_image_output")
  CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=$(sed -n 's/^CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=//p' "$verified_image_output")
  printf '%s\n' "$CLEAN_PAY_VERIFIED_APP_IMAGE" | grep -Eq '^sha256:[a-f0-9]{64}$' \
    || die 'Image preflight returned an invalid application image ID.'
  printf '%s\n' "$CLEAN_PAY_VERIFIED_MIGRATION_IMAGE" | grep -Eq '^sha256:[a-f0-9]{64}$' \
    || die 'Image preflight returned an invalid migration image ID.'
  [ "$CLEAN_PAY_VERIFIED_APP_IMAGE" != "$CLEAN_PAY_VERIFIED_MIGRATION_IMAGE" ] \
    || die 'Image preflight returned the same ID for both image roles.'
}

prepare_runtime_dependencies() {
  compose pull --policy missing postgres redis
}

stop_runtime_services() {
  printf 'Stopping application runtimes for the database migration; PostgreSQL and Redis stay running...\n'
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

recovery_preflight_database_roles() {
  recovery_migration_name=$1
  compose rm -f -s db-role-provision || return 1
  compose run --rm --no-deps --pull never db-role-provision \
    node deploy/prod/database-role-provision.mjs recovery-preflight \
      "$recovery_migration_name" || return 1
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
  printf '%s\n' 'Migration/grant synchronization failed; re-fencing every non-bootstrap database role...' >&2
  fence_database_roles \
    || printf '%s\n' 'WARNING: automatic database-role re-fence failed; keep all runtimes stopped and repair the fence before retrying.' >&2
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

preflight_runtime_restart_image() {
  app_container_id=$(compose ps --all --quiet app) \
    || die 'Could not resolve the existing application container.'
  [ -n "$app_container_id" ] \
    || die 'No existing application container was found. Run ./deploy.sh install instead.'
  [ "$(printf '%s\n' "$app_container_id" | wc -l | tr -d ' ')" = "1" ] \
    || die 'More than one application container matched the production Compose project.'

  restart_app_image=$(docker inspect --format '{{.Image}}' "$app_container_id") \
    || die 'Could not resolve the immutable image of the existing application container.'
  printf '%s\n' "$restart_app_image" | grep -Eq '^sha256:[a-f0-9]{64}$' \
    || die 'The existing application container has an invalid image ID.'
  restart_app_role=$(docker image inspect \
    --format '{{ index .Config.Labels "io.clean-pay.role" }}' \
    "$restart_app_image") \
    || die 'Could not inspect the existing application image.'
  [ "$restart_app_role" = "app" ] \
    || die 'The existing application image is not a verified Clean Pay app image. Run ./deploy.sh install instead.'

  docker run --rm --interactive \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 256m \
    --cpus 0.5 \
    --entrypoint node \
    "$restart_app_image" \
    deploy/prod/validate-env.mjs --runtime-env-stdin < "$ENV_FILE" \
    || die 'The running application image rejected the updated production environment.'

  # Validate the configured migration companion against the exact running app
  # image, then pin both immutable IDs. Role preparation must never fall back to
  # a mutable/local migration image during a credential-only restart.
  preflight_images \
    "$restart_app_image" \
    "$(env_value CLEAN_PAY_MIGRATION_IMAGE)"
  [ "$CLEAN_PAY_VERIFIED_APP_IMAGE" = "$restart_app_image" ] \
    || die 'Restart image preflight did not preserve the exact running application image.'
}

restart_runtime_services() {
  info '[restart] Пересоздание runtime с актуальными role-scoped env-файлами'
  preflight_runtime_restart_image
  prepare_runtime_dependencies
  stop_runtime_services
  compose up -d --no-build --pull never --wait --wait-timeout 120 postgres redis \
    || die 'PostgreSQL or Redis did not become healthy during runtime recreation.'
  prepare_database_roles \
    || die 'Database role credential reconciliation failed; runtimes remain stopped.'
  sync_database_privileges \
    || die 'Database privilege verification failed; runtimes remain stopped.'

  # A plain Compose restart preserves the old container configuration and does
  # not apply env_file changes. Remove only the stateless Clean
  # Pay runtimes, then recreate them on the exact preflighted application image.
  # Explicitly include reconciliation-worker so disabling its profile cannot
  # leave an old container (and its old secret) behind.
  if ! compose rm -f -s reconciliation-worker retention-worker app \
    || ! start_verified_runtimes; then
    printf '\nRuntime recreation failed. Recent logs:\n' >&2
    compose logs --tail=200 >&2 || true
    die 'Updated role environments were not applied successfully.'
  fi

  cleanup_verified_images
  verify_detailed_readiness
  printf 'Clean Pay runtime containers were recreated with the updated role environments and are healthy.\n'
}

cleanup_build_artifacts() {
  # Keep fresh layers for quick retries, but never accumulate old build cache
  # and dangling application images until PostgreSQL runs out of disk space.
  docker builder prune -af --filter until=24h >/dev/null || true
  docker image prune -f >/dev/null || true
}

verify_external_security_headers() {
  app_url=$(env_value APP_URL)
  [ -n "$app_url" ] || die "APP_URL is required for the external security-header check."
  command -v curl >/dev/null 2>&1 || die "curl is required for the external security-header check."
  headers=$(curl --fail --show-error --silent --head --max-time 15 "${app_url%/}/api/health/liveness") \
    || die "External HTTPS liveness check failed."
  hsts=$(printf '%s\n' "$headers" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} /^strict-transport-security:/{sub(/^[^:]*:[[:space:]]*/, ""); print; exit}')
  csp=$(printf '%s\n' "$headers" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} /^content-security-policy:/{sub(/^[^:]*:[[:space:]]*/, ""); print; exit}')

  hsts_max_age=$(printf '%s' "$hsts" | sed -n 's/.*[Mm][Aa][Xx]-[Aa][Gg][Ee]=\([0-9][0-9]*\).*/\1/p')
  case "$hsts_max_age" in
    ''|*[!0-9]*) die "External HTTPS response is missing a one-year HSTS policy." ;;
  esac
  [ "$hsts_max_age" -ge 31536000 ] \
    || die "External HTTPS response is missing a one-year HSTS policy."
  script_policy=$(printf '%s' "$csp" | tr ';' '\n' | awk 'BEGIN{IGNORECASE=1} /^[[:space:]]*script-src[[:space:]]/{sub(/^[[:space:]]*script-src[[:space:]]*/, ""); print; exit}')
  printf '%s' "$script_policy" | grep -Eq "'nonce-[^']+'" \
    || die "External HTTPS response is missing a nonce-based script CSP."
  if printf '%s' "$csp" | grep -Fiq "'unsafe-inline'"; then
    die "External script CSP still permits unsafe-inline."
  fi

  printf 'External HTTPS security headers are valid.\n'
}

verify_detailed_readiness() {
  printf 'Checking all application dependencies...\n'
  compose exec -T app node -e "fetch('http://127.0.0.1:4000/api/internal/health/readiness',{headers:{'x-clean-pay-readiness-secret':process.env.READINESS_INTERNAL_SECRET},signal:AbortSignal.timeout(15000)}).then(async r=>{const text=await r.text();let body;try{body=JSON.parse(text)}catch{throw new Error('readiness returned invalid JSON')}const checks=body&&body.checks&&typeof body.checks==='object'&&!Array.isArray(body.checks)?Object.entries(body.checks):[];const failed=checks.filter(([,check])=>!check||check.status!=='ok').map(([name])=>name);if(!r.ok||body.status!=='ok'||checks.length===0||failed.length)throw new Error('dependencies are not ready: '+(failed.join(', ')||body.status||r.status));console.log('Detailed readiness is healthy')}).catch(error=>{console.error(error.message);process.exit(1)})"
}

install_services() {
  info '[3/3] Установка и запуск'
  sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" check
  prepare_images
  preflight_images
  prepare_runtime_dependencies
  stop_runtime_services
  printf 'Running the verified one-shot migration before any application runtime starts...\n'
  if ! run_verified_migration || ! start_verified_runtimes; then
    printf '\nStartup failed. Recent logs:\n' >&2
    compose logs --tail=200 >&2 || true
    exit 1
  fi
  cleanup_verified_images
  if [ "$deploy_source" = "build" ]; then
    cleanup_build_artifacts
  fi
  verify_detailed_readiness
  verify_external_security_headers
  sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" finalize
  printf '\nClean Pay установлен и успешно прошёл healthcheck.\n'
  printf 'Адрес: %s\n' "$(env_value APP_URL)"
  printf 'Статус: ./deploy.sh ps\nЛоги:   ./deploy.sh logs\n'
}

build_images_only() {
  info '[build] Подготовка образов без изменения runtime или базы данных'
  prepare_compose
  sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" check
  prepare_images
  preflight_images
  cleanup_verified_images
  printf 'Clean Pay application and migration images are prepared and verified.\n'
  printf 'No container was stopped or replaced and no database migration was run.\n'
}

migrate_only() {
  info '[migrate] Проверка образа и применение миграций без запуска runtime'
  prepare_compose
  sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" check
  prepare_images
  preflight_images
  prepare_runtime_dependencies
  stop_runtime_services
  run_verified_migration \
    || die 'Verified migration failed; application runtimes remain stopped.'
  cleanup_verified_images
  if [ "$deploy_source" = "build" ]; then
    cleanup_build_artifacts
  fi
  printf 'Verified database migration completed; application runtimes remain stopped.\n'
}

resolve_rolled_back_migration() {
  [ "$#" -eq 2 ] \
    || die 'Usage: ./deploy.sh resolve-rolled-back MIGRATION_NAME CONFIRMATION'
  migration_name=$1
  confirmation=$2
  migration_prefix=${migration_name%%_*}
  migration_suffix=${migration_name#*_}
  [ "$migration_prefix" != "$migration_name" ] \
    && [ "${#migration_prefix}" -eq 14 ] \
    && [ -n "$migration_suffix" ] \
    || die 'Migration name must use the checked-in 14-digit_timestamp_description format.'
  case "$migration_prefix" in
    *[!0-9]*) die 'Migration timestamp must contain only digits.' ;;
  esac
  case "$migration_suffix" in
    *[!a-z0-9_-]*) die 'Migration description contains unsupported characters.' ;;
  esac
  [ -f "$ROOT_DIR/prisma/migrations/$migration_name/migration.sql" ] \
    || die 'The named migration is not present in this reviewed checkout.'
  case "$migration_name:$confirmation" in
    20260718141000_drop_redundant_indexes:--confirm-zero-step-indexes-intact)
      info '[resolve-rolled-back] Проверка zero-step попытки и неизменной топологии индексов'
      ;;
    20260825010000_add_durable_telegram_callback:--confirm-atomic-zero-step-rollback|\
    20260825210000_add_payment_sensitive_retention:--confirm-atomic-zero-step-rollback|\
    20260825220000_add_payment_retention_hold_lifecycle:--confirm-atomic-zero-step-rollback|\
    20260825230000_guard_retention_mutations:--confirm-atomic-zero-step-rollback)
      info '[resolve-rolled-back] Проверка atomic zero-step попытки и точного schema pre-state'
      ;;
    *)
      die 'No matching fail-closed rollback invariant/confirmation is implemented for the named migration.'
      ;;
  esac
  prepare_compose
  sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" check
  prepare_images
  preflight_images
  prepare_runtime_dependencies
  stop_runtime_services
  compose up -d --no-build --pull never --wait --wait-timeout 120 postgres \
    || die 'PostgreSQL did not become healthy; application runtimes remain stopped.'
  fence_database_roles \
    || die 'Database role fence failed; migration was not resolved.'
  if ! recovery_preflight_database_roles "$migration_name"; then
    fence_database_roles \
      || printf '%s\n' 'WARNING: recovery preflight failed and automatic database-role re-fence also failed; keep runtimes stopped.' >&2
    die 'Exact recovery predecessor preflight failed; migration was not resolved.'
  fi
  recovery_status=0
  compose rm -f -s migration || recovery_status=$?
  if [ "$recovery_status" -eq 0 ]; then
    compose run --rm --no-deps --pull never migration \
      node deploy/prod/migration-rollback-verifier.mjs resolve \
        "$migration_name" >/dev/null \
      || recovery_status=$?
  fi
  if ! fence_database_roles; then
    [ "$recovery_status" -ne 0 ] \
      || die 'Migration was resolved, but the migration credential could not be re-fenced; keep runtimes stopped.'
    printf '%s\n' 'WARNING: rollback verification failed and automatic database-role re-fence also failed; keep runtimes stopped.' >&2
  fi
  [ "$recovery_status" -eq 0 ] \
    || die 'Atomic migration recovery verification failed; migration was not resolved.'
  cleanup_verified_images
  if [ "$deploy_source" = "build" ]; then
    cleanup_build_artifacts
  fi
  printf 'Verified failed migration was marked rolled back; runtimes remain stopped. Run ./deploy.sh migrate next.\n'
}

up() {
  prepare_compose
  install_services
}

setup() {
  is_interactive || die 'The setup wizard requires an interactive terminal.'
  printf '\nClean Pay — простой мастер установки\n'
  printf 'Три этапа: конфигурация .env → подготовка Compose → установка.\n'
  configure
  prepare_compose
  printf '\nПроверьте настройки перед запуском:\n'
  printf '  Адрес:  %s\n' "$(env_value APP_URL)"
  printf '  Сеть:   %s\n' "$(env_value CLEAN_PAY_EDGE_NETWORK remnawave-network)"
  printf '  Проект: %s\n' "$(env_value COMPOSE_PROJECT_NAME clean-pay-prod)"
  confirm 'Подготовить образы и запустить Clean Pay сейчас?' yes || {
    printf 'Настройки сохранены. Для продолжения выполните: ./deploy.sh install\n'
    return
  }
  install_services
  if confirm 'Показать логи приложения?' no; then
    compose logs --tail=100 -f app
  fi
}

usage() {
  cat <<'EOF'
Usage: ./deploy.sh <command>

  setup     интерактивно пройти все три этапа первой установки
  configure интерактивно создать или обновить deploy/prod/.env
  init      создать deploy/prod/.env и сгенерировать внутренние секреты
  compose   проверить .env, Compose-файл и подготовить Docker-сеть
  build     подготовить и проверить образы без остановки runtime и миграции БД
  migrate   проверить migration image и применить миграции, оставив runtime остановленным
  resolve-rolled-back MIGRATION CONFIRMATION
            historical: --confirm-zero-step-indexes-intact; atomic: --confirm-atomic-zero-step-rollback
  install   подготовить образы, запустить и полностью проверить Clean Pay
  up        совместимый псевдоним команды install
  logs      follow logs
  ps        show container status
  restart   restart application containers
  down      stop containers without deleting data
EOF
}

if [ "$#" -eq 0 ] && is_interactive; then
  command=setup
else
  command=${1:-help}
fi
case "$command" in
  setup|configure|config|init|compose|check|build|migrate|resolve-rolled-back|install|up|restart|down)
    acquire_production_operation_lock "$command"
    ;;
esac
case "$command" in
  setup) setup ;;
  configure|config) configure ;;
  init) init ;;
  compose|check) prepare_compose ;;
  build) build_images_only ;;
  migrate) migrate_only ;;
  resolve-rolled-back)
    shift
    resolve_rolled_back_migration "$@"
    ;;
  install) up ;;
  up) up ;;
  logs)
    require_env
    need_docker
    compose logs --tail=100 -f
    ;;
  ps)
    require_env
    need_docker
    compose ps
    ;;
  restart)
    prepare_compose
    restart_runtime_services
    ;;
  down)
    require_env
    need_docker
    materialize_role_env_files
    compose down
    ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
