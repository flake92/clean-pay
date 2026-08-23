#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$ROOT_DIR/deploy/prod/.env"
ENV_EXAMPLE="$ROOT_DIR/deploy/prod/.env.example"
COMPOSE_PATH="$ROOT_DIR/deploy/prod/docker-compose.yml"
REMNASHOP_ROLLOUT_SCRIPT="$ROOT_DIR/deploy/prod/prepare-remnashop-rollout.sh"

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

env_value() {
  name="$1"
  fallback="${2:-}"
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
    CLEAN_PAY_EDGE_NETWORK \
    CLEAN_PAY_IMAGE \
    CLEAN_PAY_PORT \
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

  if [ "$(env_value PAYMENT_RECONCILIATION_ENABLED true)" = "true" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_PATH" --profile reconciliation "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_PATH" "$@"
  fi
)

replace_env() {
  name=$1
  value=$2
  case "$value" in
    *'${'*|*'#'*) die "$name contains a value that is unsafe for an env file." ;;
  esac
  escaped_value=$(printf '%s' "$value" | sed 's/[\\&|]/\\&/g')
  if grep -q "^${name}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${name}=.*|${name}=${escaped_value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$name" "$value" >> "$ENV_FILE"
  fi
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

init() {
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."
  if [ -f "$ENV_FILE" ]; then
    chmod 600 "$ENV_FILE"
    ensure_internal_secrets
    printf 'Configuration already exists: %s\nExisting values were preserved; missing internal secrets were generated.\n' "$ENV_FILE"
    return
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  postgres_password=$(openssl rand -hex 24)
  replace_env POSTGRES_PASSWORD "$postgres_password"
  sed -i "s|change-me-postgres-password|$postgres_password|g" "$ENV_FILE"
  ensure_internal_secrets
  printf '\nCreated %s and generated local secrets.\n' "$ENV_FILE"
  printf 'Run ./deploy.sh setup to continue in the interactive installer.\n'
}

require_env() { [ -f "$ENV_FILE" ] || die "Configuration is missing. Run ./deploy.sh init first."; }

ensure_network() {
  network=$(env_value CLEAN_PAY_EDGE_NETWORK)
  [ -n "$network" ] || network=remnawave-network
  docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network" >/dev/null
}

ensure_redis_host_memory_policy() {
  overcommit_path=/proc/sys/vm/overcommit_memory
  [ -r "$overcommit_path" ] || return 0
  overcommit_value=$(tr -d '[:space:]' < "$overcommit_path")
  [ "$overcommit_value" = 1 ] || die \
    "Redis requires vm.overcommit_memory=1. Apply 'sysctl -w vm.overcommit_memory=1' and persist it in /etc/sysctl.d before deployment."
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
  previous_stty=''
  if command -v stty >/dev/null 2>&1; then
    previous_stty=$(stty -g 2>/dev/null || true)
    stty -echo 2>/dev/null || true
  fi
  IFS= read -r answer || answer=''
  if [ -n "$previous_stty" ]; then
    stty "$previous_stty" 2>/dev/null || true
  fi
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

  chmod 600 "$ENV_FILE"
  ok "конфигурация сохранена в $ENV_FILE"
  printf 'Важно: скопируйте REMNASHOP_AUTH_SERVICE_KEY из этого файла в APP_AUTH_SERVICE_KEY Remnashop.\n'

  if confirm 'Открыть расширенные настройки в текстовом редакторе?' no; then
    editor=${EDITOR:-}
    if [ -z "$editor" ]; then
      if command -v nano >/dev/null 2>&1; then editor=nano; else editor=vi; fi
    fi
    "$editor" "$ENV_FILE"
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
    node "$ROOT_DIR/deploy/prod/validate-env.mjs" --env-file "$ENV_FILE"
    return
  fi

  node_version=$(sed -e 's/\r$//' "$ROOT_DIR/.node-version")
  docker run --rm --read-only --network none \
    --mount "type=bind,source=$ROOT_DIR,target=/workspace,readonly" \
    --workdir /workspace \
    "node:${node_version}-bookworm-slim" \
    node deploy/prod/validate-env.mjs --env-file deploy/prod/.env
}

prepare_compose() {
  init
  need_docker
  assert_required_env
  info '[2/3] Подготовка Docker Compose'
  [ -f "$COMPOSE_PATH" ] || die "Compose file is missing: $COMPOSE_PATH"
  validate_env_file
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
  min_mb=${CLEAN_PAY_MIN_FREE_DISK_MB:-$(env_value CLEAN_PAY_MIN_FREE_DISK_MB 8192)}
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
  script_policy=$(printf '%s' "$csp" | sed -n 's/.*script-src[[:space:]]\([^;]*\).*/\1/p')
  printf '%s' "$script_policy" | grep -Eq "'nonce-[^']+'" \
    || die "External HTTPS response is missing a nonce-based script CSP."
  if printf '%s' "$script_policy" | grep -Fiq "'unsafe-inline'"; then
    die "External script CSP still permits unsafe-inline."
  fi

  printf 'External HTTPS security headers are valid.\n'
}

verify_detailed_readiness() {
  printf 'Checking all application dependencies...\n'
  compose exec -T app node -e "fetch('http://127.0.0.1:4000/api/internal/health/readiness',{headers:{'x-clean-pay-readiness-secret':process.env.READINESS_INTERNAL_SECRET},signal:AbortSignal.timeout(15000)}).then(async r=>{const text=await r.text();let body;try{body=JSON.parse(text)}catch{throw new Error('readiness returned invalid JSON')}const failed=Object.entries(body.checks||{}).filter(([,check])=>check.status!=='ok').map(([name])=>name);if(!r.ok||body.status!=='ok'||failed.length)throw new Error('dependencies are not ready: '+(failed.join(', ')||body.status||r.status));console.log('Detailed readiness is healthy')}).catch(error=>{console.error(error.message);process.exit(1)})"
}

install_services() {
  info '[3/3] Установка и запуск'
  ensure_build_disk_space
  printf 'Building and starting Clean Pay. The first build can take several minutes...\n'
  if ! compose up -d --build --wait --wait-timeout 180; then
    printf '\nStartup failed. Recent logs:\n' >&2
    compose logs --tail=200 >&2 || true
    exit 1
  fi
  cleanup_build_artifacts
  verify_detailed_readiness
  verify_external_security_headers
  sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE"
  printf '\nClean Pay установлен и успешно прошёл healthcheck.\n'
  printf 'Адрес: %s\n' "$(env_value APP_URL)"
  printf 'Статус: ./deploy.sh ps\nЛоги:   ./deploy.sh logs\n'
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
  confirm 'Собрать и запустить Clean Pay сейчас?' yes || {
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
  install   собрать, запустить и полностью проверить Clean Pay
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
  setup) setup ;;
  configure|config) configure ;;
  init) init ;;
  compose|check) prepare_compose ;;
  install) up ;;
  up) up ;;
  logs) require_env; need_docker; compose logs --tail=100 -f ;;
  ps) require_env; need_docker; compose ps ;;
  restart) require_env; need_docker; compose restart ;;
  down) require_env; need_docker; compose down ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
