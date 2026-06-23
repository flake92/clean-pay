#!/bin/sh
set -eu

cd /opt/clean-pay

COMPOSE="docker compose -p clean-pay --env-file .env -f docker-compose.teststand.yml"

$COMPOSE build web
$COMPOSE up -d postgres redis
$COMPOSE run --rm web npx prisma migrate deploy
$COMPOSE up -d web
$COMPOSE ps
