#!/usr/bin/env bash
set -Eeuo pipefail

# Disposable, synthetic-data-only rehearsal of the audited Remnashop migration
# boundary. The caller must check out the exact reviewed source revision first.
readonly EXPECTED_REMNASHOP_REVISION="837d964269078142307794ba3566a30d40b7b0b6"
readonly POSTGRES_IMAGE="postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73"
readonly REMNASHOP_SOURCE="${REMNASHOP_SOURCE:?REMNASHOP_SOURCE must point to the reviewed checkout}"
readonly REHEARSAL_OUTPUT_DIR="${REHEARSAL_OUTPUT_DIR:?REHEARSAL_OUTPUT_DIR must be explicit}"
readonly RUN_SUFFIX="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$-${RANDOM}"
readonly NETWORK="clean-pay-remnashop-rehearsal-${RUN_SUFFIX}"
readonly POSTGRES_CONTAINER="clean-pay-remnashop-postgres-${RUN_SUFFIX}"
readonly REMNASHOP_IMAGE="clean-pay-remnashop-rehearsal:${RUN_SUFFIX}"
readonly DATABASE_USER="remnashop"
readonly DATABASE_PASSWORD="synthetic-rehearsal-password"
readonly REHEARSAL_APP_CRYPT_KEY="MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" # gitleaks:allow -- synthetic rehearsal credential
readonly REHEARSAL_BOT_TOKEN="1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"
readonly SOURCE_DATABASE="remnashop_source"
readonly ROLLBACK_DATABASE="remnashop_rollback"
readonly LOCK_DATABASE="remnashop_lock_retry"
readonly INVALID_OWNER_DATABASE="remnashop_invalid_owner"
readonly ROW_LOCK_DATABASE="remnashop_row_lock_retry"

cleanup() {
  docker rm --force "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  docker image rm "$REMNASHOP_IMAGE" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  printf 'Remnashop migration rehearsal failed: %s\n' "$*" >&2
  exit 1
}

query() {
  local database=$1
  local statement=$2
  docker exec "$POSTGRES_CONTAINER" psql \
    --no-psqlrc --tuples-only --no-align --quiet \
    --username "$DATABASE_USER" --dbname "$database" \
    --set ON_ERROR_STOP=1 --command "$statement"
}

create_database() {
  docker exec "$POSTGRES_CONTAINER" createdb \
    --username "$DATABASE_USER" --template template0 --encoding UTF8 "$1"
}

remnashop() {
  local database=$1
  shift
  docker run --rm --network "$NETWORK" \
    --env APP_DOMAIN=rehearsal.invalid \
    --env APP_CRYPT_KEY="$REHEARSAL_APP_CRYPT_KEY" \
    --env WEB_ENABLED=true \
    --env APP_API_KEY=synthetic-rehearsal-public-api-key \
    --env APP_JWT_SECRET=synthetic-rehearsal-web-jwt-secret \
    --env APP_AUTH_SERVICE_KEY=synthetic-rehearsal-auth-service-key \
    --env BOT_TOKEN="$REHEARSAL_BOT_TOKEN" \
    --env BOT_SECRET_TOKEN=synthetic-rehearsal-webhook-token \
    --env BOT_OWNER_ID=900000000001 \
    --env BOT_SUPPORT_USERNAME=rehearsal_support \
    --env BOT_MINI_APP=false \
    --env REMNAWAVE_HOST=http://remnawave.invalid \
    --env REMNAWAVE_TOKEN=synthetic-rehearsal-remnawave-token \
    --env REMNAWAVE_WEBHOOK_SECRET=synthetic-rehearsal-remnawave-webhook \
    --env DATABASE_HOST="$POSTGRES_CONTAINER" \
    --env DATABASE_PORT=5432 \
    --env DATABASE_NAME="$database" \
    --env DATABASE_USER="$DATABASE_USER" \
    --env DATABASE_PASSWORD="$DATABASE_PASSWORD" \
    --env REDIS_HOST=redis.invalid \
    --env REDIS_PORT=6379 \
    --env REDIS_NAME=0 \
    --env LOG_TO_FILE=false \
    "$REMNASHOP_IMAGE" "$@"
}

