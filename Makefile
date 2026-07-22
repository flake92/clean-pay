.PHONY: infra-config infra-up infra-up-edge infra-down infra-status infra-logs

infra-config:
	docker compose config --quiet

infra-up:
	docker compose up -d

infra-up-edge:
	docker compose --profile edge up -d

infra-down:
	docker compose down --remove-orphans

infra-status:
	docker compose ps

infra-logs:
	docker compose logs -f
