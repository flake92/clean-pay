#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
readonly ROOT_DIR
readonly COMPOSE_MANIFEST="$ROOT_DIR/deploy/prod/docker-compose.yml"
readonly ZERO_DOWNTIME_SCRIPT="$ROOT_DIR/deploy/prod/zero-downtime-app.sh"
readonly IMAGE_PREFLIGHT_SCRIPT="$ROOT_DIR/deploy/prod/image-preflight.sh"
readonly ROLE_ENV_SCRIPT="$ROOT_DIR/deploy/prod/role-env.mjs"
readonly SYNTHETIC_ENV_SCRIPT="$ROOT_DIR/tests/fixtures/write-synthetic-production-env.mjs"
readonly TRAFFIC_CONTINUITY_SCRIPT="$ROOT_DIR/scripts/security/disposable-traffic-continuity.mjs"
readonly READINESS_PROVIDER_SCRIPT="$ROOT_DIR/scripts/security/disposable-readiness-provider.mjs"
readonly REPORT_VALIDATOR_SCRIPT="$ROOT_DIR/scripts/security/disposable-image-rollback-report.mjs"
readonly OPERATION_LOCK_PATH="$ROOT_DIR/deploy/prod/.production-operation.lock"
readonly OUTPUT_DIR=${IMAGE_ROLLBACK_REHEARSAL_OUTPUT_DIR:-}
readonly REPORT_PATH="$OUTPUT_DIR/report.json"
readonly TRAFFIC_OUTPUT_DIR="$OUTPUT_DIR/traffic"
readonly TRAFFIC_RESULT_PATH="$TRAFFIC_OUTPUT_DIR/result.json"

fail() {
  printf '%s\n' "Disposable image rollback rehearsal failed: $*" >&2
  exit 1
}