migrate() {
  local database=$1
  local revision=$2
  remnashop "$database" alembic \
    --config src/infrastructure/database/alembic.ini upgrade "$revision"
}

revision() {
  query "$1" "SELECT version_num FROM alembic_version;" | tr -d '[:space:]'
}

fixture_state() {
  query "$1" \
    "SELECT count(*) || '|' || md5(string_agg(concat_ws('|', telegram_id, name, role, language, referral_code, auth_type), ',' ORDER BY telegram_id)) FROM users;" \
    | tr -d '[:space:]'
}

mkdir -p "$REHEARSAL_OUTPUT_DIR"
test -d "$REMNASHOP_SOURCE/.git" || fail "source is not a Git checkout"
actual_revision=$(git -C "$REMNASHOP_SOURCE" rev-parse HEAD)
test "$actual_revision" = "$EXPECTED_REMNASHOP_REVISION" ||
  fail "expected Remnashop $EXPECTED_REMNASHOP_REVISION, got $actual_revision"
test -z "$(git -C "$REMNASHOP_SOURCE" status --porcelain=v1 --untracked-files=all)" ||
  fail "the reviewed Remnashop checkout is dirty"

docker network create "$NETWORK" >/dev/null
docker run --detach --name "$POSTGRES_CONTAINER" --network "$NETWORK" \
  --env POSTGRES_DB=postgres \
  --env POSTGRES_USER="$DATABASE_USER" \
  --env POSTGRES_PASSWORD="$DATABASE_PASSWORD" \
  "$POSTGRES_IMAGE" >/dev/null

for attempt in $(seq 1 60); do
  if docker exec "$POSTGRES_CONTAINER" pg_isready \
    --username "$DATABASE_USER" --dbname postgres >/dev/null 2>&1; then
    break
  fi
  test "$attempt" -lt 60 || fail "PostgreSQL did not become ready"
  sleep 1
done

docker build --pull --tag "$REMNASHOP_IMAGE" \
  --build-arg BUILD_TIME=1970-01-01T00:00:00Z \
  --build-arg BUILD_BRANCH=audit-rehearsal \
  --build-arg BUILD_COMMIT="$EXPECTED_REMNASHOP_REVISION" \
  --build-arg BUILD_TAG=v0.0.0 \
  "$REMNASHOP_SOURCE" \
  >"$REHEARSAL_OUTPUT_DIR/image-build.log" 2>&1

create_database "$SOURCE_DATABASE"
migrate "$SOURCE_DATABASE" 0040 \
  >"$REHEARSAL_OUTPUT_DIR/forward-to-0040.log" 2>&1
test "$(revision "$SOURCE_DATABASE")" = "0040" || fail "source did not reach 0040"

docker exec --interactive "$POSTGRES_CONTAINER" psql \
  --no-psqlrc --username "$DATABASE_USER" --dbname "$SOURCE_DATABASE" \
  --set ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users (
  telegram_id, username, name, role, language,
  personal_discount, purchase_discount, is_blocked, is_bot_blocked,
  referral_code, points, is_rules_accepted, is_trial_available,
  auth_type, is_email_verified
) VALUES
  (900000000001, 'fixture_owner', 'Synthetic Owner', 'OWNER', 'RU',
   0, 0, false, false, 'fixture-owner', 0, true, true, 'telegram', false),
  (900000000002, 'fixture_member', 'Synthetic Member', 'USER', 'EN',
   7, 3, false, false, 'fixture-member', 10, true, false, 'telegram', false);
SQL

pre_state=$(fixture_state "$SOURCE_DATABASE")
[[ "$pre_state" =~ ^2\|[a-f0-9]{32}$ ]] || fail "unexpected non-empty fixture state"

docker exec "$POSTGRES_CONTAINER" pg_dump \
  --username "$DATABASE_USER" --dbname "$SOURCE_DATABASE" \
  --format custom --file /tmp/remnashop-pre-0040.dump
