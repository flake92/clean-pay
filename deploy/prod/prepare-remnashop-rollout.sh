#!/usr/bin/env sh
set -eu

ENV_FILE=${1:-}
PHASE=${2:-finalize}

# fail "что случилось" ["что делать"]
fail() {
  printf '%s\n' "Проверка Remnashop не пройдена: $1" >&2
  if [ -n "${2:-}" ]; then
    printf '%s\n' "Что делать: $2" >&2
  fi
  exit 1
}

# The upstream snoups releases (tags v0.x) lack the Clean Pay integration.
incompatible() {
  fail "$*." "./menu.sh → «Обновить Remnashop» → ветка main, затем повторите обновление Clean Pay. Нужна именно ветка main репозитория flake92/remnashop: в тегах v0.x нет интеграции с Clean Pay."
}

info() {
  printf '%s\n' "Remnashop: $*"
}

[ -n "$ENV_FILE" ] || fail "не указан путь к файлу настроек" "запускайте проверку через ./menu.sh или ./deploy.sh."
[ -f "$ENV_FILE" ] || fail "файл настроек не найден: $ENV_FILE" "создайте его: ./deploy.sh init."

case "$PHASE" in
  check|finalize) ;;
  *) fail "неизвестный этап проверки, нужен check или finalize" ;;
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

repository_minimum_revision=0061
minimum_revision=$(env_value REMNASHOP_MINIMUM_ALEMBIC_REVISION "$repository_minimum_revision")
case "$minimum_revision:$repository_minimum_revision" in
  *[!0-9:]*|:*|*:) fail "версии схемы должны быть числами (в настройках $minimum_revision, в коде $repository_minimum_revision)" "исправьте REMNASHOP_MINIMUM_ALEMBIC_REVISION в $ENV_FILE." ;;
esac
# Existing installations keep an older floor in .env so that a rollback to the
# previous Clean Pay still validates; this code requires at least the repository floor.
if [ "$minimum_revision" -lt "$repository_minimum_revision" ]; then
  minimum_revision=$repository_minimum_revision
fi

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
remnashop_env_file=$(env_value REMNASHOP_ENV_FILE /opt/remnashop/.env)
remnashop_env_expected_uid=$(env_value REMNASHOP_ENV_EXPECTED_UID 0)
remnashop_env_expected_gid=$(env_value REMNASHOP_ENV_EXPECTED_GID 0)

case "$remnashop_env_expected_uid:$remnashop_env_expected_gid" in
  *[!0-9:]*) fail "REMNASHOP_ENV_EXPECTED_UID и REMNASHOP_ENV_EXPECTED_GID должны быть числами" "исправьте их в $ENV_FILE." ;;
