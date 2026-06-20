#!/usr/bin/env sh
set -eu

TARGET="${1:-/workspaces/clean-pay/node_modules}"
OWNER="${2:-node:node}"

if [ ! -e "$TARGET" ]; then
  mkdir -p "$TARGET"
fi

if [ -w "$TARGET" ]; then
  exit 0
fi

if command -v sudo >/dev/null 2>&1; then
  sudo chown -R "$OWNER" "$TARGET"
else
  chown -R "$OWNER" "$TARGET"
fi
