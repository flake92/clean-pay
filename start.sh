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
  require_command node
  node "$ROOT_DIR/deploy/prod/validate-env.mjs" --env-file "$ENV_FILE"
  info "production environment file is valid"
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

compose() (
  unset \
    CLEAN_PAY_BIND \
    CLEAN_PAY_IMAGE \
    CLEAN_PAY_PORT \
    COMPOSE_ENV_FILES \
    COMPOSE_PROFILES \
    COMPOSE_PROJECT_NAME \
    NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_BRAND_LOGO_URL \
    NEXT_PUBLIC_BRAND_NAME \
    POSTGRES_DB \
    POSTGRES_PASSWORD \
    POSTGRES_USER \
    REMNASHOP_DOCKER_NETWORK \
    TURNSTILE_ENABLED \
    TURNSTILE_SITE_KEY

  if [ "$MODE" = "remnashop" ]; then
    if [ "$(env_value PAYMENT_RECONCILIATION_ENABLED false)" = "true" ]; then
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$ROOT_DIR/docker-compose.remnashop.yml" --profile reconciliation "$@"
    else
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$ROOT_DIR/docker-compose.remnashop.yml" "$@"
    fi
  else
    if [ "$(env_value PAYMENT_RECONCILIATION_ENABLED false)" = "true" ]; then
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile reconciliation "$@"
    else
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    fi
  fi
)

assert_reconciliation_worker() {
  [ "$(env_value PAYMENT_RECONCILIATION_ENABLED false)" = "true" ] || return 0

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

start() {
  require_command docker
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available"
  validate_env
  ensure_network
  info "building and starting containers"
  compose up -d --build
  assert_reconciliation_worker
  info "started. Use 'sh start.sh logs' to follow app logs"
}

verify() {
  require_env_file
  port=$(env_value CLEAN_PAY_PORT 4000)
  url="http://127.0.0.1:${port}/api/health"

  if command -v curl >/dev/null 2>&1; then
    curl --fail --show-error --silent "$url"
    printf '\n'
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
    printf '\n'
  else
    fail "curl or wget is required to verify ${url}"
  fi

  assert_reconciliation_worker
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
