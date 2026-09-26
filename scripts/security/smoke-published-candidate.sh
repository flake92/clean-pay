#!/usr/bin/env bash
set -euo pipefail

TARGET=${1:-}
PLATFORM=${2:-}
IMAGE=${3:-}

if [[ ! "$TARGET" =~ ^(runner|migration)$ ]]; then
  printf 'usage: %s runner|migration linux/amd64|linux/arm64 IMAGE@sha256:DIGEST\n' "$0" >&2
  exit 2
fi
if [[ ! "$PLATFORM" =~ ^linux/(amd64|arm64)$ ]]; then
  printf 'unsupported candidate platform: %s\n' "$PLATFORM" >&2
  exit 2
fi
if [[ ! "$IMAGE" =~ @sha256:[a-f0-9]{64}$ ]]; then
  printf 'candidate image must use an immutable index digest\n' >&2
  exit 2
fi

TEMPORARY_DIR=$(mktemp -d "${RUNNER_TEMP:-/tmp}/clean-pay-candidate-smoke.XXXXXX")
SUFFIX="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${TARGET}-${PLATFORM##*/}-$$-${RANDOM}"
NETWORK="clean-pay-candidate-${SUFFIX}"
POSTGRES_CONTAINER="clean-pay-candidate-postgres-${SUFFIX}"
RUNTIME_CONTAINER="clean-pay-candidate-runtime-${SUFFIX}"
PROBE_CONTAINER="clean-pay-candidate-probe-${SUFFIX}"
METADATA_CONTAINER="clean-pay-candidate-metadata-${SUFFIX}"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if (( status != 0 )); then
    docker logs "$RUNTIME_CONTAINER" >&2 2>/dev/null || true
    docker logs "$POSTGRES_CONTAINER" >&2 2>/dev/null || true
  fi
  docker rm --force --volumes "$RUNTIME_CONTAINER" "$PROBE_CONTAINER" "$METADATA_CONTAINER" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -rf -- "$TEMPORARY_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

: "${CLEAN_PAY_FIXTURE_PUBLIC_APP_URL:?candidate smoke requires the expected public app URL}"
: "${CLEAN_PAY_FIXTURE_BRAND_NAME:?candidate smoke requires the expected brand name}"
: "${CLEAN_PAY_FIXTURE_BRAND_LOGO_URL:?candidate smoke requires the expected brand logo URL}"
: "${CLEAN_PAY_FIXTURE_TURNSTILE_SITE_KEY:?candidate smoke requires the expected Turnstile site key}"
: "${CLEAN_PAY_FIXTURE_RELEASE:?candidate smoke requires the expected release}"
: "${CLEAN_PAY_FIXTURE_REVISION:?candidate smoke requires the expected revision}"
: "${CLEAN_PAY_EXPECTED_PUBLIC_BUILD_CONTRACT_VERSION:?candidate smoke requires the contract version}"
: "${CLEAN_PAY_EXPECTED_PUBLIC_BUILD_CONTRACT_SHA256:?candidate smoke requires the contract SHA-256}"

computed_contract_version=$(node scripts/security/compute-public-build-contract.mjs --version)
test "$CLEAN_PAY_EXPECTED_PUBLIC_BUILD_CONTRACT_VERSION" = "$computed_contract_version" || {
  printf 'Candidate smoke public build contract version does not match the canonical helper.\n' >&2
  exit 1
}
[[ "$CLEAN_PAY_EXPECTED_PUBLIC_BUILD_CONTRACT_SHA256" =~ ^[a-f0-9]{64}$ ]]

computed_contract_sha256=$(
  NEXT_PUBLIC_APP_URL="$CLEAN_PAY_FIXTURE_PUBLIC_APP_URL" \
  TURNSTILE_ENABLED=true \
  TURNSTILE_SITE_KEY="$CLEAN_PAY_FIXTURE_TURNSTILE_SITE_KEY" \
  NEXT_PUBLIC_BRAND_NAME="$CLEAN_PAY_FIXTURE_BRAND_NAME" \
  NEXT_PUBLIC_BRAND_LOGO_URL="$CLEAN_PAY_FIXTURE_BRAND_LOGO_URL" \
    node scripts/security/compute-public-build-contract.mjs
)
test "$computed_contract_sha256" = "$CLEAN_PAY_EXPECTED_PUBLIC_BUILD_CONTRACT_SHA256" || {
  printf 'Candidate smoke public build contract does not match the requested public inputs.\n' >&2
  exit 1
}

docker create --name "$METADATA_CONTAINER" --platform "$PLATFORM" "$IMAGE" >/dev/null

