#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

# Disposable, synthetic-data-only proof that the checked-out Clean Pay SQL
# migrations preserve representative legacy/session/payment state and roll
# back cleanly on both malformed data and a locked populated row.
readonly POSTGRES_IMAGE="postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73"
readonly REHEARSAL_OUTPUT_DIR="${REHEARSAL_OUTPUT_DIR:?REHEARSAL_OUTPUT_DIR must be explicit}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
case "$(uname -s)" in
  CYGWIN*|MINGW*|MSYS*) readonly DOCKER_PATH_CONVERSION_REQUIRED=true ;;
  *) readonly DOCKER_PATH_CONVERSION_REQUIRED=false ;;
esac
readonly RUN_SUFFIX="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$-${RANDOM}"
readonly NETWORK="clean-pay-migration-rehearsal-${RUN_SUFFIX}"
readonly POSTGRES_CONTAINER="clean-pay-migration-postgres-${RUN_SUFFIX}"
readonly MIGRATION_IMAGE="clean-pay-migration-rehearsal:${RUN_SUFFIX}"
readonly DATABASE_USER="clean_pay_rehearsal"
readonly DATABASE_PASSWORD="synthetic-clean-pay-rehearsal-password"
readonly DATABASE_NAME="clean_pay_populated"
readonly EMPTY_DATABASE_NAME="clean_pay_empty"
readonly RESTORE_DATABASE_NAME="clean_pay_restore"
readonly INITIAL_REVISION="20260619145932_init"
readonly SESSION_REWRITE_REVISION="20260619153000_add_auth_cache_models"
readonly TELEGRAM_REVISION="20260619154500_add_telegram_oidc"
readonly SESSION_TOKEN_REVISION="20260619161000_add_remnashop_session_tokens"
readonly PAYMENT_RECORD_REVISION="20260624213935_add_auth_pending"
readonly PAYMENT_OPERATION_REVISION="20260717223000_add_payment_idempotency"
readonly PAYMENT_RECONCILIATION_REVISION="20260718000000_add_payment_reconciliation"
readonly REFRESH_ROTATION_REVISION="20260720233000_add_refresh_token_rotation"
readonly OWNER_FENCE_REVISION="20260813090000_add_payment_owner_change_fence"
readonly REFRESH_RECOVERY_REVISION="20260813091000_add_remnashop_refresh_recovery"
readonly CLEAN_PAY_HEAD="$(find "$ROOT_DIR/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort | tail -n 1)"
encrypted_fixture_file=""
migration_stage_root=""
migration_build_log=""

docker_host_path() {
  if [ "$DOCKER_PATH_CONVERSION_REQUIRED" = true ]; then
    cygpath -w -- "$1"
  else
    printf '%s\n' "$1"
  fi
}

docker() {
  if [ "$DOCKER_PATH_CONVERSION_REQUIRED" = true ]; then
    MSYS_NO_PATHCONV=1 command docker "$@"
  else
    command docker "$@"
  fi
}

cleanup() {
  if [ -n "$encrypted_fixture_file" ] && [ -f "$encrypted_fixture_file" ]; then
    rm -f -- "$encrypted_fixture_file"
  fi
  if [ -n "$migration_build_log" ] && [ -f "$migration_build_log" ]; then
    rm -f -- "$migration_build_log"
  fi
  case "$migration_stage_root" in
    /tmp/clean-pay-migration-stages.*)
      rm -rf -- "$migration_stage_root"
      ;;
  esac
  docker rm --force "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  docker image rm "$MIGRATION_IMAGE" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  printf 'Clean Pay migration rehearsal failed: %s\n' "$*" >&2
  exit 1
}

query_database() {
  local database=$1
  local statement=$2
  docker exec "$POSTGRES_CONTAINER" psql \
    --no-psqlrc --tuples-only --no-align --quiet \
    --username "$DATABASE_USER" --dbname "$database" \
    --set ON_ERROR_STOP=1 --command "$statement"
}

query() {
  query_database "$DATABASE_NAME" "$1"
}

revision() {
  local database=${1:-$DATABASE_NAME}
  query_database "$database" \
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC, started_at DESC LIMIT 1;' \
    | tr -d '[:space:]'
}

database_url() {
  printf 'postgresql://%s:%s@%s:5432/%s?schema=public' \
    "$DATABASE_USER" "$DATABASE_PASSWORD" "$POSTGRES_CONTAINER" "$1"
}

