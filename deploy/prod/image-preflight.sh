#!/usr/bin/env sh
set -eu

fail() {
  printf '%s\n' "Clean Pay image preflight failed: $*" >&2
  exit 1
}

[ "$#" -eq 11 ] || fail \
  "expected SOURCE APP_IMAGE MIGRATION_IMAGE ENV_FILE APP_URL BRAND_NAME BRAND_LOGO_URL TURNSTILE_SITE_KEY RELEASE REVISION OUTPUT_FILE"

deploy_source=$1
app_image_ref=$2
migration_image_ref=$3
env_file=$4
expected_app_url=$5
expected_brand_name=$6
expected_brand_logo_url=$7
expected_turnstile_site_key=$8
expected_release=$9
shift 9
expected_revision=$1
verified_output=$2

[ -r "$env_file" ] || fail "cannot read the authoritative environment file: $env_file"
[ ! -e "$verified_output" ] || fail "verified image output already exists: $verified_output"

case "$deploy_source" in
  build|pull) ;;
  *) fail "CLEAN_PAY_DEPLOY_SOURCE must be build or pull" ;;
esac

resolve_image_id() {
  image_ref=$1
  image_id=$(docker image inspect --format '{{.Id}}' "$image_ref") \
    || fail "cannot resolve image $image_ref to a local immutable ID"

  printf '%s' "$image_id" | grep -Eq '^sha256:[a-f0-9]{64}$' \
    || fail "$image_ref resolved to an invalid image ID"
  printf '%s' "$image_id"
}

inspect_label() {
  inspected_image_id=$1
  inspected_label=$2
  inspected_value=$(docker image inspect \
    --format "{{ index .Config.Labels \"${inspected_label}\" }}" \
    "$inspected_image_id") \
    || fail "cannot inspect verified image ID $inspected_image_id"

  case "$inspected_value" in
    ''|'<no value>') fail "$inspected_image_id is missing required label $inspected_label" ;;
  esac

  printf '%s' "$inspected_value"
}

reject_unknown_pull_metadata() {
  metadata_name=$1
  metadata_value=$2
  normalized_value=$(printf '%s' "$metadata_value" | tr '[:upper:]' '[:lower:]')

  case "$normalized_value" in
    local|unknown|unset|none|dev|development|latest)
      fail "pull mode requires traceable $metadata_name metadata, got $metadata_value"
      ;;
  esac
}

validate_metadata() {
  metadata_name=$1
  metadata_value=$2

  case "$metadata_value" in
    ''|*[!A-Za-z0-9._+/-]*) fail "$metadata_name metadata contains unsafe characters" ;;
  esac
  [ "${#metadata_value}" -le 128 ] \
    || fail "$metadata_name metadata is longer than 128 characters"
}

# Resolve each mutable reference once. Every operation after these two calls is
# pinned to a content-addressed local image ID.
app_image_id=$(resolve_image_id "$app_image_ref")
migration_image_id=$(resolve_image_id "$migration_image_ref")
[ "$app_image_id" != "$migration_image_id" ] \
  || fail "application and migration references resolve to the same image ID"

app_role=$(inspect_label "$app_image_id" io.clean-pay.role)
migration_role=$(inspect_label "$migration_image_id" io.clean-pay.role)
[ "$app_role" = "app" ] || fail "$app_image_id has role $app_role; expected app"
[ "$migration_role" = "migration" ] \
  || fail "$migration_image_id has role $migration_role; expected migration"

app_release=$(inspect_label "$app_image_id" org.opencontainers.image.version)
migration_release=$(inspect_label "$migration_image_id" org.opencontainers.image.version)
app_custom_release=$(inspect_label "$app_image_id" io.clean-pay.release)
migration_custom_release=$(inspect_label "$migration_image_id" io.clean-pay.release)
app_revision=$(inspect_label "$app_image_id" org.opencontainers.image.revision)
migration_revision=$(inspect_label "$migration_image_id" org.opencontainers.image.revision)
app_contract_version=$(inspect_label "$app_image_id" io.clean-pay.public-build-contract-version)
migration_contract_version=$(inspect_label "$migration_image_id" io.clean-pay.public-build-contract-version)
app_contract_sha256=$(inspect_label "$app_image_id" io.clean-pay.public-build-contract-sha256)
migration_contract_sha256=$(inspect_label "$migration_image_id" io.clean-pay.public-build-contract-sha256)