docker exec "$POSTGRES_CONTAINER" pg_restore --list /tmp/remnashop-pre-0040.dump \
  >"$REHEARSAL_OUTPUT_DIR/pre-0040-backup.list"
test -s "$REHEARSAL_OUTPUT_DIR/pre-0040-backup.list" || fail "pre-upgrade backup inventory is empty"

migrate "$SOURCE_DATABASE" 0047 \
  >"$REHEARSAL_OUTPUT_DIR/forward-0040-to-0047.log" 2>&1
test "$(revision "$SOURCE_DATABASE")" = "0047" || fail "source did not reach 0047"
test "$(fixture_state "$SOURCE_DATABASE")" = "$pre_state" || fail "user fixture changed before 0047"

docker exec --interactive "$POSTGRES_CONTAINER" psql \
  --no-psqlrc --username "$DATABASE_USER" --dbname "$SOURCE_DATABASE" \
  --set ON_ERROR_STOP=1 <<'SQL'
INSERT INTO payment_operations (
  user_id, operation, idempotency_key, request_hash, status, provider_key, response
) VALUES (
  (SELECT id FROM users WHERE telegram_id = 900000000001),
  'PURCHASE', 'synthetic-idempotency', repeat('a', 64), 'UNKNOWN',
  'synthetic-provider-key', NULL
);
INSERT INTO user_merge_audit (
  actor_user_id, actor_role, source_user_id, target_user_id,
  reason, dry_run, moved, conflicts
) SELECT owner.id, 'OWNER', member.id, owner.id,
         'synthetic rehearsal dry run', true, '{}'::jsonb, '{}'::jsonb
    FROM users owner, users member
   WHERE owner.telegram_id = 900000000001
     AND member.telegram_id = 900000000002;
SQL

test "$(query "$SOURCE_DATABASE" "SELECT count(*) FROM payment_operations;")" = "1" ||
  fail "pre-0048 payment operation fixture is missing"
test "$(query "$SOURCE_DATABASE" "SELECT count(*) FROM user_merge_audit;")" = "1" ||
  fail "pre-0048 owner-fencing audit fixture is missing"

docker exec "$POSTGRES_CONTAINER" pg_dump \
  --username "$DATABASE_USER" --dbname "$SOURCE_DATABASE" \
  --format custom --file /tmp/remnashop-pre-0048.dump
docker exec "$POSTGRES_CONTAINER" pg_restore --list /tmp/remnashop-pre-0048.dump \
  >"$REHEARSAL_OUTPUT_DIR/pre-0048-backup.list"
test -s "$REHEARSAL_OUTPUT_DIR/pre-0048-backup.list" || fail "pre-0048 backup inventory is empty"

migrate "$SOURCE_DATABASE" 0058 \
  >"$REHEARSAL_OUTPUT_DIR/forward-0047-to-0058.log" 2>&1
test "$(revision "$SOURCE_DATABASE")" = "0058" || fail "source did not reach 0058"
test "$(fixture_state "$SOURCE_DATABASE")" = "$pre_state" || fail "user fixture changed"
test "$(query "$SOURCE_DATABASE" "SELECT status FROM payment_operations WHERE provider_key = 'synthetic-provider-key';")" = "MANUAL_REQUIRED" ||
  fail "0049 did not conservatively migrate the populated UNKNOWN operation"

if query "$SOURCE_DATABASE" \
  "UPDATE users SET merged_into_user_id = (SELECT id FROM users WHERE telegram_id = 900000000002) WHERE telegram_id = 900000000001;" \
  >"$REHEARSAL_OUTPUT_DIR/owner-fencing.log" 2>&1; then
  fail "payment-operation owner fencing unexpectedly allowed a merge"
fi
test "$(query "$SOURCE_DATABASE" "SELECT count(*) FROM payment_operations;")" = "1" ||
  fail "payment operation fixture is missing"
test "$(query "$SOURCE_DATABASE" "SELECT count(*) FROM user_merge_audit;")" = "1" ||
  fail "owner-fencing audit fixture is missing"
