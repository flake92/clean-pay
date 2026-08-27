#!/usr/bin/env sh
set -eu

node deploy/prod/validate-env.mjs
export CLEAN_PAY_INHERITED_NODE_OPTIONS="${NODE_OPTIONS-}"
export NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--require=./deploy/prod/application-drain-preload.cjs"
exec node server.js