inspect_candidate_label() {
  label=$1
  docker inspect --format "{{ index .Config.Labels \"${label}\" }}" "$METADATA_CONTAINER"
}

assert_candidate_label() {
  label=$1
  expected=$2
  observed=$(inspect_candidate_label "$label")
  test "$observed" = "$expected" || {
    printf 'Candidate %s label %s does not match the expected public build contract.\n' \
      "$TARGET" "$label" >&2
    exit 1
  }
}

assert_candidate_environment() {
  name=$1
  expected=$2
  observed=$(docker inspect --format '{{json .Config.Env}}' "$METADATA_CONTAINER" \
    | jq -er --arg name "$name" '
        [.[] | select(startswith($name + "=")) | ltrimstr($name + "=")]
        | if length == 1 then .[0] else error("missing or duplicate image environment value") end
      ')
  test "$observed" = "$expected" || {
    printf 'Candidate runner environment %s does not match the expected public build contract.\n' \
      "$name" >&2
    exit 1
  }
}

expected_role=migration
if [[ "$TARGET" == runner ]]; then
  expected_role=app
fi
assert_candidate_label org.opencontainers.image.revision "$CLEAN_PAY_FIXTURE_REVISION"
assert_candidate_label org.opencontainers.image.version "$CLEAN_PAY_FIXTURE_RELEASE"
assert_candidate_label io.clean-pay.release "$CLEAN_PAY_FIXTURE_RELEASE"
assert_candidate_label io.clean-pay.role "$expected_role"
assert_candidate_label io.clean-pay.public-build-contract-version \
  "$CLEAN_PAY_EXPECTED_PUBLIC_BUILD_CONTRACT_VERSION"
assert_candidate_label io.clean-pay.public-build-contract-sha256 \
  "$CLEAN_PAY_EXPECTED_PUBLIC_BUILD_CONTRACT_SHA256"

if [[ "$TARGET" == runner ]]; then
  assert_candidate_label io.clean-pay.baked-public-app-url "$CLEAN_PAY_FIXTURE_PUBLIC_APP_URL"
  assert_candidate_label io.clean-pay.baked-brand-name "$CLEAN_PAY_FIXTURE_BRAND_NAME"
  assert_candidate_label io.clean-pay.baked-brand-logo-url "$CLEAN_PAY_FIXTURE_BRAND_LOGO_URL"
  assert_candidate_label io.clean-pay.baked-turnstile-site-key \
    "$CLEAN_PAY_FIXTURE_TURNSTILE_SITE_KEY"
  assert_candidate_environment CLEAN_PAY_BAKED_PUBLIC_APP_URL \
    "$CLEAN_PAY_FIXTURE_PUBLIC_APP_URL"
  assert_candidate_environment CLEAN_PAY_BAKED_BRAND_NAME "$CLEAN_PAY_FIXTURE_BRAND_NAME"
  assert_candidate_environment CLEAN_PAY_BAKED_BRAND_LOGO_URL \
    "$CLEAN_PAY_FIXTURE_BRAND_LOGO_URL"
  assert_candidate_environment CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID \
    "$CLEAN_PAY_FIXTURE_TURNSTILE_SITE_KEY"
fi

docker rm "$METADATA_CONTAINER" >/dev/null

node tests/fixtures/write-synthetic-production-env.mjs "$TEMPORARY_DIR/.env"
node deploy/prod/role-env.mjs materialize "$TEMPORARY_DIR/.env"

assert_sandbox_metadata() {
  container=$1
  test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container")" = true
  docker inspect --format '{{json .HostConfig.CapDrop}}' "$container" | grep -q ALL
  docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$container" | grep -q no-new-privileges
}

assert_live_sandbox() {
  container=$1
  assert_sandbox_metadata "$container"
  docker exec "$container" sh -ceu '
    if touch /app/candidate-rootfs-write 2>/dev/null; then
      echo "read-only root filesystem accepted a write" >&2
      exit 1
    fi
    mkdir -p /tmp/candidate-mount
    if mount -t tmpfs tmpfs /tmp/candidate-mount 2>/dev/null; then
      echo "capability-dropped container unexpectedly mounted tmpfs" >&2
      umount /tmp/candidate-mount || true
      exit 1
    fi
    rmdir /tmp/candidate-mount
  '
}

run_negative_capability_probe() {
  docker run --name "$PROBE_CONTAINER" --platform "$PLATFORM" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --pids-limit 64 --memory 256m --cpus 0.5 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
    --entrypoint sh "$IMAGE" -ceu '
      mkdir -p /tmp/candidate-mount
      if mount -t tmpfs tmpfs /tmp/candidate-mount 2>/dev/null; then
        echo "capability-dropped container unexpectedly mounted tmpfs" >&2
        umount /tmp/candidate-mount || true
        exit 1
      fi
    '
  assert_sandbox_metadata "$PROBE_CONTAINER"
  test "$(docker inspect --format '{{.State.ExitCode}}' "$PROBE_CONTAINER")" = 0
  docker rm "$PROBE_CONTAINER" >/dev/null
}

if [[ "$TARGET" == runner ]]; then
  docker run --detach --name "$RUNTIME_CONTAINER" \
    --platform "$PLATFORM" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --pids-limit 256 --memory 1g --cpus 1 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --tmpfs /app/.next/cache:rw,noexec,nosuid,nodev,size=128m,mode=0700,uid=1001,gid=1001 \
    --publish 127.0.0.1::4000 \
    --env-file "$TEMPORARY_DIR/.env.app" \
    --env CLEAN_PAY_RUNTIME_ROLE=application \
    "$IMAGE" >/dev/null

  port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "4000/tcp") 0).HostPort}}' "$RUNTIME_CONTAINER")
  curl --fail --silent --show-error \
    --connect-timeout 2 --max-time 10 \
    --retry 60 --retry-delay 1 --retry-connrefused --retry-all-errors \
    "http://127.0.0.1:${port}/api/health/liveness" >/dev/null
  curl --fail --silent --show-error --connect-timeout 2 --max-time 10 \
    --output /dev/null \
    "http://127.0.0.1:${port}/_next/image?url=%2Fclean-pay-logo.png&w=64&q=75"
  assert_live_sandbox "$RUNTIME_CONTAINER"
  run_negative_capability_probe
  docker stop --time 30 "$RUNTIME_CONTAINER" >/dev/null
  test "$(docker inspect --format '{{.State.ExitCode}}' "$RUNTIME_CONTAINER")" = 0
  printf 'Exact %s runner candidate passed startup, image optimization, sandbox and graceful shutdown.\n' "$PLATFORM"
  exit 0
