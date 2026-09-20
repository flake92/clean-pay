#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
NODE_TOOLING_IMAGE="node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d"

fail() {
  printf '%s\n' "Production Node tooling failed: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: deploy/prod/node-tooling.sh <command> [arguments]

  credential-env-set ENV_FILE NAME
  zero-downtime-env <verify|restore-images> CURRENT_ENV ROLLBACK_ENV
  caddyfile <replace|restore> AUTHORITATIVE_FILE SOURCE_FILE EXPECTED_SHA [NEW_SHA]

Uses host Node.js when available. Otherwise it runs the reviewed helper from a
pinned Node image with only the exact required parent directories mounted.
EOF
}

validate_absolute_path() {
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

validate_bind_directory() {
  bind_directory=$1
  bind_label=$2
  validate_absolute_path "$bind_directory" "$bind_label"
  [ -d "$bind_directory" ] || fail "$bind_label does not exist: $bind_directory"
  [ ! -L "$bind_directory" ] || fail "$bind_label must not be a symbolic link"
  case "$bind_directory" in
    *,*) fail "$bind_label cannot contain a comma without host Node.js" ;;
  esac
}

validate_bind_file() {
  bind_file=$1
  bind_label=$2
  validate_absolute_path "$bind_file" "$bind_label"
  [ -f "$bind_file" ] || fail "$bind_label does not exist: $bind_file"
  [ ! -L "$bind_file" ] || fail "$bind_label must not be a symbolic link"
  case "$bind_file" in
    *,*) fail "$bind_label cannot contain a comma without host Node.js" ;;
  esac
}

ensure_node_tooling_image() {
  command -v docker >/dev/null 2>&1 \
    || fail "docker is required when host Node.js is unavailable"
  if ! docker image inspect "$NODE_TOOLING_IMAGE" >/dev/null 2>&1; then
    docker pull "$NODE_TOOLING_IMAGE" \
      || fail "the pinned Node tooling image could not be fetched"
  fi
}

run_container() {
  validate_bind_directory "$ROOT_DIR" "release root"
  ensure_node_tooling_image
  docker run --rm --pull never --read-only --network none \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 32 \
    --memory 128m \
    --cpus 0.25 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=8m,mode=1777 \
    --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$ROOT_DIR,target=/workspace,readonly" \
    --workdir /workspace \
    --entrypoint node \
    "$@"
}

run_credential_env_set() {
  [ "$#" -eq 2 ] || fail "credential-env-set requires ENV_FILE and NAME"
  environment_path=$1
  environment_name=$2
  validate_absolute_path "$environment_path" "environment file"
  if command -v node >/dev/null 2>&1; then
    node "$ROOT_DIR/deploy/prod/credential-file-guard.mjs" \
      env-set "$environment_path" "$environment_name"
    return
  fi

  environment_parent=$(dirname -- "$environment_path")
  validate_bind_directory "$environment_parent" "environment directory"
  run_container --interactive \
    --mount "type=bind,source=$environment_parent,target=$environment_parent" \
    "$NODE_TOOLING_IMAGE" \
    deploy/prod/credential-file-guard.mjs \
      env-set "$environment_path" "$environment_name"
}

run_zero_downtime_env() {
  [ "$#" -eq 3 ] \
    || fail "zero-downtime-env requires MODE, CURRENT_ENV, and ROLLBACK_ENV"
  pair_mode=$1
  current_path=$2
  rollback_path=$3
  case "$pair_mode" in
    verify|restore-images) ;;
    *) fail "zero-downtime-env mode must be verify or restore-images" ;;
  esac
  validate_absolute_path "$current_path" "current environment file"
  validate_absolute_path "$rollback_path" "rollback environment file"
  if command -v node >/dev/null 2>&1; then
    node "$ROOT_DIR/deploy/prod/zero-downtime-env.mjs" \
      "$pair_mode" "$current_path" "$rollback_path"
    return
  fi

  current_parent=$(dirname -- "$current_path")
  rollback_parent=$(dirname -- "$rollback_path")
  validate_bind_directory "$current_parent" "current environment directory"
  validate_bind_directory "$rollback_parent" "rollback environment directory"
  if [ "$current_parent" = "$rollback_parent" ]; then
    if [ "$pair_mode" = verify ]; then
      run_container \
        --mount "type=bind,source=$current_parent,target=$current_parent,readonly" \
        "$NODE_TOOLING_IMAGE" \
        deploy/prod/zero-downtime-env.mjs \
          "$pair_mode" "$current_path" "$rollback_path"
    else
      run_container \
        --mount "type=bind,source=$current_parent,target=$current_parent" \
        "$NODE_TOOLING_IMAGE" \
        deploy/prod/zero-downtime-env.mjs \
          "$pair_mode" "$current_path" "$rollback_path"
    fi
    return
  fi

  if [ "$pair_mode" = verify ]; then
    run_container \
      --mount "type=bind,source=$current_parent,target=$current_parent,readonly" \
      --mount "type=bind,source=$rollback_parent,target=$rollback_parent,readonly" \
      "$NODE_TOOLING_IMAGE" \
      deploy/prod/zero-downtime-env.mjs \
        "$pair_mode" "$current_path" "$rollback_path"
  else
    run_container \
      --mount "type=bind,source=$current_parent,target=$current_parent" \
      --mount "type=bind,source=$rollback_parent,target=$rollback_parent,readonly" \
      "$NODE_TOOLING_IMAGE" \
      deploy/prod/zero-downtime-env.mjs \
        "$pair_mode" "$current_path" "$rollback_path"
  fi
}

run_caddyfile() {
  case "${1:-}" in
    replace) [ "$#" -eq 5 ] || fail "caddyfile replace requires four arguments" ;;
    restore) [ "$#" -eq 4 ] || fail "caddyfile restore requires three arguments" ;;
    *) fail "caddyfile mode must be replace or restore" ;;
  esac
  caddy_mode=$1
  authoritative_path=$2
  source_path=$3
  shift 3
  validate_absolute_path "$authoritative_path" "authoritative Caddyfile"
  validate_absolute_path "$source_path" "Caddyfile source"
  if command -v node >/dev/null 2>&1; then
    node "$ROOT_DIR/deploy/prod/caddyfile-same-inode.mjs" \
      "$caddy_mode" "$authoritative_path" "$source_path" "$@"
    return
  fi

  validate_bind_file "$authoritative_path" "authoritative Caddyfile"
  validate_bind_file "$source_path" "Caddyfile source"
  run_container \
    --mount "type=bind,source=$authoritative_path,target=/run/clean-pay-caddy-authoritative" \
    --mount "type=bind,source=$source_path,target=/run/clean-pay-caddy-source,readonly" \
    "$NODE_TOOLING_IMAGE" \
    deploy/prod/caddyfile-same-inode.mjs \
      "$caddy_mode" \
      /run/clean-pay-caddy-authoritative \
      /run/clean-pay-caddy-source \
      "$@"
}

command_name=${1:-help}
case "$command_name" in
  help|-h|--help)
    usage
    ;;
  credential-env-set)
    shift
    run_credential_env_set "$@"
    ;;
  zero-downtime-env)
    shift
    run_zero_downtime_env "$@"
    ;;
  caddyfile)
    shift
    run_caddyfile "$@"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
