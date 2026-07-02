.PHONY: build prod-up prod-up-debug prod-down prod-logs prod-logs-debug prod-verify prod-verify-debug

build:
	node deploy/prod/prod.mjs build

prod-up:
	node deploy/prod/prod.mjs up

prod-up-debug:
	node deploy/prod/prod.mjs up -debug

prod-down:
	node deploy/prod/prod.mjs down

prod-logs:
	node deploy/prod/prod.mjs logs

prod-logs-debug:
	node deploy/prod/prod.mjs logs -debug

prod-verify:
	node deploy/prod/prod.mjs verify

prod-verify-debug:
	node deploy/prod/prod.mjs verify -debug