test "$(query "$SOURCE_DATABASE" "SELECT count(*) FROM users WHERE merged_into_user_id IS NOT NULL;")" = "0" ||
  fail "failed owner merge was not atomic"

migrate "$SOURCE_DATABASE" 0058 \
  >"$REHEARSAL_OUTPUT_DIR/no-op-0058.log" 2>&1
test "$(revision "$SOURCE_DATABASE")" = "0058" || fail "no-op rerun changed revision"
if grep -q "Running upgrade" "$REHEARSAL_OUTPUT_DIR/no-op-0058.log"; then
  fail "second 0058 migration run was not a no-op"
fi

docker exec "$POSTGRES_CONTAINER" pg_dump \
  --username "$DATABASE_USER" --dbname "$SOURCE_DATABASE" \
  --format custom --file /tmp/remnashop-post-0058.dump
docker exec "$POSTGRES_CONTAINER" pg_restore --list /tmp/remnashop-post-0058.dump \
  >"$REHEARSAL_OUTPUT_DIR/post-0058-backup.list"
test -s "$REHEARSAL_OUTPUT_DIR/post-0058-backup.list" || fail "post-upgrade backup inventory is empty"

create_database "$ROLLBACK_DATABASE"
docker exec "$POSTGRES_CONTAINER" pg_restore \
  --exit-on-error --no-owner --username "$DATABASE_USER" \
  --dbname "$ROLLBACK_DATABASE" /tmp/remnashop-pre-0040.dump \
  >"$REHEARSAL_OUTPUT_DIR/restore-0040.log" 2>&1
test "$(revision "$ROLLBACK_DATABASE")" = "0040" || fail "restore did not preserve 0040"
test "$(fixture_state "$ROLLBACK_DATABASE")" = "$pre_state" || fail "restore changed fixture"

create_database "$INVALID_OWNER_DATABASE"
docker exec "$POSTGRES_CONTAINER" pg_restore \
  --exit-on-error --no-owner --username "$DATABASE_USER" \
  --dbname "$INVALID_OWNER_DATABASE" /tmp/remnashop-pre-0048.dump \
  >"$REHEARSAL_OUTPUT_DIR/invalid-owner-restore-0047.log" 2>&1
test "$(revision "$INVALID_OWNER_DATABASE")" = "0047" ||
  fail "invalid-owner fixture did not restore at 0047"
query "$INVALID_OWNER_DATABASE" \
  "UPDATE users SET merged_into_user_id = (SELECT id FROM users WHERE telegram_id = 900000000002), merged_at = clock_timestamp() WHERE telegram_id = 900000000001;" \
  >/dev/null
test "$(query "$INVALID_OWNER_DATABASE" "SELECT count(*) FROM payment_operations po JOIN users u ON u.id = po.user_id WHERE u.merged_into_user_id IS NOT NULL;")" = "1" ||
  fail "deliberately invalid pre-0048 owner fixture is missing"

set +e
migrate "$INVALID_OWNER_DATABASE" 0048 \
  >"$REHEARSAL_OUTPUT_DIR/invalid-owner-0048.log" 2>&1
invalid_owner_exit=$?
set -e
test "$invalid_owner_exit" -ne 0 || fail "0048 unexpectedly accepted a merged payment-operation owner"
grep -q "migration 0048 blocked" "$REHEARSAL_OUTPUT_DIR/invalid-owner-0048.log" ||
  fail "0048 failure was not attributed to the invalid owner invariant"
test "$(revision "$INVALID_OWNER_DATABASE")" = "0047" ||
  fail "failed 0048 left a false revision"
test "$(query "$INVALID_OWNER_DATABASE" "SELECT count(*) FROM pg_constraint WHERE conname = 'payment_operations_user_id_fkey' AND confdeltype = 'c';")" = "1" ||
  fail "failed 0048 did not restore the original cascading foreign key"
test "$(query "$INVALID_OWNER_DATABASE" "SELECT count(*) FROM pg_constraint WHERE conname = 'fk_payment_operations_user_id_users';")" = "0" ||
  fail "failed 0048 left its replacement foreign key"
