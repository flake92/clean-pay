#!/usr/bin/env sh
set -eu

ENV_FILE=${1:-}

fail() {
  printf '%s\n' "Remnashop rollout preparation failed: $*" >&2
  exit 1
}

info() {
  printf '%s\n' "Remnashop rollout: $*"
}

[ -n "$ENV_FILE" ] || fail "an environment file path is required"
[ -f "$ENV_FILE" ] || fail "environment file not found: $ENV_FILE"
command -v docker >/dev/null 2>&1 || fail "docker is not installed or is not available in PATH"

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

container_image() {
  container="$1"
  running=$(docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null) \
    || fail "required container '$container' was not found"
  [ "$running" = "true" ] || fail "required container '$container' is not running"
  docker inspect "$container" --format '{{.Image}}'
}

database_query() {
  docker exec "$postgres_container" sh -lc \
    'exec psql -v ON_ERROR_STOP=1 -Atq -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' \
    sh "$@"
}

api_container=$(env_value REMNASHOP_API_CONTAINER remnashop)
worker_container=$(env_value REMNASHOP_WORKER_CONTAINER remnashop-taskiq-worker)
scheduler_container=$(env_value REMNASHOP_SCHEDULER_CONTAINER remnashop-taskiq-scheduler)
postgres_container=$(env_value REMNASHOP_POSTGRES_CONTAINER remnashop-db)
minimum_revision=$(env_value REMNASHOP_MINIMUM_ALEMBIC_REVISION 0055)

api_image=$(container_image "$api_container")
worker_image=$(container_image "$worker_container")
scheduler_image=$(container_image "$scheduler_container")
container_image "$postgres_container" >/dev/null

if [ "$api_image" != "$worker_image" ] || [ "$api_image" != "$scheduler_image" ]; then
  fail "API, worker and scheduler must use the same image (api=$api_image worker=$worker_image scheduler=$scheduler_image)"
fi

schema_ready=$(database_query -c "SELECT to_regclass('public.alembic_version') IS NOT NULL AND to_regclass('public.payment_runtime_control') IS NOT NULL AND to_regclass('public.payment_operations') IS NOT NULL;")
[ "$schema_ready" = "t" ] || fail "required payment rollout schema is missing"

current_revision=$(database_query -c "SELECT version_num FROM alembic_version;")
case "$current_revision:$minimum_revision" in
  *[!0-9:]*|:*|*:) fail "Alembic revisions must be numeric (current=$current_revision minimum=$minimum_revision)" ;;
esac
[ "$current_revision" -ge "$minimum_revision" ] \
  || fail "Alembic revision $current_revision is older than required revision $minimum_revision"

docker exec -i "$postgres_container" sh -lc \
  'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN;

SELECT pg_advisory_xact_lock(1129337421);

DO $$
DECLARE
  rollout_gate_active boolean;
  payment_operation_count bigint;
  active_fulfillment_count bigint;
BEGIN
  SELECT legacy_rollout_gate_active
  INTO STRICT rollout_gate_active
  FROM payment_runtime_control
  WHERE id = 1
  FOR UPDATE;

  IF rollout_gate_active THEN
    SELECT count(*)
    INTO payment_operation_count
    FROM payment_operations;

    IF payment_operation_count <> 0 THEN
      RAISE EXCEPTION
        'Refusing to disable payment rollout gate with % payment operations',
        payment_operation_count;
    END IF;

    SELECT count(*)
    INTO active_fulfillment_count
    FROM transactions
    WHERE fulfillment_status = 'PROCESSING'
       OR fulfillment_token_hash IS NOT NULL;

    IF active_fulfillment_count <> 0 THEN
      RAISE EXCEPTION
        'Refusing to disable payment rollout gate with % active fulfillments',
        active_fulfillment_count;
    END IF;

    UPDATE payment_runtime_control
    SET legacy_rollout_gate_active = false
    WHERE id = 1;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payment_runtime_control
    WHERE id = 1
      AND legacy_rollout_gate_active
  ) THEN
    RAISE EXCEPTION 'Payment rollout gate remained active';
  END IF;
END
$$;

COMMIT;
SQL

info "payment rollout gate is disabled (Alembic revision $current_revision, image $api_image)"
