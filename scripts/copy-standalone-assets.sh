#!/usr/bin/env sh
set -eu

DIST_DIR="${1:-.next}"
STANDALONE_DIR="$DIST_DIR/standalone"

if [ ! -d "$STANDALONE_DIR" ]; then
  echo "Standalone directory not found: $STANDALONE_DIR" >&2
  exit 1
fi

rm -rf "$STANDALONE_DIR/public"
cp -R public "$STANDALONE_DIR/public"
mkdir -p "$STANDALONE_DIR/$DIST_DIR"
rm -rf "$STANDALONE_DIR/$DIST_DIR/public"
cp -R public "$STANDALONE_DIR/$DIST_DIR/public"
rm -rf "$STANDALONE_DIR/$DIST_DIR/static"
cp -R "$DIST_DIR/static" "$STANDALONE_DIR/$DIST_DIR/static"
mkdir -p "$STANDALONE_DIR/.next"
rm -rf "$STANDALONE_DIR/.next/static"
cp -R "$DIST_DIR/static" "$STANDALONE_DIR/.next/static"