test "$(query "$INVALID_OWNER_DATABASE" "SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_payment_operations_active_user', 'trg_users_merge_without_payment_operations');")" = "0" ||
  fail "failed 0048 left partial owner-fencing triggers"
test "$(query "$INVALID_OWNER_DATABASE" "SELECT count(*) FROM payment_operations po JOIN users u ON u.id = po.user_id WHERE u.merged_into_user_id IS NOT NULL;")" = "1" ||
  fail "failed 0048 changed the deliberately invalid row"

query "$INVALID_OWNER_DATABASE" \
  "UPDATE users SET merged_into_user_id = NULL, merged_at = NULL WHERE telegram_id = 900000000001;" \
  >/dev/null
migrate "$INVALID_OWNER_DATABASE" 0058 \
  >"$REHEARSAL_OUTPUT_DIR/invalid-owner-repaired-to-0058.log" 2>&1
test "$(revision "$INVALID_OWNER_DATABASE")" = "0058" ||
  fail "repaired invalid-owner chain did not reach 0058"
test "$(query "$INVALID_OWNER_DATABASE" "SELECT status FROM payment_operations WHERE provider_key = 'synthetic-provider-key';")" = "MANUAL_REQUIRED" ||
  fail "repaired invalid-owner operation was not migrated conservatively"

create_database "$LOCK_DATABASE"
docker exec "$POSTGRES_CONTAINER" pg_restore \
  --exit-on-error --no-owner --username "$DATABASE_USER" \
  --dbname "$LOCK_DATABASE" /tmp/remnashop-pre-0040.dump \
  >"$REHEARSAL_OUTPUT_DIR/lock-restore-0040.log" 2>&1
migrate "$LOCK_DATABASE" 0044 \
  >"$REHEARSAL_OUTPUT_DIR/lock-forward-to-0044.log" 2>&1
test "$(revision "$LOCK_DATABASE")" = "0044" || fail "lock fixture did not reach 0044"
query postgres "ALTER DATABASE $LOCK_DATABASE SET lock_timeout = '1500ms';" >/dev/null

docker exec "$POSTGRES_CONTAINER" psql \
  --no-psqlrc --username "$DATABASE_USER" --dbname "$LOCK_DATABASE" \
  --set ON_ERROR_STOP=1 \
  --command "BEGIN; LOCK TABLE users IN ACCESS EXCLUSIVE MODE; SELECT pg_backend_pid(); SELECT pg_sleep(60); COMMIT;" \
  >"$REHEARSAL_OUTPUT_DIR/lock-holder.log" 2>&1 &
holder_client_pid=$!
holder_database_pid=""
for attempt in $(seq 1 50); do
  holder_database_pid=$(query "$LOCK_DATABASE" \
    "SELECT pid FROM pg_locks WHERE relation = 'users'::regclass AND mode = 'AccessExclusiveLock' AND granted AND pid <> pg_backend_pid() ORDER BY pid LIMIT 1;" \
    | tr -d '[:space:]')
  if [[ "$holder_database_pid" =~ ^[0-9]+$ ]]; then
    break
  fi
  test "$attempt" -lt 50 || fail "could not establish the users lock"
  sleep 0.1
done

lock_started_ms=$(date +%s%3N)
set +e
migrate "$LOCK_DATABASE" 0045 \
  >"$REHEARSAL_OUTPUT_DIR/lock-timeout-0045.log" 2>&1
lock_exit=$?
set -e
lock_finished_ms=$(date +%s%3N)
lock_elapsed_ms=$((lock_finished_ms - lock_started_ms))
test "$lock_exit" -ne 0 || fail "0045 unexpectedly succeeded while users was locked"
test "$lock_elapsed_ms" -ge 1000 || fail "lock timeout fired too early"
test "$lock_elapsed_ms" -le 15000 || fail "lock timeout exceeded the bounded budget"
grep -qi "lock timeout" "$REHEARSAL_OUTPUT_DIR/lock-timeout-0045.log" ||
  fail "migration failure was not attributed to lock_timeout"