if [[ $# -ne 4 ]]; then
  fail "expected TARGET_APP_IMAGE TARGET_MIGRATION_IMAGE PREVIOUS_REVISION RUN_SUFFIX"
fi

readonly TARGET_APP_REFERENCE=$1
readonly TARGET_MIGRATION_REFERENCE=$2
readonly PREVIOUS_REVISION=$3
readonly RUN_SUFFIX=$4

[[ "$TARGET_APP_REFERENCE" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$ ]] \
  || fail "target application image reference is invalid"
[[ "$TARGET_MIGRATION_REFERENCE" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$ ]] \
  || fail "target migration image reference is invalid"
[[ "$PREVIOUS_REVISION" =~ ^[a-f0-9]{40}$ ]] \
  || fail "previous source revision is invalid"
[[ "$RUN_SUFFIX" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] \
  || fail "run suffix is invalid"
[[ -n "$OUTPUT_DIR" && "$OUTPUT_DIR" = /* ]] \
  || fail "IMAGE_ROLLBACK_REHEARSAL_OUTPUT_DIR must be an absolute path"
[[ ! -e "$OUTPUT_DIR" && ! -L "$OUTPUT_DIR" ]] \
  || fail "the create-only output directory already exists"
OUTPUT_PARENT=$(dirname -- "$OUTPUT_DIR")
readonly OUTPUT_PARENT
[[ -d "$OUTPUT_PARENT" && ! -L "$OUTPUT_PARENT" ]] \
  || fail "the output parent must be an existing non-symlink directory"

for tool in docker node git tar sha256sum timeout awk cmp stat ln env id cp grep wc sed; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"
done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
[[ $(git -C "$ROOT_DIR" rev-parse --verify "$PREVIOUS_REVISION^{commit}") == "$PREVIOUS_REVISION" ]] \
  || fail "previous source revision is unavailable"
git -C "$ROOT_DIR" merge-base --is-ancestor "$PREVIOUS_REVISION" HEAD \
  || fail "previous source revision is not an ancestor of the candidate"
CANDIDATE_SOURCE_REVISION=$(git -C "$ROOT_DIR" rev-parse HEAD)
readonly CANDIDATE_SOURCE_REVISION
[[ "$CANDIDATE_SOURCE_REVISION" =~ ^[a-f0-9]{40}$ ]] \
  || fail "candidate source revision is invalid"
git -C "$ROOT_DIR" diff --quiet "$PREVIOUS_REVISION" HEAD -- \
  prisma \
  deploy/prod/role-env.mjs \
  deploy/prod/validate-env.mjs \
  deploy/prod/image-preflight.sh \
  deploy/prod/zero-downtime-env.mjs \
  tests/fixtures/write-synthetic-production-env.mjs \
  scripts/security/compute-public-build-contract.mjs \
  || fail "baseline and candidate runtime compatibility inputs differ"
[[ ! -e "$OPERATION_LOCK_PATH" && ! -L "$OPERATION_LOCK_PATH" ]] \
  || fail "the production operation lock is already present"

sha256_text() {
  printf '%s' "$1" | sha256sum | awk '{print $1}'
}

RUN_CONTRACT=$(sha256_text "$RUN_SUFFIX:$$:${RANDOM}")
readonly RUN_CONTRACT
readonly RESOURCE_SUFFIX=${RUN_CONTRACT:0:16}
readonly PROJECT_NAME="clean-pay-zdt-$RESOURCE_SUFFIX"
readonly EDGE_NETWORK="clean-pay-zdt-edge-$RESOURCE_SUFFIX"
readonly CANARY_NAME="clean-pay-zdt-canary-$RESOURCE_SUFFIX"
readonly CANARY_ALIAS="zdt-canary-$RESOURCE_SUFFIX"
readonly HOST_PORT=$((20000 + (16#${RESOURCE_SUFFIX:0:4} % 20000)))
readonly CANARY_PORT=$((HOST_PORT + 1))
readonly TRAFFIC_PROXY_PORT=4080
readonly READINESS_PROVIDER_PORT=4190
readonly PREVIOUS_APP_REFERENCE="clean-pay-zdt-previous-app:$RESOURCE_SUFFIX"
readonly PREVIOUS_MIGRATION_REFERENCE="clean-pay-zdt-previous-migration:$RESOURCE_SUFFIX"
readonly PREVIOUS_RELEASE="baseline-${PREVIOUS_REVISION:0:12}"
readonly TRAFFIC_CONTAINER_NAME="clean-pay-zdt-traffic-$RESOURCE_SUFFIX"
readonly READINESS_PROVIDER_CONTAINER_NAME="clean-pay-zdt-readiness-$RESOURCE_SUFFIX"
readonly READINESS_PROVIDER_ALIAS="zdt-readiness-$RESOURCE_SUFFIX"

TARGET_APP_IMAGE_ID=''
TARGET_MIGRATION_IMAGE_ID=''
PREVIOUS_APP_IMAGE_ID=''
PREVIOUS_MIGRATION_IMAGE_ID=''
TARGET_APP_EVIDENCE=null
TARGET_MIGRATION_EVIDENCE=null
PREVIOUS_APP_EVIDENCE=null
PREVIOUS_MIGRATION_EVIDENCE=null
PHASE=initialize
VERIFIED_IMAGE_STATE_COUNT=0
ENVIRONMENT_RESTORED=false
CANARY_REMOVED=false
CLEANUP_PROVEN=false
TRAFFIC_CONTINUITY_PROVEN=false
TRAFFIC_PROXY_USED=false
READINESS_PROVIDER_USED=false
READINESS_PROVIDER_CONTRACT_PROVEN=false
SYNTHETIC_PROVIDER_CREDENTIALS_USED=false
BASELINE_CONTEXT_ALLOWLIST_PROVEN=false
ROLLBACK_IMAGE_PREFLIGHT_PROVEN=false
VERIFIED_TRAFFIC_PHASE_COUNT=0
TRAFFIC_CONTAINER_ID=''
READINESS_PROVIDER_CONTAINER_ID=''

write_report() {
  local status=$1
  local cleanup_proven=$2
  local temporary="$OUTPUT_DIR/.report.tmp"
  case "$status:$cleanup_proven" in
    passed:true|failed:true|failed:false) ;;
    *) return 1 ;;
  esac
  if [[ "$status" == passed ]]; then
    [[ "$PHASE" == complete \
      && "$cleanup_proven" == true \
      && "$CLEANUP_PROVEN" == true \
      && "$ENVIRONMENT_RESTORED" == true \
      && "$CANARY_REMOVED" == true \
      && "$TRAFFIC_CONTINUITY_PROVEN" == true \
      && "$TRAFFIC_PROXY_USED" == true \
      && "$READINESS_PROVIDER_USED" == true \
      && "$READINESS_PROVIDER_CONTRACT_PROVEN" == true \
      && "$SYNTHETIC_PROVIDER_CREDENTIALS_USED" == true \
      && "$BASELINE_CONTEXT_ALLOWLIST_PROVEN" == true \
      && "$ROLLBACK_IMAGE_PREFLIGHT_PROVEN" == true \
      && "$VERIFIED_TRAFFIC_PHASE_COUNT" -eq 4 \
      && "$VERIFIED_IMAGE_STATE_COUNT" -eq 3 \
      && "$TARGET_APP_EVIDENCE" =~ ^\"sha256:[a-f0-9]{64}\"$ \
      && "$TARGET_MIGRATION_EVIDENCE" =~ ^\"sha256:[a-f0-9]{64}\"$ \
      && "$PREVIOUS_APP_EVIDENCE" =~ ^\"sha256:[a-f0-9]{64}\"$ \
      && "$PREVIOUS_MIGRATION_EVIDENCE" =~ ^\"sha256:[a-f0-9]{64}\"$ \
      && "$TARGET_APP_EVIDENCE" != "$TARGET_MIGRATION_EVIDENCE" \
      && "$TARGET_APP_EVIDENCE" != "$PREVIOUS_APP_EVIDENCE" \
      && "$TARGET_APP_EVIDENCE" != "$PREVIOUS_MIGRATION_EVIDENCE" \
      && "$TARGET_MIGRATION_EVIDENCE" != "$PREVIOUS_APP_EVIDENCE" \
      && "$TARGET_MIGRATION_EVIDENCE" != "$PREVIOUS_MIGRATION_EVIDENCE" \
      && "$PREVIOUS_APP_EVIDENCE" != "$PREVIOUS_MIGRATION_EVIDENCE" ]] \
      || return 1
  fi
  [[ ! -e "$REPORT_PATH" && ! -L "$REPORT_PATH" \
    && ! -e "$temporary" && ! -L "$temporary" ]] \
    || return 1
  if ! (
    set -C
    umask 077
    printf '%s\n' \
      '{' \
      '  "schemaVersion": "clean-pay.disposable-image-rollback.v3",' \
      "  \"status\": \"$status\"," \
      "  \"terminalPhase\": \"$PHASE\"," \
      "  \"cleanupProven\": $cleanup_proven," \
      "  \"authoritativeEnvironmentRestored\": $ENVIRONMENT_RESTORED," \
      "  \"canaryRemoved\": $CANARY_REMOVED," \
      "  \"trafficContinuityProven\": $TRAFFIC_CONTINUITY_PROVEN," \
      "  \"disposableTrafficProxyUsed\": $TRAFFIC_PROXY_USED," \
      "  \"syntheticReadinessProviderUsed\": $READINESS_PROVIDER_USED," \
      "  \"syntheticReadinessProviderContractProven\": $READINESS_PROVIDER_CONTRACT_PROVEN," \
      "  \"verifiedTrafficPhaseCount\": $VERIFIED_TRAFFIC_PHASE_COUNT," \
      '  "trafficPath": "owned-edge-network-aliases",' \
      '  "syntheticEnvironment": true,' \
      '  "productionDeploymentPerformed": false,' \
      '  "caddyMutationPerformed": false,' \
      '  "externalProviderCredentialsUsed": false,' \
      "  \"syntheticProviderCredentialsUsed\": $SYNTHETIC_PROVIDER_CREDENTIALS_USED," \
      "  \"baselineBuildContextAllowlistProven\": $BASELINE_CONTEXT_ALLOWLIST_PROVEN," \
      "  \"rollbackImagePreflightProven\": $ROLLBACK_IMAGE_PREFLIGHT_PROVEN," \
      "  \"previousSourceRevision\": \"$PREVIOUS_REVISION\"," \
      "  \"targetSourceRevision\": \"$CANDIDATE_SOURCE_REVISION\"," \
      "  \"verifiedImageStateCount\": $VERIFIED_IMAGE_STATE_COUNT," \
      "  \"projectContractSha256\": \"$(sha256_text "$PROJECT_NAME")\"," \
      '  "imageIdentityEvidence": {' \
      "    \"targetApplicationImageId\": $TARGET_APP_EVIDENCE," \
      "    \"targetMigrationImageId\": $TARGET_MIGRATION_EVIDENCE," \
      "    \"previousApplicationImageId\": $PREVIOUS_APP_EVIDENCE," \
      "    \"previousMigrationImageId\": $PREVIOUS_MIGRATION_EVIDENCE" \
      '  }' \
      '}' > "$temporary"
  ); then
    return 1
  fi
  if [[ ! -f "$temporary" || -L "$temporary" \
    || $(stat -c '%a' "$temporary") != 600 ]]; then
    return 1
  fi
  if ! node "$REPORT_VALIDATOR_SCRIPT" validate "$temporary"; then
    return 1
  fi
  if ! ln -- "$temporary" "$REPORT_PATH"; then
    return 1
  fi
}

bootstrap_on_exit() {
  local status=$?
  local bootstrap_cleanup_proven=true
  local temporary_dir=${TEMPORARY_DIR:-}
  trap - EXIT INT TERM
  set +e
  if [[ -n "$temporary_dir" ]]; then
    case "$temporary_dir" in
      "$TEMPORARY_PARENT"/clean-pay-image-rollback.*)
        if [[ -d "$temporary_dir" && ! -L "$temporary_dir" ]]; then
          rm -rf -- "$temporary_dir" || bootstrap_cleanup_proven=false
        else
          bootstrap_cleanup_proven=false
        fi
        ;;
      *) bootstrap_cleanup_proven=false ;;
    esac
  fi
  if [[ -d "$OUTPUT_DIR" && ! -L "$OUTPUT_DIR" \
    && ! -e "$REPORT_PATH" && ! -L "$REPORT_PATH" ]]; then
    write_report failed "$bootstrap_cleanup_proven" || {
      printf '%s\n' \
        "Disposable image rollback rehearsal could not create sanitized bootstrap evidence." \
        >&2
    }
  fi
  [[ $status -ne 0 ]] || status=1
  exit "$status"
}

trap bootstrap_on_exit EXIT
trap 'exit 130' INT TERM

umask 077
mkdir -- "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"

readonly TEMPORARY_PARENT=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
[[ -d "$TEMPORARY_PARENT" && ! -L "$TEMPORARY_PARENT" ]] \
  || fail "the temporary parent must be an existing non-symlink directory"
TEMPORARY_DIR=$(mktemp --directory "$TEMPORARY_PARENT/clean-pay-image-rollback.XXXXXX")
readonly TEMPORARY_DIR
chmod 700 "$TEMPORARY_DIR"
readonly TARGET_ENV_FILE="$TEMPORARY_DIR/target.env"
readonly ROLLBACK_ENV_FILE="$TEMPORARY_DIR/rollback.env"
readonly STATE_FILE="$TEMPORARY_DIR/state"
readonly PREVIOUS_SOURCE_DIR="$TEMPORARY_DIR/previous-source"
readonly PREVIOUS_INVENTORY_FILE="$TEMPORARY_DIR/previous-inventory"
readonly ROLLBACK_PREFLIGHT_OUTPUT="$TEMPORARY_DIR/rollback-images.env"
readonly TRAFFIC_STATE_DIR="$TEMPORARY_DIR/traffic-state"
readonly TRAFFIC_ROUTE_FILE="$TRAFFIC_STATE_DIR/route"
readonly TRAFFIC_READY_FILE="$TRAFFIC_STATE_DIR/ready.json"
readonly TRAFFIC_STATUS_FILE="$TRAFFIC_STATE_DIR/status.json"

mkdir -- "$TRAFFIC_STATE_DIR" "$TRAFFIC_OUTPUT_DIR"
chmod 700 "$TRAFFIC_STATE_DIR" "$TRAFFIC_OUTPUT_DIR"

image_id() {
  local reference=$1
  local value
  value=$(docker image inspect --format '{{.Id}}' "$reference") \
    || fail "a required local image could not be resolved"
  [[ "$value" =~ ^sha256:[a-f0-9]{64}$ ]] \
    || fail "a required local image resolved to an invalid immutable ID"
  printf '%s' "$value"
}

image_label() {
  local image=$1
  local label=$2
  local value
  value=$(docker image inspect --format "{{ index .Config.Labels \"$label\" }}" "$image") \
    || fail "a required image label could not be inspected"
  [[ -n "$value" && "$value" != '<no value>' && ! "$value" =~ [[:cntrl:]] ]] \
    || fail "a required image label is missing or invalid"
  printf '%s' "$value"
}

set_env_value() {
  local target=$1
  local name=$2
  local value=$3
  local temporary="$target.rewrite"
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || fail "environment assignment name is invalid"
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$ ]] \
    || fail "environment assignment value is invalid"
  [[ ! -e "$temporary" && ! -L "$temporary" ]] \
    || fail "environment rewrite target already exists"
  if ! awk -v assignment_name="$name" -v assignment_value="$value" '
      BEGIN { matches = 0 }
      index($0, assignment_name "=") == 1 {
        print assignment_name "=" assignment_value
        matches += 1
        next
      }
      { print }
      END { if (matches != 1) exit 42 }
    ' "$target" > "$temporary"; then
    rm -f -- "$temporary"
    fail "authoritative synthetic environment rewrite failed"
  fi
  chmod 600 "$temporary"
  mv -- "$temporary" "$target"
}

compose_for_env() (
  env_file=$1
  shift
  unset \
    CLEAN_PAY_APP_ENV_FILE \
    CLEAN_PAY_BIND \
    CLEAN_PAY_EDGE_NETWORK \
    CLEAN_PAY_HOLD_OPERATOR_ENV_FILE \
    CLEAN_PAY_IMAGE \
    CLEAN_PAY_MIGRATION_ENV_FILE \
    CLEAN_PAY_MIGRATION_IMAGE \
    CLEAN_PAY_PORT \
    CLEAN_PAY_POSTGRES_ENV_FILE \
    CLEAN_PAY_PROVISION_ENV_FILE \
    CLEAN_PAY_RECONCILIATION_ENV_FILE \
    CLEAN_PAY_RELEASE \
    CLEAN_PAY_RETENTION_ENV_FILE \
    CLEAN_PAY_REVISION \
    COMPOSE_ENV_FILES \
    COMPOSE_FILE \
    COMPOSE_PROFILES \
    COMPOSE_PROJECT_NAME \
    NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_BRAND_LOGO_URL \
    NEXT_PUBLIC_BRAND_NAME \
    TURNSTILE_ENABLED \
    TURNSTILE_SITE_KEY
  export CLEAN_PAY_APP_ENV_FILE="$env_file.app"
  export CLEAN_PAY_HOLD_OPERATOR_ENV_FILE="$env_file.hold-operator"
  export CLEAN_PAY_MIGRATION_ENV_FILE="$env_file.migration"
  export CLEAN_PAY_POSTGRES_ENV_FILE="$env_file.postgres"
  export CLEAN_PAY_PROVISION_ENV_FILE="$env_file.provision"
  export CLEAN_PAY_RECONCILIATION_ENV_FILE="$env_file.reconciliation"
  export CLEAN_PAY_RETENTION_ENV_FILE="$env_file.retention"
  timeout --signal=TERM --kill-after=20s 600s \
    docker compose --project-name "$PROJECT_NAME" \
      --env-file "$env_file" -f "$COMPOSE_MANIFEST" "$@"
)

assert_compose_service_image() {
  local env_file=$1
  local service=$2
  local expected=$3
  local container_id
  local observed
  container_id=$(compose_for_env "$env_file" ps -q "$service") \
    || fail "owned Compose service could not be inspected"
  [[ "$container_id" =~ ^[a-f0-9]{64}$ ]] \
    || fail "owned Compose service did not resolve to exactly one container"
  observed=$(docker inspect --format '{{.Image}}' "$container_id") \
    || fail "owned Compose service image could not be inspected"
  [[ "$observed" == "$expected" ]] \
    || fail "owned Compose service is running the wrong immutable image"
  [[ $(docker inspect --format '{{.State.Health.Status}}' "$container_id") == healthy ]] \
    || fail "owned Compose service is not healthy"
}

assert_compose_stack_image() {
  local env_file=$1
  local expected=$2
  assert_compose_service_image "$env_file" app "$expected"
  assert_compose_service_image "$env_file" retention-worker "$expected"
}

assert_canary_image() {
  local expected=$1
  [[ $(docker inspect --format '{{ index .Config.Labels "io.clean-pay.zero-downtime.owner" }}' "$CANARY_NAME") == clean-pay-zdt-v1 ]] \
    || fail "canary owner label differs from the exact zero-downtime contract"
  [[ $(docker inspect --format '{{ index .Config.Labels "io.clean-pay.zero-downtime.project" }}' "$CANARY_NAME") == "$PROJECT_NAME" ]] \
    || fail "canary project label differs from the exact disposable project"
  [[ $(docker inspect --format '{{ index .Config.Labels "io.clean-pay.zero-downtime.alias" }}' "$CANARY_NAME") == "$CANARY_ALIAS" ]] \
    || fail "canary alias label differs from the exact disposable alias"
  [[ $(docker inspect --format '{{.Image}}' "$CANARY_NAME") == "$expected" ]] \
    || fail "canary is running the wrong immutable image"
  [[ $(docker inspect --format '{{.State.Running}}' "$CANARY_NAME") == true ]] \
    || fail "canary is not running after its bounded readiness gate"
}

assert_canary_absent() {
  local container_id
  container_id=$(docker ps --all --quiet --no-trunc \
    --filter "name=^/${CANARY_NAME}$") \
    || fail "canary absence could not be proven"
  [[ -z "$container_id" ]] || fail "canary remained after exact removal"
}

run_zero_downtime() {
  timeout --signal=TERM --kill-after=20s 600s \
    env \
      CLEAN_PAY_ZDT_ENV_FILE="$TARGET_ENV_FILE" \
      CLEAN_PAY_ZDT_ROLLBACK_ENV_FILE="$ROLLBACK_ENV_FILE" \
      CLEAN_PAY_ZDT_STATE_FILE="$STATE_FILE" \
      CLEAN_PAY_ZDT_CANARY_NAME="$CANARY_NAME" \
      CLEAN_PAY_ZDT_CANARY_ALIAS="$CANARY_ALIAS" \
      CLEAN_PAY_ZDT_CANARY_PORT="$CANARY_PORT" \
      sh "$ZERO_DOWNTIME_SCRIPT" "$@"
}

switch_traffic_route() {
  local route=$1
  assert_auxiliary_container \
    "$TRAFFIC_CONTAINER_ID" "$TRAFFIC_CONTAINER_NAME" traffic-proxy "$EDGE_NETWORK"
  env -i PATH="$PATH" node "$TRAFFIC_CONTINUITY_SCRIPT" switch \
    "$TRAFFIC_ROUTE_FILE" "$TRAFFIC_STATUS_FILE" "$route"
  assert_auxiliary_container \
    "$TRAFFIC_CONTAINER_ID" "$TRAFFIC_CONTAINER_NAME" traffic-proxy "$EDGE_NETWORK"
}

assert_auxiliary_container() {
  local container_id=$1
  local container_name=$2
  local role=$3
  local network=$4
  local observed
  [[ "$container_id" =~ ^[a-f0-9]{64}$ ]] \
    || fail "owned auxiliary container ID is invalid"
  observed=$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{.Image}}|{{ index .Config.Labels "io.clean-pay.image-rollback.owner" }}|{{ index .Config.Labels "io.clean-pay.image-rollback.project" }}|{{ index .Config.Labels "io.clean-pay.image-rollback.role" }}|{{.State.Running}}' \
    "$container_id") || fail "owned auxiliary container could not be inspected"
  [[ "$observed" == "$container_id|/$container_name|$TARGET_APP_IMAGE_ID|clean-pay-image-rollback-v1|$PROJECT_NAME|$role|true" ]] \
    || fail "owned auxiliary container identity differs"
  [[ $(docker inspect --format \
    "{{if index .NetworkSettings.Networks \"$network\"}}present{{end}}" \
    "$container_id") == present ]] \
    || fail "owned auxiliary container network differs"
}

cleanup_auxiliary_container() {
  local container_name=$1
  local expected_id=$2
  local role=$3
  local container_id
  local observed
  if ! container_id=$(docker ps --all --quiet --no-trunc \
    --filter "name=^/${container_name}$"); then
    return 1
  fi
  if [[ -z "$container_id" ]]; then
    return 0
  fi
  [[ "$container_id" =~ ^[a-f0-9]{64}$ \
    && "$TARGET_APP_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  [[ -z "$expected_id" || "$container_id" == "$expected_id" ]] || return 1
  observed=$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{.Image}}|{{ index .Config.Labels "io.clean-pay.image-rollback.owner" }}|{{ index .Config.Labels "io.clean-pay.image-rollback.project" }}|{{ index .Config.Labels "io.clean-pay.image-rollback.role" }}' \
    "$container_id" 2>/dev/null) || return 1
  [[ "$observed" == "$container_id|/$container_name|$TARGET_APP_IMAGE_ID|clean-pay-image-rollback-v1|$PROJECT_NAME|$role" ]] \
    || return 1
  [[ $(docker inspect --format \
    "{{if index .NetworkSettings.Networks \"$EDGE_NETWORK\"}}present{{end}}" \
    "$container_id" 2>/dev/null) == present ]] || return 1
  docker rm --force --volumes "$container_id" >/dev/null || return 1
  [[ -z $(docker ps --all --quiet --no-trunc \
    --filter "name=^/${container_name}$") ]]
}

start_readiness_provider() {
  local attempt
  local operator_identity
  local service_key_sha256
  [[ -z $(docker ps --all --quiet --no-trunc \
    --filter "name=^/${READINESS_PROVIDER_CONTAINER_NAME}$") ]] \
    || fail "disposable readiness provider name is already in use"
  service_key_sha256=$(node -e '
    const {createHash}=require("node:crypto");
    const fs=require("node:fs");
    const lines=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/);
    const matches=lines.filter((line)=>line.startsWith("REMNASHOP_AUTH_SERVICE_KEY="));
    if(matches.length!==1)throw new Error("synthetic service key contract is invalid");
    const value=matches[0].slice("REMNASHOP_AUTH_SERVICE_KEY=".length);
    if(value.length<16||value.length>512||/[\r\n\0]/.test(value))throw new Error("synthetic service key contract is invalid");
    process.stdout.write(createHash("sha256").update(value).digest("hex"));
  ' "$TARGET_ENV_FILE") || fail "synthetic service key hash could not be derived"
  [[ "$service_key_sha256" =~ ^[a-f0-9]{64}$ ]] \
    || fail "synthetic service key hash is invalid"
  operator_identity="$(id -u):$(id -g)"
  READINESS_PROVIDER_CONTAINER_ID=$(docker run --detach --pull never \
    --name "$READINESS_PROVIDER_CONTAINER_NAME" \
    --label io.clean-pay.image-rollback.owner=clean-pay-image-rollback-v1 \
    --label "io.clean-pay.image-rollback.project=$PROJECT_NAME" \
    --label io.clean-pay.image-rollback.role=readiness-provider \
    --network "$EDGE_NETWORK" \
    --network-alias "$READINESS_PROVIDER_ALIAS" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 128m \
    --cpus 0.25 \
    --user "$operator_identity" \
    --mount "type=bind,src=$READINESS_PROVIDER_SCRIPT,dst=/proof/disposable-readiness-provider.mjs,readonly" \
    --env "CLEAN_PAY_SYNTHETIC_PROVIDER_KEY_SHA256=$service_key_sha256" \
    --entrypoint node \
    "$TARGET_APP_IMAGE_ID" \
    /proof/disposable-readiness-provider.mjs "$READINESS_PROVIDER_PORT") \
    || fail "disposable readiness provider container could not start"
  assert_auxiliary_container \
    "$READINESS_PROVIDER_CONTAINER_ID" "$READINESS_PROVIDER_CONTAINER_NAME" \
    readiness-provider "$EDGE_NETWORK"
  for ((attempt = 0; attempt < 200; attempt += 1)); do
    if docker exec "$READINESS_PROVIDER_CONTAINER_ID" node -e '
      fetch(`http://127.0.0.1:${process.argv[1]}/healthz`,{signal:AbortSignal.timeout(1000)})
        .then(async(response)=>{
          const text=await response.text();
          if(response.status!==200||response.headers.get("content-type")!=="application/json"||text!=="{\"status\":\"ok\"}\n")process.exit(1);
        }).catch(()=>process.exit(1));
    ' "$READINESS_PROVIDER_PORT" >/dev/null 2>&1; then
      READINESS_PROVIDER_USED=true
      return
    fi
    assert_auxiliary_container \
      "$READINESS_PROVIDER_CONTAINER_ID" "$READINESS_PROVIDER_CONTAINER_NAME" \
      readiness-provider "$EDGE_NETWORK"
    sleep 0.1
  done
  fail "disposable readiness provider timed out"
}

prove_readiness_provider_contract() {
  assert_auxiliary_container \
    "$READINESS_PROVIDER_CONTAINER_ID" "$READINESS_PROVIDER_CONTAINER_NAME" \
    readiness-provider "$EDGE_NETWORK"
  docker exec "$READINESS_PROVIDER_CONTAINER_ID" node -e '
    fetch(`http://127.0.0.1:${process.argv[1]}/contract`,{signal:AbortSignal.timeout(5000)})
      .then(async(response)=>{
        if(response.status!==200||response.headers.get("content-type")!=="application/json")process.exit(1);
        const text=await response.text();
        if(Buffer.byteLength(text)>1024)process.exit(1);
        const value=JSON.parse(text);
        const keys=["emailStart","identify","notificationPreferences","plans","serviceSession"];
        if(!value||typeof value!=="object"||Array.isArray(value)
          ||JSON.stringify(Object.keys(value).sort())!==JSON.stringify(keys)
          ||keys.some((key)=>!Number.isSafeInteger(value[key])||value[key]<3||value[key]>1000))process.exit(1);
      }).catch(()=>process.exit(1));
  ' "$READINESS_PROVIDER_PORT" >/dev/null \
    || fail "synthetic readiness provider contract was not exercised"
  READINESS_PROVIDER_CONTRACT_PROVEN=true
  SYNTHETIC_PROVIDER_CREDENTIALS_USED=true
}

stop_readiness_provider() {
  local exit_code
  assert_auxiliary_container \
    "$READINESS_PROVIDER_CONTAINER_ID" "$READINESS_PROVIDER_CONTAINER_NAME" \
    readiness-provider "$EDGE_NETWORK"
  docker stop --time 10 "$READINESS_PROVIDER_CONTAINER_ID" >/dev/null \
    || fail "disposable readiness provider did not stop within its bound"
  exit_code=$(docker inspect --format '{{.State.ExitCode}}' \
    "$READINESS_PROVIDER_CONTAINER_ID") \
    || fail "disposable readiness provider exit status is unavailable"
  [[ "$exit_code" == 0 ]] || fail "disposable readiness provider exited unsuccessfully"
  cleanup_auxiliary_container \
    "$READINESS_PROVIDER_CONTAINER_NAME" "$READINESS_PROVIDER_CONTAINER_ID" \
    readiness-provider \
    || fail "disposable readiness provider could not be removed exactly"
  READINESS_PROVIDER_CONTAINER_ID=''
}

start_traffic_continuity() {
  local attempt
  local operator_identity
  [[ -z $(docker ps --all --quiet --no-trunc \
    --filter "name=^/${TRAFFIC_CONTAINER_NAME}$") ]] \
    || fail "disposable traffic proxy name is already in use"
  env -i PATH="$PATH" node "$TRAFFIC_CONTINUITY_SCRIPT" \
    initialize "$TRAFFIC_ROUTE_FILE" primary
  operator_identity="$(id -u):$(id -g)"
  TRAFFIC_CONTAINER_ID=$(docker run --detach --pull never \
    --name "$TRAFFIC_CONTAINER_NAME" \
    --label io.clean-pay.image-rollback.owner=clean-pay-image-rollback-v1 \
    --label "io.clean-pay.image-rollback.project=$PROJECT_NAME" \
    --label io.clean-pay.image-rollback.role=traffic-proxy \
    --network "$EDGE_NETWORK" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --pids-limit 64 \
    --memory 128m \
    --cpus 0.25 \
    --user "$operator_identity" \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=8m,mode=1777 \
    --mount "type=bind,src=$TRAFFIC_CONTINUITY_SCRIPT,dst=/proof/disposable-traffic-continuity.mjs,readonly" \
    --mount "type=bind,src=$TRAFFIC_STATE_DIR,dst=/proof/state" \
    --mount "type=bind,src=$TRAFFIC_OUTPUT_DIR,dst=/proof/output" \
    --entrypoint node \
    "$TARGET_APP_IMAGE_ID" \
    /proof/disposable-traffic-continuity.mjs serve \
    /proof/state/route \
    /proof/state/ready.json \
    /proof/state/status.json \
    /proof/output/result.json \
    0.0.0.0 "$TRAFFIC_PROXY_PORT" \
    clean-pay 4000 "$CANARY_ALIAS" 4000) \
    || fail "disposable traffic proxy container could not start"
  assert_auxiliary_container \
    "$TRAFFIC_CONTAINER_ID" "$TRAFFIC_CONTAINER_NAME" traffic-proxy "$EDGE_NETWORK"
  for ((attempt = 0; attempt < 200; attempt += 1)); do
    if [[ -f "$TRAFFIC_READY_FILE" && ! -L "$TRAFFIC_READY_FILE" ]]; then
      break
    fi
    assert_auxiliary_container \
      "$TRAFFIC_CONTAINER_ID" "$TRAFFIC_CONTAINER_NAME" traffic-proxy "$EDGE_NETWORK"
    sleep 0.1
  done
  [[ -f "$TRAFFIC_READY_FILE" && ! -L "$TRAFFIC_READY_FILE" ]] \
    || fail "disposable traffic proxy readiness timed out"
  env -i PATH="$PATH" node -e \
    'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(value.schemaVersion!==1||value.status!=="ready"||Object.keys(value).length!==2)process.exit(1)' \
    "$TRAFFIC_READY_FILE" \
    || fail "disposable traffic proxy readiness evidence is invalid"
  TRAFFIC_PROXY_USED=true
  switch_traffic_route primary
}

traffic_phase_checkpoint() {
  local phase=$1
  local side=$2
  local route=$3
  case "$phase:$side:$route" in
    stage:before:primary|stage:after:primary|promote:before:canary|promote:after:canary|rollback:before:canary|rollback:after:canary|remove:before:primary|remove:after:primary) ;;
    *) fail "disposable traffic phase checkpoint is invalid" ;;
  esac
  env -i PATH="$PATH" node "$TRAFFIC_CONTINUITY_SCRIPT" checkpoint \
    "$TRAFFIC_STATUS_FILE" "$route" "$TRAFFIC_STATE_DIR/$phase-$side.json"
}

begin_traffic_phase() {
  local phase=$1
  local route=$2
  switch_traffic_route "$route"
  traffic_phase_checkpoint "$phase" before "$route"
}

end_traffic_phase() {
  local phase=$1
  local route=$2
  switch_traffic_route "$route"
  traffic_phase_checkpoint "$phase" after "$route"
  env -i PATH="$PATH" node "$TRAFFIC_CONTINUITY_SCRIPT" prove-progress \
    "$TRAFFIC_STATE_DIR/$phase-before.json" \
    "$TRAFFIC_STATE_DIR/$phase-after.json" \
    "$route"
  VERIFIED_TRAFFIC_PHASE_COUNT=$((VERIFIED_TRAFFIC_PHASE_COUNT + 1))
}

stop_traffic_continuity() {
  local exit_code
  assert_auxiliary_container \
    "$TRAFFIC_CONTAINER_ID" "$TRAFFIC_CONTAINER_NAME" traffic-proxy "$EDGE_NETWORK"
  docker stop --time 10 "$TRAFFIC_CONTAINER_ID" >/dev/null \
    || fail "disposable traffic proxy did not stop within its bound"
  exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$TRAFFIC_CONTAINER_ID") \
    || fail "disposable traffic proxy exit status is unavailable"
  [[ "$exit_code" == 0 ]] || fail "disposable traffic proxy exited unsuccessfully"
  env -i PATH="$PATH" node "$TRAFFIC_CONTINUITY_SCRIPT" verify "$TRAFFIC_RESULT_PATH" \
    || fail "continuous primary/canary traffic was not proven"
  cleanup_auxiliary_container \
    "$TRAFFIC_CONTAINER_NAME" "$TRAFFIC_CONTAINER_ID" traffic-proxy \
    || fail "disposable traffic proxy could not be removed exactly"
  TRAFFIC_CONTAINER_ID=''
  TRAFFIC_CONTINUITY_PROVEN=true
}

cleanup_canary() {
  local container_id
  if ! container_id=$(docker ps --all --quiet --no-trunc \
    --filter "name=^/${CANARY_NAME}$"); then
    return 1
  fi
  if [[ -z "$container_id" ]]; then
    return 0
  fi
  [[ "$container_id" =~ ^[a-f0-9]{64}$ ]] || return 1
  [[ $(docker inspect --format '{{ index .Config.Labels "io.clean-pay.zero-downtime.owner" }}' "$container_id" 2>/dev/null) == clean-pay-zdt-v1 ]] \
    || return 1
  [[ $(docker inspect --format '{{ index .Config.Labels "io.clean-pay.zero-downtime.project" }}' "$container_id" 2>/dev/null) == "$PROJECT_NAME" ]] \
    || return 1
  [[ $(docker inspect --format '{{ index .Config.Labels "io.clean-pay.zero-downtime.alias" }}' "$container_id" 2>/dev/null) == "$CANARY_ALIAS" ]] \
    || return 1
  docker rm --force --volumes "$container_id" >/dev/null
}

cleanup_previous_image() {
  local reference=$1
  local expected_id=$2
  local expected_role=$3
  local listed_id
  local observed
  if ! listed_id=$(docker image ls --quiet --no-trunc "$reference"); then
    return 1
  fi
  if [[ -z "$listed_id" ]]; then
    return 0
  fi
  [[ "$listed_id" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  [[ -z "$expected_id" || "$listed_id" == "$expected_id" ]] || return 1
  observed=$(docker image inspect --format \
    '{{.Id}}|{{ index .Config.Labels "io.clean-pay.image-rollback.owner" }}|{{ index .Config.Labels "io.clean-pay.image-rollback.project" }}|{{ index .Config.Labels "io.clean-pay.image-rollback.role" }}' \
    "$reference" 2>/dev/null) || return 1
  [[ "$observed" == "$listed_id|clean-pay-image-rollback-v1|$PROJECT_NAME|$expected_role" ]] \
    || return 1
  docker image rm "$reference" >/dev/null
}

cleanup_owned_resources() {
  local status=0
  local cleanup_env=$TARGET_ENV_FILE
  local remaining
  local edge_network_id
  cleanup_auxiliary_container \
    "$TRAFFIC_CONTAINER_NAME" "$TRAFFIC_CONTAINER_ID" traffic-proxy || status=1
  TRAFFIC_CONTAINER_ID=''
  cleanup_auxiliary_container \
    "$READINESS_PROVIDER_CONTAINER_NAME" "$READINESS_PROVIDER_CONTAINER_ID" \
    readiness-provider || status=1
  READINESS_PROVIDER_CONTAINER_ID=''
  cleanup_canary || status=1

  if [[ ! -f "$TARGET_ENV_FILE.app" && -f "$ROLLBACK_ENV_FILE.app" ]]; then
    cleanup_env=$ROLLBACK_ENV_FILE
  fi
  if [[ -f "$cleanup_env" && ! -L "$cleanup_env" ]]; then
    compose_for_env "$cleanup_env" down --remove-orphans --volumes --timeout 120 \
      >/dev/null 2>&1 || status=1
  fi

  if ! remaining=$(docker ps --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME"); then
    status=1
  elif [[ -n "$remaining" ]]; then
    status=1
  fi
  if ! remaining=$(docker ps --all --quiet --no-trunc \
    --filter "label=io.clean-pay.image-rollback.owner=clean-pay-image-rollback-v1" \
    --filter "label=io.clean-pay.image-rollback.project=$PROJECT_NAME"); then
    status=1
  elif [[ -n "$remaining" ]]; then
    status=1
  fi
  if ! remaining=$(docker volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME"); then
    status=1
  elif [[ -n "$remaining" ]]; then
    status=1
  fi
  if ! remaining=$(docker network ls --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME"); then
    status=1
  elif [[ -n "$remaining" ]]; then
    status=1
  fi

  if ! edge_network_id=$(docker network ls --quiet --no-trunc \
    --filter "name=^${EDGE_NETWORK}$"); then
    status=1
  elif [[ -n "$edge_network_id" ]]; then
    if [[ ! "$edge_network_id" =~ ^[a-f0-9]{64}$ ]] \
      || [[ $(docker network inspect --format '{{.Name}}' "$edge_network_id" 2>/dev/null) != "$EDGE_NETWORK" ]] \
      || [[ $(docker network inspect --format '{{ index .Labels "io.clean-pay.image-rollback.owner" }}' "$edge_network_id" 2>/dev/null) != clean-pay-image-rollback-v1 ]] \
      || [[ $(docker network inspect --format '{{ index .Labels "io.clean-pay.image-rollback.project" }}' "$edge_network_id" 2>/dev/null) != "$PROJECT_NAME" ]]; then
      status=1
    else
      docker network rm "$edge_network_id" >/dev/null || status=1
    fi
  fi

  cleanup_previous_image \
    "$PREVIOUS_APP_REFERENCE" "$PREVIOUS_APP_IMAGE_ID" previous-app || status=1
  cleanup_previous_image \
    "$PREVIOUS_MIGRATION_REFERENCE" "$PREVIOUS_MIGRATION_IMAGE_ID" previous-migration \
      || status=1
  [[ ! -e "$OPERATION_LOCK_PATH" && ! -L "$OPERATION_LOCK_PATH" ]] || status=1

  if [[ $status -eq 0 && -d "$TEMPORARY_DIR" && ! -L "$TEMPORARY_DIR" ]]; then
    case "$TEMPORARY_DIR" in
      "$TEMPORARY_PARENT"/clean-pay-image-rollback.*)
        rm -rf -- "$TEMPORARY_DIR"
        ;;
      *) status=1 ;;
    esac
  fi
  return "$status"
}

on_exit() {
  local status=$?
  local cleanup_status=0
  local report_status=failed
  trap - EXIT INT TERM
  set +e
  if [[ "$CLEANUP_PROVEN" != true ]]; then
    if cleanup_owned_resources; then
      CLEANUP_PROVEN=true
    else
      cleanup_status=$?
    fi
  fi
  if [[ $status -eq 0 && $cleanup_status -ne 0 ]]; then
    status=1
  fi
  if [[ $status -eq 0 ]]; then
    report_status=passed
  fi
  if [[ ! -e "$REPORT_PATH" && ! -L "$REPORT_PATH" ]]; then
    write_report "$report_status" "$CLEANUP_PROVEN" || {
      printf '%s\n' "Disposable image rollback rehearsal could not create sanitized evidence." >&2
      [[ $status -ne 0 ]] || status=1
    }
  fi
  exit "$status"
}

trap on_exit EXIT
trap 'exit 130' INT TERM

PHASE=inspect-target-images
TARGET_APP_IMAGE_ID=$(image_id "$TARGET_APP_REFERENCE")
TARGET_MIGRATION_IMAGE_ID=$(image_id "$TARGET_MIGRATION_REFERENCE")
[[ "$TARGET_APP_IMAGE_ID" != "$TARGET_MIGRATION_IMAGE_ID" ]] \
  || fail "target application and migration images must be distinct"
[[ $(image_label "$TARGET_APP_IMAGE_ID" io.clean-pay.role) == app ]] \
  || fail "target application image role is invalid"
[[ $(image_label "$TARGET_MIGRATION_IMAGE_ID" io.clean-pay.role) == migration ]] \
  || fail "target migration image role is invalid"

TARGET_RELEASE=$(image_label "$TARGET_APP_IMAGE_ID" org.opencontainers.image.version)
TARGET_REVISION=$(image_label "$TARGET_APP_IMAGE_ID" org.opencontainers.image.revision)
PUBLIC_CONTRACT_VERSION=$(
  image_label "$TARGET_APP_IMAGE_ID" io.clean-pay.public-build-contract-version
)
PUBLIC_CONTRACT_SHA256=$(
  image_label "$TARGET_APP_IMAGE_ID" io.clean-pay.public-build-contract-sha256
)
PUBLIC_APP_URL=$(image_label "$TARGET_APP_IMAGE_ID" io.clean-pay.baked-public-app-url)
PUBLIC_BRAND_NAME=$(image_label "$TARGET_APP_IMAGE_ID" io.clean-pay.baked-brand-name)
PUBLIC_BRAND_LOGO_URL=$(
  image_label "$TARGET_APP_IMAGE_ID" io.clean-pay.baked-brand-logo-url
)
PUBLIC_TURNSTILE_SITE_KEY=$(
  image_label "$TARGET_APP_IMAGE_ID" io.clean-pay.baked-turnstile-site-key
)
readonly \
  TARGET_RELEASE \
  TARGET_REVISION \
  PUBLIC_CONTRACT_VERSION \
  PUBLIC_CONTRACT_SHA256 \
  PUBLIC_APP_URL \
  PUBLIC_BRAND_NAME \
  PUBLIC_BRAND_LOGO_URL \
  PUBLIC_TURNSTILE_SITE_KEY
[[ $(image_label "$TARGET_MIGRATION_IMAGE_ID" org.opencontainers.image.version) == "$TARGET_RELEASE" \
  && $(image_label "$TARGET_MIGRATION_IMAGE_ID" org.opencontainers.image.revision) == "$TARGET_REVISION" \
  && $(image_label "$TARGET_MIGRATION_IMAGE_ID" io.clean-pay.public-build-contract-version) == "$PUBLIC_CONTRACT_VERSION" \
  && $(image_label "$TARGET_MIGRATION_IMAGE_ID" io.clean-pay.public-build-contract-sha256) == "$PUBLIC_CONTRACT_SHA256" ]] \
  || fail "target application and migration image provenance differs"
[[ "$PUBLIC_CONTRACT_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "target public build contract SHA-256 is invalid"
[[ "$TARGET_REVISION" == "$CANDIDATE_SOURCE_REVISION" ]] \
  || fail "target image revision does not match the candidate source commit"
TARGET_APP_EVIDENCE="\"$TARGET_APP_IMAGE_ID\""
TARGET_MIGRATION_EVIDENCE="\"$TARGET_MIGRATION_IMAGE_ID\""

PHASE=prepare-previous-source
mkdir -- "$PREVIOUS_SOURCE_DIR"
readonly -a PREVIOUS_ARCHIVE_INPUTS=(
  Dockerfile
  .dockerignore
  .npmrc
  package.json
  package-lock.json
  next.config.ts
  prisma.config.ts
  tsconfig.json
  scripts/next-command.mjs
  scripts/prisma-generate.mjs
  prisma
  public
  src
  deploy/prod/start.sh
  deploy/prod/deploy-log.mjs
  deploy/prod/database-pool.mjs
  deploy/prod/credential-file-guard.mjs
  deploy/prod/worker-shutdown.mjs
  deploy/prod/validate-env.mjs
  deploy/prod/production-env-rules.mjs
  deploy/prod/reconcile-loop.mjs
  deploy/prod/reconciliation-batch.mjs
  deploy/prod/reconciliation-support-handle.mjs
  deploy/prod/retention-cleanup.mjs
  deploy/prod/retention-heartbeat.mjs
  deploy/prod/retention-loop.mjs
  deploy/prod/payment-retention-hold.mjs
  deploy/prod/payment-retention-hold-command.mjs
  deploy/prod/encryption-rewrap.mjs
  deploy/prod/encryption-rewrap-command.mjs
  deploy/prod/migration-rollback-verifier.mjs
  deploy/prod/database-privilege-manifest.mjs
  deploy/prod/database-role-provision.mjs
)
git -C "$ROOT_DIR" ls-tree -r -z --full-tree "$PREVIOUS_REVISION" \
  -- "${PREVIOUS_ARCHIVE_INPUTS[@]}" > "$PREVIOUS_INVENTORY_FILE"
node - "$PREVIOUS_INVENTORY_FILE" <<'NODE'
const fs = require("node:fs");
const inventory = fs.readFileSync(process.argv[2]);
const records = inventory.toString("utf8").split("\0").filter(Boolean);
if (records.length !== 358) throw new Error("baseline build inventory count differs");
const exact = new Set([
  "Dockerfile", ".dockerignore", ".npmrc", "package.json", "package-lock.json",
  "next.config.ts", "prisma.config.ts", "tsconfig.json",
  "scripts/next-command.mjs", "scripts/prisma-generate.mjs",
  "deploy/prod/start.sh", "deploy/prod/deploy-log.mjs",
  "deploy/prod/database-pool.mjs", "deploy/prod/credential-file-guard.mjs",
  "deploy/prod/worker-shutdown.mjs", "deploy/prod/validate-env.mjs",
  "deploy/prod/production-env-rules.mjs", "deploy/prod/reconcile-loop.mjs",
  "deploy/prod/reconciliation-batch.mjs",
  "deploy/prod/reconciliation-support-handle.mjs",
  "deploy/prod/retention-cleanup.mjs", "deploy/prod/retention-heartbeat.mjs",
  "deploy/prod/retention-loop.mjs", "deploy/prod/payment-retention-hold.mjs",
  "deploy/prod/payment-retention-hold-command.mjs",
  "deploy/prod/encryption-rewrap.mjs", "deploy/prod/encryption-rewrap-command.mjs",
  "deploy/prod/migration-rollback-verifier.mjs",
  "deploy/prod/database-privilege-manifest.mjs",
  "deploy/prod/database-role-provision.mjs",
]);
const seen = new Set();
for (const record of records) {
  const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t([^\0]+)$/.exec(record);
  if (!match) throw new Error("baseline build inventory entry is invalid");
  const sourcePath = match[3];
  if (seen.has(sourcePath)) throw new Error("baseline build inventory contains a duplicate");
  seen.add(sourcePath);
  const allowed = exact.has(sourcePath)
    || sourcePath.startsWith("prisma/")
    || sourcePath.startsWith("public/")
    || sourcePath.startsWith("src/");
  const segments = sourcePath.split("/");
  const basename = segments.at(-1) ?? "";
  const forbidden = segments.some((segment) =>
    [".git", ".github", ".vscode", ".idea", ".codex", "attachments", "archives"]
      .includes(segment.toLowerCase()))
    || basename === ".env"
    || basename.startsWith(".env.")
    || /\.(?:pem|key|p12|pfx|jks|kdbx|zip|7z|rar|tar|gz)$/i.test(basename);
  if (!allowed || forbidden) throw new Error("baseline build inventory path is not allowlisted");
}
for (const required of exact) {
  if (!seen.has(required)) throw new Error("baseline build inventory is incomplete");
}
NODE
git -C "$ROOT_DIR" archive --format=tar "$PREVIOUS_REVISION" \
  -- "${PREVIOUS_ARCHIVE_INPUTS[@]}" \
  | tar --extract --no-same-owner --directory "$PREVIOUS_SOURCE_DIR"
[[ -f "$PREVIOUS_SOURCE_DIR/Dockerfile" \
  && ! -L "$PREVIOUS_SOURCE_DIR/Dockerfile" \
  && -f "$PREVIOUS_SOURCE_DIR/.dockerignore" \
  && ! -L "$PREVIOUS_SOURCE_DIR/.dockerignore" ]] \
  || fail "previous source archive is incomplete"
[[ -f "$ROOT_DIR/.dockerignore" && ! -L "$ROOT_DIR/.dockerignore" ]] \
  || fail "candidate deny-default Docker context policy is unavailable"
cp -- "$ROOT_DIR/.dockerignore" "$PREVIOUS_SOURCE_DIR/.dockerignore"
cmp --silent -- "$ROOT_DIR/.dockerignore" "$PREVIOUS_SOURCE_DIR/.dockerignore" \
  || fail "baseline build did not inherit the candidate Docker context policy"
BASELINE_CONTEXT_ALLOWLIST_PROVEN=true

PHASE=build-previous-images
[[ -z $(docker image ls --quiet --no-trunc "$PREVIOUS_APP_REFERENCE") \
  && -z $(docker image ls --quiet --no-trunc "$PREVIOUS_MIGRATION_REFERENCE") ]] \
  || fail "a disposable previous-image tag is already in use"
timeout --signal=TERM --kill-after=20s 900s docker build \
  --target runner \
  --label io.clean-pay.image-rollback.owner=clean-pay-image-rollback-v1 \
  --label "io.clean-pay.image-rollback.project=$PROJECT_NAME" \
  --label io.clean-pay.image-rollback.role=previous-app \
  --build-arg CLEAN_PAY_RELEASE="$PREVIOUS_RELEASE" \
  --build-arg CLEAN_PAY_REVISION="$PREVIOUS_REVISION" \
  --build-arg CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION="$PUBLIC_CONTRACT_VERSION" \
  --build-arg CLEAN_PAY_PUBLIC_BUILD_CONTRACT_SHA256="$PUBLIC_CONTRACT_SHA256" \
  --build-arg NEXT_PUBLIC_APP_URL="$PUBLIC_APP_URL" \
  --build-arg TURNSTILE_ENABLED=true \
  --build-arg TURNSTILE_WIDGET_ID="$PUBLIC_TURNSTILE_SITE_KEY" \
  --build-arg NEXT_PUBLIC_BRAND_NAME="$PUBLIC_BRAND_NAME" \
  --build-arg NEXT_PUBLIC_BRAND_LOGO_URL="$PUBLIC_BRAND_LOGO_URL" \
  --tag "$PREVIOUS_APP_REFERENCE" \
  "$PREVIOUS_SOURCE_DIR"
PREVIOUS_APP_IMAGE_ID=$(image_id "$PREVIOUS_APP_REFERENCE")
PREVIOUS_APP_EVIDENCE="\"$PREVIOUS_APP_IMAGE_ID\""
timeout --signal=TERM --kill-after=20s 900s docker build \
  --target migration \
  --label io.clean-pay.image-rollback.owner=clean-pay-image-rollback-v1 \
  --label "io.clean-pay.image-rollback.project=$PROJECT_NAME" \
  --label io.clean-pay.image-rollback.role=previous-migration \
  --build-arg CLEAN_PAY_RELEASE="$PREVIOUS_RELEASE" \
  --build-arg CLEAN_PAY_REVISION="$PREVIOUS_REVISION" \
  --build-arg CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION="$PUBLIC_CONTRACT_VERSION" \
  --build-arg CLEAN_PAY_PUBLIC_BUILD_CONTRACT_SHA256="$PUBLIC_CONTRACT_SHA256" \
  --tag "$PREVIOUS_MIGRATION_REFERENCE" \
  "$PREVIOUS_SOURCE_DIR"
PREVIOUS_MIGRATION_IMAGE_ID=$(image_id "$PREVIOUS_MIGRATION_REFERENCE")
[[ "$PREVIOUS_APP_IMAGE_ID" != "$TARGET_APP_IMAGE_ID" \
  && "$PREVIOUS_MIGRATION_IMAGE_ID" != "$TARGET_MIGRATION_IMAGE_ID" \
  && "$PREVIOUS_APP_IMAGE_ID" != "$PREVIOUS_MIGRATION_IMAGE_ID" ]] \
  || fail "previous and target image identities are not distinct"
[[ $(image_label "$PREVIOUS_APP_IMAGE_ID" org.opencontainers.image.revision) == "$PREVIOUS_REVISION" \
  && $(image_label "$PREVIOUS_MIGRATION_IMAGE_ID" org.opencontainers.image.revision) == "$PREVIOUS_REVISION" \
  && $(image_label "$PREVIOUS_APP_IMAGE_ID" org.opencontainers.image.version) == "$PREVIOUS_RELEASE" \
  && $(image_label "$PREVIOUS_MIGRATION_IMAGE_ID" org.opencontainers.image.version) == "$PREVIOUS_RELEASE" ]] \
  || fail "previous image provenance differs from the baseline source"
PREVIOUS_MIGRATION_EVIDENCE="\"$PREVIOUS_MIGRATION_IMAGE_ID\""

PHASE=prepare-synthetic-environment
CLEAN_PAY_FIXTURE_PUBLIC_APP_URL="$PUBLIC_APP_URL" \
CLEAN_PAY_FIXTURE_BRAND_NAME="$PUBLIC_BRAND_NAME" \
CLEAN_PAY_FIXTURE_BRAND_LOGO_URL="$PUBLIC_BRAND_LOGO_URL" \
CLEAN_PAY_FIXTURE_TURNSTILE_SITE_KEY="$PUBLIC_TURNSTILE_SITE_KEY" \
CLEAN_PAY_FIXTURE_DEPLOY_SOURCE=build \
CLEAN_PAY_FIXTURE_APPLICATION_IMAGE="$TARGET_APP_REFERENCE" \
CLEAN_PAY_FIXTURE_MIGRATION_IMAGE="$TARGET_MIGRATION_REFERENCE" \
CLEAN_PAY_FIXTURE_RELEASE="$TARGET_RELEASE" \
CLEAN_PAY_FIXTURE_REVISION="$TARGET_REVISION" \
  node "$SYNTHETIC_ENV_SCRIPT" "$TARGET_ENV_FILE"
set_env_value "$TARGET_ENV_FILE" COMPOSE_PROJECT_NAME "$PROJECT_NAME"
set_env_value "$TARGET_ENV_FILE" CLEAN_PAY_BIND 127.0.0.1
set_env_value "$TARGET_ENV_FILE" CLEAN_PAY_PORT "$HOST_PORT"
set_env_value "$TARGET_ENV_FILE" CLEAN_PAY_EDGE_NETWORK "$EDGE_NETWORK"
set_env_value "$TARGET_ENV_FILE" PAYMENT_RECONCILIATION_ENABLED false
set_env_value "$TARGET_ENV_FILE" REMNASHOP_API_BASE_URL \
  "http://$READINESS_PROVIDER_ALIAS:$READINESS_PROVIDER_PORT/api/v1/public"
set_env_value "$TARGET_ENV_FILE" REMNASHOP_ADMIN_API_BASE_URL \
  "http://$READINESS_PROVIDER_ALIAS:$READINESS_PROVIDER_PORT/api/v1/admin"
cp --preserve=mode -- "$TARGET_ENV_FILE" "$ROLLBACK_ENV_FILE"
set_env_value "$ROLLBACK_ENV_FILE" CLEAN_PAY_IMAGE "$PREVIOUS_APP_REFERENCE"
set_env_value "$ROLLBACK_ENV_FILE" CLEAN_PAY_MIGRATION_IMAGE "$PREVIOUS_MIGRATION_REFERENCE"
set_env_value "$ROLLBACK_ENV_FILE" CLEAN_PAY_RELEASE "$PREVIOUS_RELEASE"
set_env_value "$ROLLBACK_ENV_FILE" CLEAN_PAY_REVISION "$PREVIOUS_REVISION"
chmod 600 "$TARGET_ENV_FILE" "$ROLLBACK_ENV_FILE"
node "$ROLE_ENV_SCRIPT" materialize "$ROLLBACK_ENV_FILE"
sh "$IMAGE_PREFLIGHT_SCRIPT" \
  build \
  "$PREVIOUS_APP_REFERENCE" \
  "$PREVIOUS_MIGRATION_REFERENCE" \
  "$ROLLBACK_ENV_FILE" \
  "$PUBLIC_APP_URL" \
  "$PUBLIC_BRAND_NAME" \
  "$PUBLIC_BRAND_LOGO_URL" \
  "$PUBLIC_TURNSTILE_SITE_KEY" \
  "$PREVIOUS_RELEASE" \
  "$PREVIOUS_REVISION" \
  "$ROLLBACK_PREFLIGHT_OUTPUT" >/dev/null
node -e '
  const fs=require("node:fs");
  const text=fs.readFileSync(process.argv[1],"utf8");
  const expected="CLEAN_PAY_VERIFIED_APP_IMAGE="+process.argv[2]
    +"\nCLEAN_PAY_VERIFIED_MIGRATION_IMAGE="+process.argv[3]+"\n";
  if(text!==expected)process.exit(1);
' "$ROLLBACK_PREFLIGHT_OUTPUT" "$PREVIOUS_APP_IMAGE_ID" "$PREVIOUS_MIGRATION_IMAGE_ID" \
  || fail "rollback image preflight output differs from the immutable images"
ROLLBACK_IMAGE_PREFLIGHT_PROVEN=true

PHASE=start-previous-stack
docker network create \
  --label io.clean-pay.image-rollback.owner=clean-pay-image-rollback-v1 \
  --label "io.clean-pay.image-rollback.project=$PROJECT_NAME" \
  "$EDGE_NETWORK" >/dev/null
compose_for_env "$ROLLBACK_ENV_FILE" up --detach --no-build --pull never \
  --wait --wait-timeout 180
assert_compose_stack_image "$ROLLBACK_ENV_FILE" "$PREVIOUS_APP_IMAGE_ID"
VERIFIED_IMAGE_STATE_COUNT=1
start_readiness_provider
start_traffic_continuity

PHASE=stage-target-canary
begin_traffic_phase stage primary
run_zero_downtime stage --require-no-pending-migrations
assert_canary_image "$TARGET_APP_IMAGE_ID"
end_traffic_phase stage primary

PHASE=promote-target-images
begin_traffic_phase promote canary
run_zero_downtime promote --traffic-on-canary
assert_compose_stack_image "$TARGET_ENV_FILE" "$TARGET_APP_IMAGE_ID"
VERIFIED_IMAGE_STATE_COUNT=2
end_traffic_phase promote canary
switch_traffic_route primary

PHASE=rollback-previous-images
begin_traffic_phase rollback canary
run_zero_downtime rollback --traffic-on-canary
assert_compose_stack_image "$TARGET_ENV_FILE" "$PREVIOUS_APP_IMAGE_ID"
VERIFIED_IMAGE_STATE_COUNT=3
cmp --silent -- "$TARGET_ENV_FILE" "$ROLLBACK_ENV_FILE" \
  || fail "authoritative environment was not restored byte-for-byte"
ENVIRONMENT_RESTORED=true
end_traffic_phase rollback canary
switch_traffic_route primary

PHASE=remove-target-canary
begin_traffic_phase remove primary
run_zero_downtime remove --traffic-off-canary
[[ ! -e "$STATE_FILE" && ! -L "$STATE_FILE" ]] \
  || fail "zero-downtime state remained after canary removal"
assert_canary_absent
CANARY_REMOVED=true
end_traffic_phase remove primary
switch_traffic_route primary
prove_readiness_provider_contract
stop_traffic_continuity
stop_readiness_provider

PHASE=cleanup-owned-resources
cleanup_owned_resources || fail "exact owned-resource cleanup could not be proven"
CLEANUP_PROVEN=true
PHASE=complete
write_report passed true || fail "sanitized create-only report could not be written"
