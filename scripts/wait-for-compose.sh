#!/usr/bin/env bash
set -euo pipefail

project="${1:?Usage: wait-for-compose.sh PROJECT COMPOSE_FILE [timeout_seconds] [services...]}"
compose_file="${2:?Usage: wait-for-compose.sh PROJECT COMPOSE_FILE [timeout_seconds] [services...]}"
timeout_seconds="${3:-300}"
shift 3 || true
services=("$@")
deadline=$((SECONDS + timeout_seconds))
compose_args=(-p "$project" -f "$compose_file")

if [[ "${#services[@]}" -eq 0 ]]; then
  mapfile -t services < <(docker compose "${compose_args[@]}" config --services)
fi

while (( SECONDS < deadline )); do
  not_ready=()

  for service in "${services[@]}"; do
    container_id="$(docker compose "${compose_args[@]}" ps -q "$service" 2>/dev/null || true)"

    if [[ -z "$container_id" ]]; then
      not_ready+=("$service:not-created")
      continue
    fi

    state="$(docker inspect -f '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || true)"

    if [[ "$state" != "running" ]]; then
      not_ready+=("$service:$state")
      continue
    fi

    if [[ "$health" != "none" && "$health" != "healthy" ]]; then
      not_ready+=("$service:$health")
    fi
  done

  if [[ "${#not_ready[@]}" -eq 0 ]]; then
    exit 0
  fi

  echo "Waiting for compose services: ${not_ready[*]}" >&2
  sleep 3
done

echo "Timed out waiting for compose services: ${services[*]}" >&2
docker compose "${compose_args[@]}" ps >&2 || true
exit 1