test "$(revision "$LOCK_DATABASE")" = "0044" || fail "failed 0045 left a false revision"
test "$(query "$LOCK_DATABASE" "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('password_reset_code_hash', 'password_reset_expires_at', 'token_version');")" = "0" ||
  fail "failed 0045 left partial columns"

query "$LOCK_DATABASE" "SELECT pg_terminate_backend($holder_database_pid);" >/dev/null
wait "$holder_client_pid" || true
query postgres "ALTER DATABASE $LOCK_DATABASE RESET lock_timeout;" >/dev/null
migrate "$LOCK_DATABASE" 0058 \
  >"$REHEARSAL_OUTPUT_DIR/resume-0044-to-0058.log" 2>&1
test "$(revision "$LOCK_DATABASE")" = "0058" || fail "lock retry did not reach 0058"
test "$(fixture_state "$LOCK_DATABASE")" = "$pre_state" || fail "lock retry changed fixture"

create_database "$ROW_LOCK_DATABASE"
docker exec "$POSTGRES_CONTAINER" pg_restore \
  --exit-on-error --no-owner --username "$DATABASE_USER" \
  --dbname "$ROW_LOCK_DATABASE" /tmp/remnashop-pre-0040.dump \
  >"$REHEARSAL_OUTPUT_DIR/row-lock-restore-0040.log" 2>&1
migrate "$ROW_LOCK_DATABASE" 0050 \
  >"$REHEARSAL_OUTPUT_DIR/row-lock-forward-to-0050.log" 2>&1
test "$(revision "$ROW_LOCK_DATABASE")" = "0050" || fail "row-lock fixture did not reach 0050"
test "$(query "$ROW_LOCK_DATABASE" "SELECT legacy_rollout_gate_active FROM payment_runtime_control WHERE id = 1;")" = "t" ||
  fail "pre-0051 rollout gate fixture is not active"
query postgres "ALTER DATABASE $ROW_LOCK_DATABASE SET lock_timeout = '1500ms';" >/dev/null

docker exec "$POSTGRES_CONTAINER" psql \
  --no-psqlrc --username "$DATABASE_USER" --dbname "$ROW_LOCK_DATABASE" \
  --set ON_ERROR_STOP=1 \
  --command "BEGIN; SELECT id FROM payment_runtime_control WHERE id = 1 FOR UPDATE; SELECT pg_backend_pid(); SELECT pg_sleep(60); COMMIT;" \
  >"$REHEARSAL_OUTPUT_DIR/row-lock-holder.log" 2>&1 &
row_holder_client_pid=$!
row_holder_database_pid=""
for attempt in $(seq 1 50); do
  row_holder_database_pid=$(query "$ROW_LOCK_DATABASE" \
    "SELECT pid FROM pg_locks WHERE relation = 'payment_runtime_control'::regclass AND mode = 'RowShareLock' AND granted AND pid <> pg_backend_pid() ORDER BY pid LIMIT 1;" \
    | tr -d '[:space:]')
  if [[ "$row_holder_database_pid" =~ ^[0-9]+$ ]]; then
    break
  fi
  test "$attempt" -lt 50 || fail "could not establish the payment_runtime_control row lock"
  sleep 0.1
done

row_lock_started_ms=$(date +%s%3N)
set +e
migrate "$ROW_LOCK_DATABASE" 0051 \
  >"$REHEARSAL_OUTPUT_DIR/row-lock-timeout-0051.log" 2>&1
row_lock_exit=$?
set -e
row_lock_finished_ms=$(date +%s%3N)
row_lock_elapsed_ms=$((row_lock_finished_ms - row_lock_started_ms))
test "$row_lock_exit" -ne 0 || fail "0051 unexpectedly succeeded while rollout control was row-locked"
test "$row_lock_elapsed_ms" -ge 1000 || fail "row lock timeout fired too early"
test "$row_lock_elapsed_ms" -le 15000 || fail "row lock timeout exceeded the bounded budget"
grep -qi "lock timeout" "$REHEARSAL_OUTPUT_DIR/row-lock-timeout-0051.log" ||
  fail "0051 row-lock failure was not attributed to lock_timeout"
