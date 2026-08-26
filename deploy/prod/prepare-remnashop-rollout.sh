#!/usr/bin/env sh
set -eu

ENV_FILE=${1:-}
PHASE=${2:-finalize}

fail() {
  printf '%s\n' "Remnashop rollout preparation failed: $*" >&2
  exit 1
}

info() {
  printf '%s\n' "Remnashop rollout: $*"
}

[ -n "$ENV_FILE" ] || fail "an environment file path is required"
[ -f "$ENV_FILE" ] || fail "environment file not found: $ENV_FILE"

case "$PHASE" in
  check|finalize) ;;
  *) fail "phase must be check or finalize" ;;
esac

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

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
remnashop_env_file=$(env_value REMNASHOP_ENV_FILE /opt/remnashop/.env)
remnashop_env_expected_uid=$(env_value REMNASHOP_ENV_EXPECTED_UID 0)
remnashop_env_expected_gid=$(env_value REMNASHOP_ENV_EXPECTED_GID 0)

case "$remnashop_env_expected_uid:$remnashop_env_expected_gid" in
  *[!0-9:]*) fail "REMNASHOP_ENV_EXPECTED_UID and REMNASHOP_ENV_EXPECTED_GID must be numeric ids" ;;
esac
case "$remnashop_env_file" in
  /*) ;;
  *) fail "REMNASHOP_ENV_FILE must be an absolute path" ;;
esac

# This metadata-only guard deliberately runs before the first Docker access.
# It rejects a missing, symlinked, non-regular, broadly readable or wrongly
# owned host credential source without ever printing or reading its contents.
command -v node >/dev/null 2>&1 || fail "node is required for credential metadata preflight"
node "$script_dir/remnashop-env-preflight.mjs" \
  "$remnashop_env_file" \
  "$remnashop_env_expected_uid" \
  "$remnashop_env_expected_gid" \
  || fail "Remnashop environment-file metadata is unsafe"

command -v docker >/dev/null 2>&1 || fail "docker is not installed or is not available in PATH"

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

probe_notification_preferences_contract() {
  service_key=$(env_value REMNASHOP_AUTH_SERVICE_KEY)
  [ -n "$service_key" ] \
    || fail "REMNASHOP_AUTH_SERVICE_KEY is required for the Remnashop API contract probe"

  # First validate the shared service credential against an unauthenticated
  # endpoint: a correct key plus an empty body yields 422, a wrong key yields
  # 401. Then use an unsupported POST on the exact new path: FastAPI yields 405
  # only when that path exists, while an image without the reminder contract yields 404. The key
  # travels over stdin and is never embedded in command-line arguments or logs.
  contract_statuses=$(
    printf '%s' "$service_key" \
      | docker exec -i "$api_container" python -c '
import http.client
import os
import sys

key = sys.stdin.read()
port = int(os.environ.get("APP_PORT", "5000"))
statuses = []
for path in (
    "/api/v1/public/auth/identify",
    "/api/v1/public/auth/notification-preferences",
):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    connection.request(
        "POST",
        path,
        body="{}",
        headers={
            "content-type": "application/json",
            "x-remnashop-auth-service-key": key,
        },
    )
    response = connection.getresponse()
    response.read()
    statuses.append(response.status)
    connection.close()
print(*statuses)
' 2>/dev/null
  ) || fail "could not probe the Remnashop notification-preferences API"

  [ "$contract_statuses" = "422 405" ] \
    || fail "Remnashop auth/API contract returned $contract_statuses; expected 422 405"
}

api_container=$(env_value REMNASHOP_API_CONTAINER remnashop)
worker_container=$(env_value REMNASHOP_WORKER_CONTAINER remnashop-taskiq-worker)
scheduler_container=$(env_value REMNASHOP_SCHEDULER_CONTAINER remnashop-taskiq-scheduler)
postgres_container=$(env_value REMNASHOP_POSTGRES_CONTAINER remnashop-db)
minimum_revision=$(env_value REMNASHOP_MINIMUM_ALEMBIC_REVISION 0058)

api_image=$(container_image "$api_container")
worker_image=$(container_image "$worker_container")
scheduler_image=$(container_image "$scheduler_container")
container_image "$postgres_container" >/dev/null

if [ "$api_image" != "$worker_image" ] || [ "$api_image" != "$scheduler_image" ]; then
  fail "API, worker and scheduler must use the same image (api=$api_image worker=$worker_image scheduler=$scheduler_image)"
fi

schema_ready=$(database_query -c "
  SELECT
    to_regclass('public.alembic_version') IS NOT NULL
    AND to_regclass('public.payment_runtime_control') IS NOT NULL
    AND to_regclass('public.payment_operations') IS NOT NULL
    AND to_regclass('public.subscription_email_reminders') IS NOT NULL
    AND (
      SELECT count(DISTINCT column_name)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name IN (
          'subscription_expiration_email_enabled',
          'subscription_expiration_email_enabled_at'
        )
    ) = 2;
")
[ "$schema_ready" = "t" ] || fail "required payment and subscription-email rollout schema is missing"

current_revision=$(database_query -c "SELECT version_num FROM alembic_version;")
case "$current_revision:$minimum_revision" in
  *[!0-9:]*|:*|*:) fail "Alembic revisions must be numeric (current=$current_revision minimum=$minimum_revision)" ;;
esac
[ "$current_revision" -ge "$minimum_revision" ] \
  || fail "Alembic revision $current_revision is older than required revision $minimum_revision"

probe_notification_preferences_contract

if [ "$PHASE" = "check" ]; then
  info "compatibility preflight passed (Alembic revision $current_revision, image $api_image)"
  exit 0
fi

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
