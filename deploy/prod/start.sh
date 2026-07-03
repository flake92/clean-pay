#!/usr/bin/env sh
set -eu

node deploy/prod/validate-env.mjs

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  node node_modules/prisma/build/index.js migrate deploy
fi

npm run start