test "$(revision "$ROW_LOCK_DATABASE")" = "0050" || fail "failed 0051 left a false revision"
test "$(query "$ROW_LOCK_DATABASE" "SELECT legacy_rollout_gate_active FROM payment_runtime_control WHERE id = 1;")" = "t" ||
  fail "failed 0051 partially finalized the rollout gate"
test "$(query "$ROW_LOCK_DATABASE" "SELECT count(*) FROM pg_constraint WHERE conname = 'ck_payment_runtime_control_rollout_finalized';")" = "0" ||
  fail "failed 0051 left its rollout-finalized constraint"

query "$ROW_LOCK_DATABASE" "SELECT pg_terminate_backend($row_holder_database_pid);" >/dev/null
wait "$row_holder_client_pid" || true
query postgres "ALTER DATABASE $ROW_LOCK_DATABASE RESET lock_timeout;" >/dev/null
migrate "$ROW_LOCK_DATABASE" 0058 \
  >"$REHEARSAL_OUTPUT_DIR/row-lock-resume-0050-to-0058.log" 2>&1
test "$(revision "$ROW_LOCK_DATABASE")" = "0058" || fail "row-lock retry did not reach 0058"
test "$(query "$ROW_LOCK_DATABASE" "SELECT legacy_rollout_gate_active FROM payment_runtime_control WHERE id = 1;")" = "f" ||
  fail "0051 retry did not finalize the rollout gate"
test "$(query "$ROW_LOCK_DATABASE" "SELECT count(*) FROM pg_constraint WHERE conname = 'ck_payment_runtime_control_rollout_finalized';")" = "1" ||
  fail "0051 retry did not install the rollout-finalized constraint"

remnashop "$SOURCE_DATABASE" python -c \
  'import json; from fastapi.testclient import TestClient; from src.__main__ import application; app = application(); assert app.title; client = TestClient(app); headers = {"X-Remnashop-Auth-Service-Key": "synthetic-rehearsal-auth-service-key"}; probes = [("POST", "/api/v1/public/auth/email/start"), ("POST", "/api/v1/public/auth/identify"), ("POST", "/api/v1/public/auth/service-session"), ("POST", "/api/v1/public/auth/notification-preferences")]; statuses = [client.request(method, path, headers=headers, json={}).status_code for method, path in probes]; assert statuses == [422, 422, 422, 405], dict(zip((path for _, path in probes), statuses)); print(json.dumps({"emailStart": statuses[0], "identify": statuses[1], "serviceSession": statuses[2], "notificationPreferencesUnsupportedMethod": statuses[3]}, sort_keys=True))' \
  >"$REHEARSAL_OUTPUT_DIR/application-contract.log" 2>&1

fixture_hash=${pre_state#*|}
printf '{\n  "schemaVersion": 3,\n  "remnashopRevision": "%s",\n  "fixtureUsers": 2,\n  "fixturePaymentOperations": 1,\n  "fixtureOwnerFencingAudits": 1,\n  "fixtureHash": "%s",\n  "forward": "0040->0047(populate)->0058",\n  "noOpRevision": "0058",\n  "restoreRevision": "0040",\n  "invalidOwnerFailureRevision": "0047",\n  "invalidOwnerResumeRevision": "0058",\n  "tableLockFailureRevision": "0044",\n  "tableLockTimeoutMilliseconds": %s,\n  "tableLockResumeRevision": "0058",\n  "rowLockFailureRevision": "0050",\n  "rowLockTimeoutMilliseconds": %s,\n  "rowLockResumeRevision": "0058",\n  "applicationFactory": "passed",\n  "authApiContract": {"emailStart": 422, "identify": 422, "serviceSession": 422, "notificationPreferencesUnsupportedMethod": 405}\n}\n' \
  "$EXPECTED_REMNASHOP_REVISION" "$fixture_hash" "$lock_elapsed_ms" "$row_lock_elapsed_ms" \
  >"$REHEARSAL_OUTPUT_DIR/report.json"

printf 'Remnashop non-empty migration rehearsal passed; report: %s/report.json\n' \
  "$REHEARSAL_OUTPUT_DIR"
