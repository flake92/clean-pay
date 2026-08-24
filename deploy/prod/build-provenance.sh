#!/usr/bin/env sh
set -eu

fail() {
  printf '%s\n' "Clean Pay build provenance failed: $*" >&2
  exit 1
}

[ "$#" -eq 4 ] || fail "expected ROOT_DIR SOURCE RELEASE REVISION"

root_dir=$1
deploy_source=$2
release=$3
revision=$4

[ "$deploy_source" = "build" ] || exit 0

if [ "$release" = "local" ] || [ "$revision" = "local" ]; then
  [ "$release" = "local" ] && [ "$revision" = "local" ] \
    || fail "CLEAN_PAY_RELEASE and CLEAN_PAY_REVISION must both be local"
  printf '%s\n' \
    "WARNING: building local/local images with UNVERIFIED provenance; do not publish or treat them as reviewed artifacts." >&2
  exit 0
fi

command -v git >/dev/null 2>&1 || fail "git is required for traceable non-local builds"
printf '%s' "$revision" | grep -Eq '^([a-f0-9]{40}|[a-f0-9]{64})$' \
  || fail "CLEAN_PAY_REVISION must be an exact lowercase Git commit hash"

head_revision=$(git -C "$root_dir" rev-parse HEAD 2>/dev/null) \
  || fail "cannot resolve the Git HEAD revision"
[ "$revision" = "$head_revision" ] \
  || fail "CLEAN_PAY_REVISION does not match Git HEAD ($head_revision)"

dirty_paths=$(git -C "$root_dir" status --porcelain --untracked-files=all 2>/dev/null) \
  || fail "cannot inspect the Git checkout"
[ -z "$dirty_paths" ] \
  || fail "non-local images require a clean Git checkout; commit or remove all changes first"

printf '%s\n' "Clean Pay build provenance verified at $head_revision."