esac
case "$remnashop_env_file" in
  /*) ;;
  *) fail "REMNASHOP_ENV_FILE должен быть абсолютным путём" "исправьте его в $ENV_FILE, например /opt/remnashop/.env." ;;
esac

# This metadata-only guard deliberately runs before the first Docker access.
# It rejects a missing, symlinked, non-regular, broadly readable or wrongly
# owned host credential source without ever printing or reading its contents.
# Production hosts do not otherwise need a host Node.js installation, so use
# the equivalent descriptor-bound Python guard when Node.js is unavailable.
run_remnashop_env_preflight() {
  if command -v node >/dev/null 2>&1; then
    node "$script_dir/remnashop-env-preflight.mjs" \
      "$remnashop_env_file" \
      "$remnashop_env_expected_uid" \
      "$remnashop_env_expected_gid"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 "$script_dir/remnashop-env-preflight.py" \
      "$remnashop_env_file" \
      "$remnashop_env_expected_uid" \
      "$remnashop_env_expected_gid"
    return
  fi
  fail "для проверки прав на файл настроек нужен node или python3" "установите python3: apt install python3."
}

run_remnashop_env_preflight \
  || fail "небезопасные права на файл настроек Remnashop: $remnashop_env_file" "выполните ./menu.sh remnashop-link или chmod 750 $(dirname -- "$remnashop_env_file") && chmod 600 $remnashop_env_file (владелец uid $remnashop_env_expected_uid, gid $remnashop_env_expected_gid)."

command -v docker >/dev/null 2>&1 || fail "Docker не установлен или недоступен" "установите его: curl -fsSL https://get.docker.com | sh."

container_image() {
  container="$1"
  running=$(docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null) \
    || fail "контейнер $container не найден" "установите Remnashop: ./menu.sh → «Обновить Remnashop» → ветка main. Если имена контейнеров другие, задайте их в $ENV_FILE."
  [ "$running" = "true" ] || fail "контейнер $container не запущен" "запустите Remnashop (cd /opt/remnashop && docker compose up -d) и посмотрите журнал: docker logs $container."
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
    || fail "в настройках нет REMNASHOP_AUTH_SERVICE_KEY" "свяжите Clean Pay и Remnashop: ./menu.sh remnashop-link."

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
    "/api/v1/public/auth/notifications/feed",
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
  ) || fail "не удалось обратиться к API Remnashop" "проверьте, что он запущен и здоров: docker ps и docker logs $api_container."

  case "$contract_statuses" in
    "422 405 405") ;;
    # 405 proves the Clean Pay build is running, so a 401 means only the shared key differs
    "401 405 405")
      fail "Remnashop отклонил ключ Clean Pay (401): REMNASHOP_AUTH_SERVICE_KEY в $ENV_FILE не совпадает с APP_AUTH_SERVICE_KEY в $remnashop_env_file" "выполните ./menu.sh remnashop-link: команда выровняет ключи и перезапустит Remnashop." ;;
    *)
      incompatible "API Remnashop устарел: ответы $contract_statuses вместо 422 405 405 (нужна схема 0061 с лентой уведомлений)" ;;
  esac
}

api_container=$(env_value REMNASHOP_API_CONTAINER remnashop)
worker_container=$(env_value REMNASHOP_WORKER_CONTAINER remnashop-taskiq-worker)
scheduler_container=$(env_value REMNASHOP_SCHEDULER_CONTAINER remnashop-taskiq-scheduler)
postgres_container=$(env_value REMNASHOP_POSTGRES_CONTAINER remnashop-db)

api_image=$(container_image "$api_container")
worker_image=$(container_image "$worker_container")
scheduler_image=$(container_image "$scheduler_container")
container_image "$postgres_container" >/dev/null

if [ "$api_image" != "$worker_image" ] || [ "$api_image" != "$scheduler_image" ]; then
  fail "API, worker и scheduler Remnashop запущены из разных образов (api=$api_image worker=$worker_image scheduler=$scheduler_image)" "повторите обновление, оно перезапустит все три: ./menu.sh → «Обновить Remnashop» → ветка main."
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
[ "$schema_ready" = "t" ] || incompatible "в базе Remnashop нет нужных таблиц и полей платежей и напоминаний"

current_revision=$(database_query -c "SELECT version_num FROM alembic_version;")
case "$current_revision:$minimum_revision" in
  *[!0-9:]*|:*|*:) fail "версии схемы должны быть числами (сейчас $current_revision, нужна $minimum_revision)" "проверьте таблицу alembic_version в базе Remnashop." ;;
esac
[ "$current_revision" -ge "$minimum_revision" ] \
  || incompatible "схема Remnashop $current_revision старше требуемой $minimum_revision"

probe_notification_preferences_contract

if [ "$PHASE" = "check" ]; then
  info "совместимость подтверждена (схема $current_revision, образ $api_image)"
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
        'Защитный режим платежей не снят: уже есть операции (%). Обратитесь к разделу о запуске Remnashop в README',
        payment_operation_count;
    END IF;

    SELECT count(*)
    INTO active_fulfillment_count
    FROM transactions
    WHERE fulfillment_status = 'PROCESSING'
       OR fulfillment_token_hash IS NOT NULL;

    IF active_fulfillment_count <> 0 THEN
      RAISE EXCEPTION
        'Защитный режим платежей не снят: есть незавершённые выдачи (%). Дождитесь их завершения и повторите',
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
    RAISE EXCEPTION 'Защитный режим платежей остался включён. Повторите обновление';
  END IF;
END
$$;

COMMIT;
SQL

info "защитный режим платежей снят (схема $current_revision, образ $api_image)"
