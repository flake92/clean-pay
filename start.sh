#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
MODE="${CLEAN_PAY_MODE:-standalone}"
COMMAND="${1:-start}"

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

required_env() {
  value=$(env_value "$1")
  [ -n "$value" ] || fail "$1 is required in .env"
}

bool_env() {
  value=$(env_value "$1" "$2")

  case "$value" in
    true|false) ;;
    *) fail "$1 must be true or false" ;;
  esac
}

http_url_env() {
  value=$(env_value "$1")

  case "$value" in
    http://*|https://*) ;;
    *) fail "$1 must be a valid http:// or https:// URL" ;;
  esac
}

optional_http_url_env() {
  value=$(env_value "$1")
  [ -z "$value" ] || http_url_env "$1"
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
}

validate_env() {
  require_env_file
  ensure_generated_secrets

  required_env DATABASE_URL
  required_env REDIS_URL
  required_env APP_URL
  required_env NEXT_PUBLIC_APP_URL
  required_env REMNASHOP_API_BASE_URL
  required_env REMNAWAVE_API_BASE_URL
  required_env REMNAWAVE_TOKEN
  required_env WEB_JWT_SECRET
  required_env WEB_REFRESH_SECRET
  required_env TELEGRAM_OIDC_CLIENT_ID
  required_env TELEGRAM_OIDC_CLIENT_SECRET

  http_url_env APP_URL
  http_url_env NEXT_PUBLIC_APP_URL
  http_url_env REMNASHOP_API_BASE_URL
  http_url_env REMNAWAVE_API_BASE_URL
  optional_http_url_env TURNSTILE_VERIFY_URL
  optional_http_url_env SUPPORT_FAQ_URL
  optional_http_url_env CLEAN_PAY_READINESS_MAILPIT_URL
  optional_http_url_env CLEAN_PAY_READINESS_REMNAWAVE_URL

  case "$(env_value DATABASE_URL)" in
    postgresql://*|postgres://*) ;;
    *) fail "DATABASE_URL must be a valid PostgreSQL URL" ;;
  esac

  case "$(env_value REDIS_URL)" in
    redis://*|rediss://*) ;;
    *) fail "REDIS_URL must be a valid Redis URL" ;;
  esac

  bool_env COOKIE_SECURE true
  bool_env TURNSTILE_ENABLED false
  bool_env SUPPORT_ENABLED false

  cookie_samesite=$(env_value COOKIE_SAMESITE lax)
  case "$cookie_samesite" in
    lax|strict|none) ;;
    *) fail "COOKIE_SAMESITE must be lax, strict, or none" ;;
  esac

  if [ "$cookie_samesite" = "none" ] && [ "$(env_value COOKIE_SECURE true)" != "true" ]; then
    fail "COOKIE_SECURE must be true when COOKIE_SAMESITE=none"
  fi

  brand_name=$(env_value NEXT_PUBLIC_BRAND_NAME)
  if [ ${#brand_name} -gt 80 ]; then
    fail "NEXT_PUBLIC_BRAND_NAME must be 80 characters or less"
  fi

  logo_path=$(env_value NEXT_PUBLIC_BRAND_LOGO_URL)
  case "$logo_path" in
    ""|/*) ;;
    *) fail "NEXT_PUBLIC_BRAND_LOGO_URL must be a root-relative path like /brand/logo.png" ;;
  esac

  case "$logo_path" in
    //*|*\\*) fail "NEXT_PUBLIC_BRAND_LOGO_URL must not start with // or contain backslashes" ;;
  esac

  if [ "$(env_value TURNSTILE_ENABLED false)" = "true" ]; then
    required_env TURNSTILE_SITE_KEY
    required_env TURNSTILE_SECRET_KEY
  fi

  bot_token=$(env_value TELEGRAM_BOT_TOKEN)
  if [ -n "$bot_token" ]; then
    bot_id=${bot_token%%:*}
    [ "$bot_id" = "$(env_value TELEGRAM_OIDC_CLIENT_ID)" ] \
      || fail "TELEGRAM_OIDC_CLIENT_ID must match the bot id in TELEGRAM_BOT_TOKEN"
  fi

  info "environment file is valid"
}

ensure_network() {
  [ "$MODE" = "remnashop" ] || return 0
  network_name=$(env_value REMNASHOP_DOCKER_NETWORK remnawave-network)

  if docker network inspect "$network_name" >/dev/null 2>&1; then
    info "Docker network $network_name already exists"
    return
  fi

  info "Docker network $network_name not found, creating it"
  docker network create "$network_name" >/dev/null \
    || fail "failed to create Docker network $network_name"
}

compose() {
  if [ "$MODE" = "remnashop" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$ROOT_DIR/docker-compose.remnashop.yml" "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  fi
}

start() {
  require_command docker
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available"
  validate_env
  ensure_network
  info "building and starting containers"
  compose up -d --build
  info "started. Use 'sh start.sh logs' to follow app logs"
}

verify() {
  require_env_file
  port=$(env_value CLEAN_PAY_PORT 4000)
  url="http://127.0.0.1:${port}/api/health"

  if command -v curl >/dev/null 2>&1; then
    curl --fail --show-error --silent "$url"
    printf '\n'
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
    printf '\n'
    return
  fi

  fail "curl or wget is required to verify ${url}"
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
    ;;
  verify|health)
    verify
    ;;
  build)
    require_command docker
    docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available"
    validate_env
    compose build
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
EOF
    exit 1
    ;;
esac