fi

docker network create "$NETWORK" >/dev/null
docker run --detach --name "$POSTGRES_CONTAINER" \
  --platform "$PLATFORM" \
  --network "$NETWORK" --network-alias postgres \
  --env-file "$TEMPORARY_DIR/.env.postgres" \
  --env 'POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale-provider=libc --lc-collate=C --lc-ctype=C.UTF-8' \
  postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73 \
  >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$POSTGRES_CONTAINER" pg_isready --host 127.0.0.1 -U clean_pay_bootstrap -d clean_pay >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$POSTGRES_CONTAINER" pg_isready --host 127.0.0.1 -U clean_pay_bootstrap -d clean_pay >/dev/null

run_role_provision() {
  mode=$1
  docker run --name "$RUNTIME_CONTAINER" --platform "$PLATFORM" \
    --network "$NETWORK" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --pids-limit 128 --memory 1g --cpus 1 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --env-file "$TEMPORARY_DIR/.env.provision" \
    --env CLEAN_PAY_DATABASE_MAINTENANCE_CONFIRMED=true \
    --entrypoint node \
    "$IMAGE" deploy/prod/database-role-provision.mjs "$mode"
  assert_sandbox_metadata "$RUNTIME_CONTAINER"
  test "$(docker inspect --format '{{.State.ExitCode}}' "$RUNTIME_CONTAINER")" = 0
  docker rm "$RUNTIME_CONTAINER" >/dev/null
}

run_migration() {
  docker run --name "$RUNTIME_CONTAINER" --platform "$PLATFORM" \
    --network "$NETWORK" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --pids-limit 128 --memory 1g --cpus 1 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --env-file "$TEMPORARY_DIR/.env.migration" \
    --env CLEAN_PAY_RUNTIME_ROLE=migration \
    "$IMAGE"
  assert_sandbox_metadata "$RUNTIME_CONTAINER"
  test "$(docker inspect --format '{{.State.ExitCode}}' "$RUNTIME_CONTAINER")" = 0
  docker rm "$RUNTIME_CONTAINER" >/dev/null
}

run_full_migration() {
  run_role_provision prepare
  run_migration
  run_role_provision sync
}