stage_migrations_through() {
  local target=$1
  local stage_dir="$migration_stage_root/$target"
  local migration_file
  local migration_name
  if [ -d "$stage_dir" ]; then
    printf '%s\n' "$stage_dir"
    return 0
  fi
  mkdir -p "$stage_dir"
  cp -- "$ROOT_DIR/prisma/migrations/migration_lock.toml" "$stage_dir/migration_lock.toml"
  for migration_file in "$ROOT_DIR"/prisma/migrations/*/migration.sql; do
    migration_name=$(basename "$(dirname "$migration_file")")
    [[ "$migration_name" > "$target" ]] && break
    cp -R -- "$(dirname "$migration_file")" "$stage_dir/$migration_name"
  done
  chmod -R a=rX,u+w "$stage_dir"
  test -f "$stage_dir/$target/migration.sql" || fail "could not stage migration $target"
  printf '%s\n' "$stage_dir"
}

run_prisma() {
  local database=$1
  local target=$2
  shift 2
  local stage_dir
  local stage_mount_source
  stage_dir=$(stage_migrations_through "$target")
  stage_mount_source=$(docker_host_path "$stage_dir")
  docker run --rm --network "$NETWORK" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --pids-limit 128 --memory 1g --cpus 1 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --mount "type=bind,source=$stage_mount_source,target=/app/prisma/migrations,readonly" \
    --env DATABASE_URL="$(database_url "$database")" \
    "$MIGRATION_IMAGE" \
    node node_modules/prisma/build/index.js "$@"
}

apply_through() {
  local target=$1
  run_prisma "$DATABASE_NAME" "$target" migrate deploy
  test "$(revision)" = "$target" || fail "migration chain did not reach $target"
}

mark_rolled_back() {
  local migration_name=$1
  run_prisma "$DATABASE_NAME" "$migration_name" migrate resolve --rolled-back "$migration_name"
  test "$(query "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '$migration_name' AND finished_at IS NULL AND rolled_back_at IS NOT NULL;")" = "1" ||
    fail "Prisma did not record $migration_name as rolled back"
}

run_exact_migration_image() {
  local database=$1
  docker run --rm --network "$NETWORK" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --pids-limit 128 --memory 1g --cpus 1 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --env DATABASE_URL="$(database_url "$database")" \
    --env CLEAN_PAY_RUNTIME_ROLE=migration \
    --env CLEAN_PAY_DEPLOY_SOURCE=build \
    --env CLEAN_PAY_IMAGE=clean-pay-rehearsal-app:synthetic \
    --env CLEAN_PAY_MIGRATION_IMAGE="$MIGRATION_IMAGE" \
    "$MIGRATION_IMAGE"
}

encrypted_session_state() {
  query \
    "SELECT count(*) || '|' || md5(string_agg(concat_ws('|', s.\"remnashopAccessTokenEncrypted\", s.\"remnashopRefreshTokenEncrypted\", s.\"remnashopRefreshRecoveryEncrypted\", r.\"successorTokenEncrypted\", s.\"remnashopAccessExpiresAt\", s.\"remnashopRefreshExpiresAt\", r.\"graceExpiresAt\"), ',' ORDER BY s.id)) FROM \"WebSession\" s JOIN \"WebRefreshToken\" r ON r.\"sessionId\" = s.id WHERE s.id = 'fixture-session';" \
    | tr -d '[:space:]'
}

test -e "$ROOT_DIR/.git" || fail "Clean Pay source is not a Git checkout"
readonly CLEAN_PAY_REVISION="$(git -C "$ROOT_DIR" rev-parse HEAD)"
[[ "$CLEAN_PAY_REVISION" =~ ^[0-9a-f]{40}$ ]] || fail "invalid Clean Pay Git revision"
[[ "$CLEAN_PAY_HEAD" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || fail "invalid Clean Pay migration head"
test -z "$(git -C "$ROOT_DIR" status --porcelain=v1 --untracked-files=all)" ||
  fail "the Clean Pay checkout is dirty"
mkdir -p "$REHEARSAL_OUTPUT_DIR"
migration_stage_root=$(mktemp -d /tmp/clean-pay-migration-stages.XXXXXX)
chmod 0755 "$migration_stage_root"
migration_build_log=$(mktemp)

set +e
docker build --pull --target migration \
  --build-arg CLEAN_PAY_RELEASE=audit-rehearsal \
  --build-arg CLEAN_PAY_REVISION="$CLEAN_PAY_REVISION" \
  --tag "$MIGRATION_IMAGE" "$(docker_host_path "$ROOT_DIR")" \
  >"$migration_build_log" 2>&1
migration_build_exit=$?
set -e
cp -- "$migration_build_log" "$REHEARSAL_OUTPUT_DIR/clean-pay-migration-image-build.log"
rm -f -- "$migration_build_log"
migration_build_log=""
test "$migration_build_exit" -eq 0 || fail "could not build the exact Clean Pay migration image"
test "$(docker image inspect --format '{{index .Config.Labels "io.clean-pay.role"}}' "$MIGRATION_IMAGE")" = "migration" ||
  fail "Clean Pay rehearsal image is not the migration target"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$MIGRATION_IMAGE")" = "$CLEAN_PAY_REVISION" ||
  fail "Clean Pay rehearsal image revision label does not match the checkout"

docker network create "$NETWORK" >/dev/null
docker run --detach --name "$POSTGRES_CONTAINER" --network "$NETWORK" \
  --env POSTGRES_DB="$DATABASE_NAME" \
  --env POSTGRES_USER="$DATABASE_USER" \
  --env POSTGRES_PASSWORD="$DATABASE_PASSWORD" \
  "$POSTGRES_IMAGE" >/dev/null

for attempt in $(seq 1 60); do
  if docker exec "$POSTGRES_CONTAINER" pg_isready \
    --username "$DATABASE_USER" --dbname "$DATABASE_NAME" >/dev/null 2>&1; then
    break
  fi
  test "$attempt" -lt 60 || fail "PostgreSQL did not become ready"
  sleep 1
done

docker exec "$POSTGRES_CONTAINER" createdb \
  --username "$DATABASE_USER" --template template0 --encoding UTF8 "$EMPTY_DATABASE_NAME"
run_exact_migration_image "$EMPTY_DATABASE_NAME" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-empty-migration-image.log" 2>&1
test "$(revision "$EMPTY_DATABASE_NAME")" = "$CLEAN_PAY_HEAD" ||
  fail "exact migration image did not migrate the empty database to head"
grep -q "event=production_environment_validated" "$REHEARSAL_OUTPUT_DIR/clean-pay-empty-migration-image.log" ||
  fail "exact migration image did not run its production environment guard"
expected_migration_count=$(find "$ROOT_DIR/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d '[:space:]')
test "$(query_database "$EMPTY_DATABASE_NAME" 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')" = "$expected_migration_count" ||
  fail "empty database did not record every Prisma migration"

apply_through "$INITIAL_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-forward-to-init.log" 2>&1
test "$(revision)" = "$INITIAL_REVISION" || fail "Clean Pay fixture did not reach init"

query \
  "INSERT INTO \"WebUser\" (id, \"remnashopUserId\", email, \"emailVerified\", \"displayName\", \"updatedAt\") VALUES ('fixture-user', 'fixture-remnashop-user', 'fixture-user@rehearsal.invalid', true, 'Synthetic User', '2026-01-01T00:00:00Z'); INSERT INTO \"WebSession\" (id, \"userId\", \"refreshTokenHash\", \"userAgent\", \"ipHash\", \"expiresAt\", \"updatedAt\") VALUES ('fixture-session', 'fixture-user', repeat('1', 64), 'synthetic-rehearsal-agent', repeat('2', 64), '2040-01-02T03:04:05Z', '2026-01-01T00:00:00Z');" \
  >/dev/null
legacy_expiry=$(query "SELECT \"expiresAt\" FROM \"WebSession\" WHERE id = 'fixture-session';" | tr -d '[:space:]')
test -n "$legacy_expiry" || fail "legacy WebSession fixture is missing"
docker exec "$POSTGRES_CONTAINER" pg_dump \
  --username "$DATABASE_USER" --dbname "$DATABASE_NAME" \
  --format custom --file /tmp/clean-pay-pre-session-rewrite.dump
docker exec "$POSTGRES_CONTAINER" pg_restore --list /tmp/clean-pay-pre-session-rewrite.dump \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-pre-session-backup.list"
test -s "$REHEARSAL_OUTPUT_DIR/clean-pay-pre-session-backup.list" ||
  fail "Clean Pay pre-session backup inventory is empty"

docker exec "$POSTGRES_CONTAINER" psql \
  --no-psqlrc --username "$DATABASE_USER" --dbname "$DATABASE_NAME" \
  --set ON_ERROR_STOP=1 \
  --command "BEGIN; SELECT id FROM \"WebSession\" WHERE id = 'fixture-session' FOR UPDATE; SELECT pg_backend_pid(); SELECT pg_sleep(60); COMMIT;" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-session-row-lock-holder.log" 2>&1 &
session_holder_client_pid=$!
session_holder_database_pid=""
for attempt in $(seq 1 50); do
  session_holder_database_pid=$(query \
    "SELECT pid FROM pg_locks WHERE relation = '\"WebSession\"'::regclass AND mode = 'RowShareLock' AND granted AND pid <> pg_backend_pid() ORDER BY pid LIMIT 1;" \
    | tr -d '[:space:]')
  if [[ "$session_holder_database_pid" =~ ^[0-9]+$ ]]; then
    break
  fi
  test "$attempt" -lt 50 || fail "could not establish the populated WebSession row lock"
  sleep 0.1
done
query "ALTER DATABASE $DATABASE_NAME SET lock_timeout = '1500ms';" >/dev/null

session_lock_started_ms=$(date +%s%3N)
set +e
run_prisma "$DATABASE_NAME" "$SESSION_REWRITE_REVISION" migrate deploy \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-session-row-lock-timeout.log" 2>&1
session_lock_exit=$?
set -e
session_lock_finished_ms=$(date +%s%3N)
session_lock_elapsed_ms=$((session_lock_finished_ms - session_lock_started_ms))
test "$session_lock_exit" -ne 0 || fail "session rewrite unexpectedly succeeded while a populated row was locked"
test "$session_lock_elapsed_ms" -ge 1000 || fail "session row lock timeout fired too early"
test "$session_lock_elapsed_ms" -le 15000 || fail "session row lock timeout exceeded the bounded budget"
docker logs "$POSTGRES_CONTAINER" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-session-row-lock-server.log" 2>&1
grep -qi "canceling statement due to lock timeout" \
  "$REHEARSAL_OUTPUT_DIR/clean-pay-session-row-lock-server.log" ||
  fail "session rewrite failure was not attributed to lock_timeout"
test "$(revision)" = "$INITIAL_REVISION" || fail "failed session rewrite left a false revision"
test "$(query "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '$SESSION_REWRITE_REVISION' AND finished_at IS NULL AND rolled_back_at IS NULL;")" = "1" ||
  fail "Prisma did not preserve the failed session migration status"
test "$(query "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'WebSession' AND column_name IN ('accessTokenExpiresAt', 'refreshExpiresAt');")" = "0" ||
  fail "failed session rewrite left replacement columns"
test "$(query "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'WebSession' AND column_name = 'expiresAt';")" = "1" ||
  fail "failed session rewrite removed the legacy expiry"
test "$(query "SELECT count(*) FROM \"WebSession\" WHERE id = 'fixture-session';")" = "1" ||
  fail "failed session rewrite changed the populated row"

query "SELECT pg_terminate_backend($session_holder_database_pid);" >/dev/null
wait "$session_holder_client_pid" || true
query "ALTER DATABASE $DATABASE_NAME RESET lock_timeout;" >/dev/null
mark_rolled_back "$SESSION_REWRITE_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-session-row-lock-resolve.log" 2>&1
apply_through "$SESSION_REWRITE_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-session-rewrite-resume.log" 2>&1
test "$(query "SELECT concat_ws('|', \"accessTokenExpiresAt\", \"refreshExpiresAt\") FROM \"WebSession\" WHERE id = 'fixture-session';" | tr -d '[:space:]')" = "$legacy_expiry|$legacy_expiry" ||
  fail "session rewrite did not preserve the legacy expiry"

query "UPDATE \"WebUser\" SET \"telegramId\" = 'malformed-telegram-id' WHERE id = 'fixture-user';" >/dev/null
set +e
run_prisma "$DATABASE_NAME" "$TELEGRAM_REVISION" migrate deploy \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-invalid-telegram.log" 2>&1
invalid_telegram_exit=$?
set -e
test "$invalid_telegram_exit" -ne 0 || fail "Telegram migration unexpectedly accepted malformed legacy data"
docker logs "$POSTGRES_CONTAINER" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-invalid-telegram-server.log" 2>&1
grep -q "Telegram ID migration blocked: 1 malformed or out-of-range rows" \
  "$REHEARSAL_OUTPUT_DIR/clean-pay-invalid-telegram-server.log" ||
  fail "Telegram migration failure was not attributed to malformed data"
test "$(revision)" = "$SESSION_REWRITE_REVISION" || fail "failed Telegram migration left a false revision"
test "$(query "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '$TELEGRAM_REVISION' AND finished_at IS NULL AND rolled_back_at IS NULL;")" = "1" ||
  fail "Prisma did not preserve the failed Telegram migration status"
test "$(query "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'WebUser' AND column_name = 'telegramId';" | tr -d '[:space:]')" = "text" ||
  fail "failed Telegram migration partially changed the identity type"
test "$(query "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'WebUser' AND column_name = 'fullName';")" = "0" ||
  fail "failed Telegram migration left partial user columns"
test "$(query "SELECT count(*) FROM pg_class WHERE oid = to_regclass('\"TelegramAuthState\"');")" = "0" ||
  fail "failed Telegram migration left a partial auth-state table"
test "$(query "SELECT \"telegramId\" FROM \"WebUser\" WHERE id = 'fixture-user';" | tr -d '[:space:]')" = "malformed-telegram-id" ||
  fail "failed Telegram migration changed the invalid source row"

query "UPDATE \"WebUser\" SET \"telegramId\" = '900000000001' WHERE id = 'fixture-user';" >/dev/null
mark_rolled_back "$TELEGRAM_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-invalid-telegram-resolve.log" 2>&1
apply_through "$TELEGRAM_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-invalid-telegram-repaired.log" 2>&1
test "$(query "SELECT \"telegramId\" FROM \"WebUser\" WHERE id = 'fixture-user';" | tr -d '[:space:]')" = "900000000001" ||
  fail "repaired Telegram identity did not survive the migration"

encrypted_fixture_file=$(mktemp)
node --input-type=module >"$encrypted_fixture_file" <<'NODE'
import { createCipheriv, createHash, randomBytes } from "node:crypto";

const secret = "synthetic-migration-rehearsal-key-not-a-secret";
const encrypt = (value) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
};
for (const value of ["synthetic-access", "synthetic-refresh", "synthetic-successor", "synthetic-recovery"]) {
  console.log(encrypt(value));
}
NODE
encrypted_access=$(sed -n '1p' "$encrypted_fixture_file")
encrypted_refresh=$(sed -n '2p' "$encrypted_fixture_file")
encrypted_successor=$(sed -n '3p' "$encrypted_fixture_file")
encrypted_recovery=$(sed -n '4p' "$encrypted_fixture_file")
test "$(wc -l <"$encrypted_fixture_file" | tr -d '[:space:]')" = "4" ||
  fail "could not generate encrypted session fixtures"
rm -f -- "$encrypted_fixture_file"
encrypted_fixture_file=""
for envelope in "$encrypted_access" "$encrypted_refresh" "$encrypted_successor" "$encrypted_recovery"; do
  [[ "$envelope" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] ||
    fail "generated session fixture is not an encrypted envelope"
done

apply_through "$SESSION_TOKEN_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-forward-to-session-tokens.log" 2>&1
query \
  "UPDATE \"WebSession\" SET \"remnashopAccessTokenEncrypted\" = '$encrypted_access', \"remnashopRefreshTokenEncrypted\" = '$encrypted_refresh', \"remnashopAccessExpiresAt\" = '2035-01-01T00:00:00Z', \"remnashopRefreshExpiresAt\" = '2035-02-01T00:00:00Z' WHERE id = 'fixture-session';" \
  >/dev/null

apply_through "$PAYMENT_RECORD_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-forward-to-payment-record-fixture.log" 2>&1
query \
  "INSERT INTO \"PaymentRecord\" (id, \"userId\", \"paymentId\", \"purchaseType\", status, \"finalAmount\", currency, \"gatewayType\", \"paymentUrl\", raw, \"createdAt\", \"updatedAt\") VALUES ('fixture-payment-record', 'fixture-user', 'fixture-provider-payment', 'PURCHASE', 'UNKNOWN', 10.00, 'RUB', 'YOOMONEY', 'https://rehearsal.invalid/payment', '{\"synthetic\":true}'::jsonb, '2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z');" \
  >/dev/null
apply_through "$PAYMENT_OPERATION_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-forward-to-payment-operation.log" 2>&1
query \
  "INSERT INTO \"PaymentOperation\" (id, \"userId\", kind, \"idempotencyKeyHash\", \"upstreamOwnerHash\", \"requestFingerprint\", \"requestPayload\", \"upstreamKey\", status, \"attemptCount\", \"dispatchedAt\", \"outcomeUnknownAt\", \"createdAt\", \"updatedAt\") VALUES ('fixture-payment-operation', 'fixture-user', 'PURCHASE', repeat('3', 64), repeat('4', 64), repeat('5', 64), '{\"synthetic\":true}'::jsonb, 'fixture-upstream-key', 'OUTCOME_UNKNOWN', 1, '2026-02-03T00:00:00Z', '2026-02-03T00:01:00Z', '2026-02-03T00:00:00Z', '2026-02-03T00:01:00Z'); UPDATE \"PaymentRecord\" SET \"operationId\" = 'fixture-payment-operation' WHERE id = 'fixture-payment-record';" \
  >/dev/null
apply_through "$PAYMENT_RECONCILIATION_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-forward-through-payment-reconciliation.log" 2>&1
test "$(query "SELECT count(*) FROM \"PaymentOperation\" WHERE id = 'fixture-payment-operation' AND status = 'OUTCOME_UNKNOWN' AND \"reconcileNextAttemptAt\" IS NOT NULL;")" = "1" ||
  fail "populated payment operation did not receive its reconciliation backfill"
test "$(query "SELECT count(*) FROM \"PaymentRecord\" WHERE id = 'fixture-payment-record' AND \"upstreamCreatedAt\" = \"createdAt\" AND \"upstreamUpdatedAt\" = \"updatedAt\";")" = "1" ||
  fail "populated payment record did not preserve upstream chronology"

apply_through "$REFRESH_ROTATION_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-forward-to-refresh-rotation.log" 2>&1
query \
  "INSERT INTO \"WebRefreshToken\" (id, \"sessionId\", \"tokenHash\", \"successorTokenEncrypted\", \"graceExpiresAt\", \"consumedAt\", \"createdAt\") VALUES ('fixture-refresh-token', 'fixture-session', repeat('6', 64), '$encrypted_successor', '2035-03-01T00:00:00Z', '2026-02-04T00:00:00Z', '2026-02-04T00:00:00Z');" \
  >/dev/null

apply_through "$OWNER_FENCE_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-forward-to-owner-fence.log" 2>&1
query \
  "UPDATE \"WebUser\" SET \"paymentOwnerChangeTokenHash\" = repeat('7', 64), \"paymentOwnerChangeLeaseExpiresAt\" = '2035-04-01T00:00:00Z', \"paymentOwnerChangeStartedAt\" = '2026-02-05T00:00:00Z', \"paymentOwnerChangeOperationHash\" = repeat('8', 64), \"paymentOwnerChangeExpectedOwnerHash\" = repeat('9', 64), \"paymentOwnerChangeAttemptCount\" = 1 WHERE id = 'fixture-user';" \
  >/dev/null

apply_through "$REFRESH_RECOVERY_REVISION" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-forward-to-refresh-recovery.log" 2>&1
query \
  "UPDATE \"WebSession\" SET \"remnashopRefreshClaimTokenHash\" = repeat('a', 64), \"remnashopRefreshLeaseExpiresAt\" = '2035-05-01T00:00:00Z', \"remnashopRefreshDispatchedAt\" = '2026-02-06T00:00:00Z', \"remnashopRefreshRecoveryEncrypted\" = '$encrypted_recovery', \"remnashopRefreshAttemptCount\" = 1 WHERE id = 'fixture-session';" \
  >/dev/null
pre_head_encrypted_state=$(encrypted_session_state)
[[ "$pre_head_encrypted_state" =~ ^1\|[a-f0-9]{32}$ ]] || fail "unexpected encrypted session fixture state"

apply_through "$CLEAN_PAY_HEAD" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-forward-to-head.log" 2>&1
test "$(revision)" = "$CLEAN_PAY_HEAD" || fail "Clean Pay chain did not reach head"
test "$(encrypted_session_state)" = "$pre_head_encrypted_state" ||
  fail "encrypted session/successor/recovery bundle changed before head"
test "$(query "SELECT count(*) FROM \"PaymentOperation\" WHERE id = 'fixture-payment-operation' AND \"userId\" = 'fixture-user' AND \"upstreamOwnerHash\" = repeat('4', 64);")" = "1" ||
  fail "payment ownership fixture changed before head"
test "$(query "SELECT count(*) FROM \"WebUser\" WHERE id = 'fixture-user' AND \"paymentOwnerChangeTokenHash\" = repeat('7', 64) AND \"paymentOwnerChangeOperationHash\" = repeat('8', 64) AND \"paymentOwnerChangeExpectedOwnerHash\" = repeat('9', 64) AND \"paymentOwnerChangeAttemptCount\" = 1;")" = "1" ||
  fail "owner-fencing fixture changed before head"

run_exact_migration_image "$DATABASE_NAME" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-no-op-head.log" 2>&1
grep -q "No pending migrations to apply" "$REHEARSAL_OUTPUT_DIR/clean-pay-no-op-head.log" ||
  fail "exact migration image did not report a no-op at head"
run_prisma "$DATABASE_NAME" "$CLEAN_PAY_HEAD" migrate status \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-migration-status.log" 2>&1
grep -q "Database schema is up to date" "$REHEARSAL_OUTPUT_DIR/clean-pay-migration-status.log" ||
  fail "Prisma migration status did not report the populated database at head"

docker exec "$POSTGRES_CONTAINER" createdb \
  --username "$DATABASE_USER" --template template0 --encoding UTF8 "$RESTORE_DATABASE_NAME"
docker exec "$POSTGRES_CONTAINER" pg_restore \
  --exit-on-error --no-owner --username "$DATABASE_USER" \
  --dbname "$RESTORE_DATABASE_NAME" /tmp/clean-pay-pre-session-rewrite.dump \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-restore-init.log" 2>&1
test "$(revision "$RESTORE_DATABASE_NAME")" = "$INITIAL_REVISION" ||
  fail "Clean Pay restore did not preserve the initial Prisma revision"
test "$(query_database "$RESTORE_DATABASE_NAME" "SELECT \"expiresAt\" FROM \"WebSession\" WHERE id = 'fixture-session';" | tr -d '[:space:]')" = "$legacy_expiry" ||
  fail "Clean Pay restore changed the legacy session fixture"
run_exact_migration_image "$RESTORE_DATABASE_NAME" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-restore-forward-to-head.log" 2>&1
test "$(revision "$RESTORE_DATABASE_NAME")" = "$CLEAN_PAY_HEAD" ||
  fail "exact migration image did not bring the restored database to head"
test "$(query_database "$RESTORE_DATABASE_NAME" "SELECT concat_ws('|', \"accessTokenExpiresAt\", \"refreshExpiresAt\") FROM \"WebSession\" WHERE id = 'fixture-session';" | tr -d '[:space:]')" = "$legacy_expiry|$legacy_expiry" ||
  fail "restored session expiry was not preserved through the exact migration image"

fixture_hash=${pre_head_encrypted_state#*|}
printf '{\n  "schemaVersion": 2,\n  "cleanPayRevision": "%s",\n  "migrationImage": "exact Dockerfile migration target",\n  "migrationHead": "%s",\n  "emptyDatabaseRevision": "%s",\n  "fixtureUsers": 1,\n  "fixtureSessions": 1,\n  "fixtureRefreshSuccessors": 1,\n  "fixturePaymentRecords": 1,\n  "fixturePaymentOperations": 1,\n  "encryptedFixtureHash": "%s",\n  "sessionRowLockFailureRevision": "%s",\n  "sessionRowLockTimeoutMilliseconds": %s,\n  "invalidTelegramFailureRevision": "%s",\n  "restoreSourceRevision": "%s",\n  "restoreTargetRevision": "%s",\n  "resumeRevision": "%s",\n  "noOpRevision": "%s",\n  "migrationStatus": "up-to-date"\n}\n' \
  "$CLEAN_PAY_REVISION" "$CLEAN_PAY_HEAD" "$CLEAN_PAY_HEAD" "$fixture_hash" "$INITIAL_REVISION" \
  "$session_lock_elapsed_ms" "$SESSION_REWRITE_REVISION" "$INITIAL_REVISION" "$CLEAN_PAY_HEAD" \
  "$CLEAN_PAY_HEAD" "$CLEAN_PAY_HEAD" \
  >"$REHEARSAL_OUTPUT_DIR/clean-pay-report.json"

printf 'Clean Pay populated migration rehearsal passed; report: %s/clean-pay-report.json\n' \
  "$REHEARSAL_OUTPUT_DIR"
