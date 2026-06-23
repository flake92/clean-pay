#!/bin/sh
set -eu

cd /opt/clean-pay

docker compose -p clean-pay --env-file .env -f docker-compose.teststand.yml up -d --build --force-recreate