run_pre_guard_migrations() {
  docker run --name "$RUNTIME_CONTAINER" --platform "$PLATFORM" \
    --network "$NETWORK" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --pids-limit 128 --memory 1g --cpus 1 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --env-file "$TEMPORARY_DIR/.env.migration" \
    --env CLEAN_PAY_RUNTIME_ROLE=migration \
    --entrypoint sh "$IMAGE" -ceu '
      node /app/deploy/prod/validate-env.mjs
      partial=/tmp/clean-pay-pre-guard
      mkdir -p "$partial"
      cp -R /app/prisma "$partial/prisma"
      cp /app/prisma.config.ts "$partial/prisma.config.ts"
      ln -s /app/node_modules "$partial/node_modules"
      rm -rf "$partial/prisma/migrations/20260825230000_guard_retention_mutations"
      cd "$partial"
      node /app/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
    '
  assert_sandbox_metadata "$RUNTIME_CONTAINER"
  test "$(docker inspect --format '{{.State.ExitCode}}' "$RUNTIME_CONTAINER")" = 0
  docker rm "$RUNTIME_CONTAINER" >/dev/null
}

# First execution proves the exact candidate can migrate an empty database.
run_full_migration

# Recreate the database, stop exactly at the pre-guard head while preserving
# the retention-hold migration, and seed real application-owned rows. The
# candidate must apply the guard migration over existing Clean Pay data, not
# merely succeed on empty/head databases.
docker exec "$POSTGRES_CONTAINER" psql -U clean_pay_bootstrap -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE clean_pay WITH (FORCE);' \
  -c "CREATE DATABASE clean_pay WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C.UTF-8';" >/dev/null
run_role_provision prepare
run_pre_guard_migrations
test "$(docker exec "$POSTGRES_CONTAINER" psql -U clean_pay_bootstrap -d clean_pay -Atqc \
  "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '20260825220000_add_payment_retention_hold_lifecycle' AND finished_at IS NOT NULL AND rolled_back_at IS NULL")" = 1
test "$(docker exec "$POSTGRES_CONTAINER" psql -U clean_pay_bootstrap -d clean_pay -Atqc \
  "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '20260825230000_guard_retention_mutations'")" = 0
docker exec -i "$POSTGRES_CONTAINER" psql -U clean_pay_bootstrap -d clean_pay -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
INSERT INTO "WebUser" (
  "id", "emailVerified", "authPending", "paymentOwnerChangeAttemptCount",
  "createdAt", "updatedAt"
) VALUES (
  'candidate-user', TRUE, FALSE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
INSERT INTO "PaymentOperation" (
  "id", "userId", "kind", "idempotencyKeyHash", "requestFingerprint",
  "requestPayload", "upstreamKey", "status", "attemptCount",
  "reconcileAttemptCount", "reconcileFailureCount", "createdAt", "updatedAt"
) VALUES (
  'candidate-operation', 'candidate-user', 'PURCHASE',
  'candidate-idempotency-hash', 'candidate-request-fingerprint',
  '{"fixture":"published-candidate"}'::jsonb, 'candidate-upstream-key',
  'SUCCEEDED', 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
INSERT INTO "PaymentRecord" (
  "id", "userId", "paymentId", "purchaseType", "status", "finalAmount",
  "currency", "gatewayType", "isFree", "operationId", "upstreamCreatedAt",
  "upstreamUpdatedAt", "createdAt", "updatedAt"
) VALUES (
  'candidate-record', 'candidate-user', 'candidate-payment', 'NEW', 'COMPLETED',
  100.00, 'RUB', 'candidate', FALSE, 'candidate-operation',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
SQL

run_migration
run_role_provision sync
test "$(docker exec "$POSTGRES_CONTAINER" psql -U clean_pay_bootstrap -d clean_pay -Atqc \
  "SELECT count(*) FROM \"PaymentRecord\" WHERE \"id\" = 'candidate-record' AND \"operationId\" = 'candidate-operation'")" = 1
test "$(docker exec "$POSTGRES_CONTAINER" psql -U clean_pay_bootstrap -d clean_pay -Atqc \
  "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '20260825230000_guard_retention_mutations' AND finished_at IS NOT NULL AND rolled_back_at IS NULL")" = 1
ledger_count=$(docker exec "$POSTGRES_CONTAINER" psql -U clean_pay_bootstrap -d clean_pay -Atqc \
  'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
# A third execution is the populated no-op proof; no ledger row or app row may
# change merely because the exact candidate starts again at head.
run_full_migration
test "$(docker exec "$POSTGRES_CONTAINER" psql -U clean_pay_bootstrap -d clean_pay -Atqc \
  'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')" = "$ledger_count"
test "$(docker exec "$POSTGRES_CONTAINER" psql -U clean_pay_bootstrap -d clean_pay -Atqc \
  "SELECT count(*) FROM \"PaymentOperation\" WHERE \"id\" = 'candidate-operation'")" = 1
run_negative_capability_probe

printf 'Exact %s migration candidate passed empty, populated forward and no-op sandbox smoke.\n' "$PLATFORM"
