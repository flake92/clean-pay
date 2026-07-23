.PHONY: setup test system-test ci visual quality \
	infra-config infra-up infra-up-edge infra-down infra-status infra-logs \
	app-config app-build app-up app-verify app-down app-status app-logs

setup:
	mise exec -- bin/setup

test:
	mise exec -- bin/rails test

system-test:
	mise exec -- bin/rails test:system

ci:
	mise exec -- bin/ci

visual:
	mise exec -- bin/rails visual:compare

quality:
	mise exec -- bin/rails quality:structure

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

app-config:
	docker compose -f docker-compose.yml -f docker-compose.app.yml config --quiet

app-build:
	docker compose -f docker-compose.yml -f docker-compose.app.yml build app

app-up:
	mise exec -- bin/rails prestage:up

app-verify:
	mise exec -- bin/rails prestage:verify

app-down:
	mise exec -- bin/rails prestage:down

app-status:
	docker compose -f docker-compose.yml -f docker-compose.app.yml ps

app-logs:
	docker compose -f docker-compose.yml -f docker-compose.app.yml logs -f app retention reconciliation
