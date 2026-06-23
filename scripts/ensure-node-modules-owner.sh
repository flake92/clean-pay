#!/usr/bin/env sh
set -eu

TARGET="${1:-/workspaces/clean-pay/node_modules}"
OWNER="${2:-node:node}"

if [ ! -e "$TARGET" ]; then
  mkdir -p "$TARGET"
fi

NEEDS_CHOWN=0

owner_matches() {
  CURRENT_OWNER="$(stat -c '%U:%G' "$1" 2>/dev/null || true)"
  [ -z "$CURRENT_OWNER" ] || [ "$CURRENT_OWNER" = "$OWNER" ]
}

if [ ! -w "$TARGET" ]; then
  NEEDS_CHOWN=1
elif ! owner_matches "$TARGET"; then
  NEEDS_CHOWN=1
fi

for PATH_TO_CHECK in "$TARGET/.prisma" "$TARGET/.prisma/client" "$TARGET/.prisma/client/index.d.ts" "$TARGET/.prisma/client/index.js"; do
  if [ -e "$PATH_TO_CHECK" ] && { [ ! -w "$PATH_TO_CHECK" ] || ! owner_matches "$PATH_TO_CHECK"; }; then
    NEEDS_CHOWN=1
  fi
done

if [ "$NEEDS_CHOWN" = "0" ]; then
  exit 0
fi

if command -v sudo >/dev/null 2>&1; then
  sudo chown -R "$OWNER" "$TARGET"
else
  chown -R "$OWNER" "$TARGET"
fi