validate_metadata release "$app_release"
validate_metadata release "$migration_release"
validate_metadata revision "$app_revision"
validate_metadata revision "$migration_revision"

[ "$app_release" = "$app_custom_release" ] \
  || fail "$app_image_id has inconsistent OCI and Clean Pay release labels"
[ "$migration_release" = "$migration_custom_release" ] \
  || fail "$migration_image_id has inconsistent OCI and Clean Pay release labels"
[ "$app_release" = "$migration_release" ] \
  || fail "application and migration images have different releases"
[ "$app_revision" = "$migration_revision" ] \
  || fail "application and migration images have different revisions"
[ "$app_contract_version" = "$migration_contract_version" ] \
  || fail "application and migration images have different public build contract versions"
[ "$app_contract_sha256" = "$migration_contract_sha256" ] \
  || fail "application and migration images have different public build contracts"

if [ "$deploy_source" = "pull" ]; then
  reject_unknown_pull_metadata release "$app_release"
  reject_unknown_pull_metadata revision "$app_revision"
  reject_unknown_pull_metadata public-build-contract-version "$app_contract_version"
  reject_unknown_pull_metadata public-build-contract-sha256 "$app_contract_sha256"
  printf '%s' "$app_contract_version" | grep -Eq '^[1-9][0-9]{0,8}$' \
    || fail "pull mode requires a canonical public build contract version"
  printf '%s' "$app_contract_sha256" | grep -Eq '^[a-f0-9]{64}$' \
    || fail "pull mode requires a canonical public build contract SHA-256"
fi

[ "$app_release" = "$expected_release" ] \
  || fail "image release $app_release does not match CLEAN_PAY_RELEASE=$expected_release"
[ "$app_revision" = "$expected_revision" ] \
  || fail "image revision $app_revision does not match CLEAN_PAY_REVISION=$expected_revision"

app_baked_url=$(inspect_label "$app_image_id" io.clean-pay.baked-public-app-url)
app_baked_brand=$(inspect_label "$app_image_id" io.clean-pay.baked-brand-name)
app_baked_logo=$(inspect_label "$app_image_id" io.clean-pay.baked-brand-logo-url)
app_baked_turnstile=$(inspect_label "$app_image_id" io.clean-pay.baked-turnstile-site-key)

[ "$app_baked_url" = "$expected_app_url" ] \
  || fail "app image public URL does not match NEXT_PUBLIC_APP_URL"
[ "$app_baked_brand" = "$expected_brand_name" ] \
  || fail "app image brand name does not match NEXT_PUBLIC_BRAND_NAME"
[ "$app_baked_logo" = "$expected_brand_logo_url" ] \
  || fail "app image brand logo does not match NEXT_PUBLIC_BRAND_LOGO_URL"
[ "$app_baked_turnstile" = "$expected_turnstile_site_key" ] \
  || fail "app image Turnstile site key does not match TURNSTILE_SITE_KEY"

# Execute only the verified app image's synchronous validator, isolated from
# networks and before any migration or runtime container can start.
docker run --rm --interactive \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 64 \
  --memory 256m \
  --cpus 0.5 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
  --entrypoint node \
  "$app_image_id" \
  deploy/prod/validate-env.mjs --runtime-env-stdin < "$env_file" \
  || fail "the application image rejected the authoritative runtime environment"

umask 077
(
  set -C
  {
    printf 'CLEAN_PAY_VERIFIED_APP_IMAGE=%s\n' "$app_image_id"
    printf 'CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=%s\n' "$migration_image_id"
  } > "$verified_output"
) || fail "cannot create verified image output: $verified_output"

printf '%s\n' "Clean Pay image preflight passed for release $app_release ($app_revision)."
