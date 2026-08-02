#!/usr/bin/env sh
set -eu

node deploy/prod/validate-env.mjs
exec node server.js
