#!/usr/bin/env sh
set -eu

fail() {
  printf '%s\n' "Docker Compose capability preflight failed: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 \
  || fail "Docker is not installed or is not available in PATH"
docker compose version >/dev/null 2>&1 \
  || fail "the Docker Compose v2 plugin is not installed"

require_option() {
  subcommand=$1
  option=$2
  if ! docker compose "$subcommand" --help 2>&1 | grep -F -q -- "$option"; then
    fail "docker compose $subcommand does not support $option; update the Compose v2 plugin before deployment"
  fi
}

# Check capabilities instead of guessing from a vendor-specific version string.
# Every option below is used by a production mutation before or after runtime
# stop, so an old client must be rejected while the current service is intact.
require_option up --wait-timeout
require_option up --wait
require_option up --pull
require_option up --no-build
require_option up --no-deps
require_option run --pull
require_option run --rm
require_option run --no-deps
require_option pull --policy
require_option ps --all
require_option ps --quiet
require_option rm --force
require_option rm --stop
require_option config --quiet

printf '%s\n' "Docker Compose supports the required production deployment options."
