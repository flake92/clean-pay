#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$ROOT_DIR/deploy/prod/.env"
ENV_EXAMPLE="$ROOT_DIR/deploy/prod/.env.example"
COMPOSE_FILE="$ROOT_DIR/deploy/prod/docker-compose.yml"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

need_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install it with: curl -fsSL https://get.docker.com | sh"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is not installed."
}

env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

compose() {
  profiles=""
  if [ "$(env_value PAYMENT_RECONCILIATION_ENABLED)" = "true" ]; then profiles="--profile reconciliation"; fi
  # shellcheck disable=SC2086
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" $profiles "$@"
}

replace_env() {
  name=$1
  value=$2
  sed -i "s|^${name}=.*|${name}=${value}|" "$ENV_FILE"
}

init() {
  if [ -f "$ENV_FILE" ]; then
    printf 'Configuration already exists: %s\nIt was left unchanged.\n' "$ENV_FILE"
    return
  fi
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  postgres_password=$(openssl rand -hex 24)
  replace_env POSTGRES_PASSWORD "$postgres_password"
  sed -i "s|change-me-postgres-password|$postgres_password|g" "$ENV_FILE"
  replace_env WEB_JWT_SECRET "$(openssl rand -hex 32)"
  replace_env WEB_REFRESH_SECRET "$(openssl rand -hex 32)"
  replace_env AUDIT_IP_HASH_SECRET "$(openssl rand -hex 32)"
  printf '\nCreated %s and generated local secrets.\n' "$ENV_FILE"
  printf 'Now run: nano deploy/prod/.env\nThen run: ./deploy.sh up\n'
}

require_env() { [ -f "$ENV_FILE" ] || die "Configuration is missing. Run ./deploy.sh init first."; }

ensure_network() {
  network=$(env_value CLEAN_PAY_EDGE_NETWORK)
  [ -n "$network" ] || network=remnawave-network
  docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network" >/dev/null
}

up() {
  require_env
  ensure_network
  printf 'Building and starting Clean Pay. The first build can take several minutes...\n'
  if ! compose up -d --build --wait --wait-timeout 180; then
    printf '\nStartup failed. Recent logs:\n' >&2
    compose logs --tail=200 >&2 || true
    exit 1
  fi
  printf '\nClean Pay is healthy. Following logs (Ctrl+C only closes the log view):\n\n'
  compose logs --tail=100 -f
}

usage() {
  cat <<'EOF'
Usage: ./deploy.sh <command>

  init      create deploy/prod/.env and generate local secrets
  up        build, start, wait until healthy, then follow logs
  logs      follow logs
  ps        show container status
  restart   restart application containers
  down      stop containers without deleting data
EOF
}

command=${1:-help}
need_docker
case "$command" in
  init) init ;;
  up) up ;;
  logs) require_env; compose logs --tail=100 -f ;;
  ps) require_env; compose ps ;;
  restart) require_env; compose restart ;;
  down) require_env; compose down ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
