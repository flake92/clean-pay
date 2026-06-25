# Real Integration Tests

This directory contains real Docker-backed integration tests.

They are intentionally separate from route-handler contract tests in
`tests/route-handlers`. Tests here must call Clean Pay through HTTP and must not
import Next.js route handlers, mock Prisma, mock Redis, or mock Remnashop inside
the application process.

## Stack

`tests/integration/docker-compose.yml` starts an isolated compose project named
`clean-pay-integration`:

```text
app                  Clean Pay Next.js server on http://localhost:4100
postgres             Clean Pay PostgreSQL
redis                Clean Pay Redis
remnashop            real Remnashop container on http://localhost:5101
remnashop-postgres   Remnashop PostgreSQL
remnashop-cache      Remnashop Valkey
remnashop-worker     Remnashop taskiq worker
remnashop-scheduler  Remnashop taskiq scheduler
remnawave-mock       local Remnawave mock
telegram-mock        local Telegram Bot API mock
telegram-oidc-mock   local Telegram OIDC mock on http://localhost:8190
smtp                 Mailpit on http://localhost:8125
```

## Commands

```bash
npm run test:unit
npm run test:route-handlers
npm run test:integration
```

`npm run test:integration` starts the test compose stack through Vitest global
setup, runs the HTTP tests, and stops the containers without deleting volumes.

Use a clean reset only when explicitly needed:

```bash
RESET_INTEGRATION=1 npm run test:integration
```

Keep the stack running for manual inspection:

```bash
KEEP_INTEGRATION_STACK=1 npm run test:integration
```

The reset removes only volumes belonging to the `clean-pay-integration` compose
project.
