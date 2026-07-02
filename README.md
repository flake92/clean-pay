# Clean Pay

Clean Pay is a Next.js web cabinet application.

The old development, deployment, teststand, and integration infrastructure has been removed. The new local development container must be designed from scratch before adding new compose, launch, proxy, mail, or integration services back to the repository.

See `DEVCONTAINER_REBUILD_PLAN.md` for the rebuild plan.

## Devcontainer

The development environment is defined in one compose file: `.devcontainer/docker-compose.yml`.

Services:

```text
app                  Clean Pay devcontainer
postgres             Clean Pay PostgreSQL
redis                Clean Pay Redis
remnashop            Real Remnashop container
remnashop-postgres   Remnashop PostgreSQL
remnashop-cache      Remnashop Valkey
remnashop-worker     Remnashop taskiq worker
remnashop-scheduler  Remnashop taskiq scheduler
remnawave-mock       Lightweight HTTP placeholder for Remnashop Remnawave calls
smtp                 Mailpit SMTP catcher
smtp-log             Logs incoming Mailpit messages to Docker logs
caddy                Local reverse proxy
```

Local URLs:

```text
http://localhost:4000  Clean Pay direct Next.js dev server
http://localhost:8080  Clean Pay through Caddy
http://localhost:5001  Remnashop direct
http://localhost:8081  Remnashop through Caddy
http://localhost:8025  Mailpit direct
http://localhost:8026  Mailpit through Caddy
http://localhost:5555  Prisma Studio
```

Clean Pay talks to Remnashop through compose DNS: `http://remnashop:5000/api/v1/public`.

Incoming dev emails are also printed to the `smtp-log` container:

```bash
docker compose -p clean-pay-dev -f .devcontainer/docker-compose.yml logs -f smtp-log
```

Remnashop is a real service container. Its database starts empty, so tariff/payment flows need Remnashop seed/configuration data before they can behave like a populated production bot.

## Application Commands

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

## Source Layout

```text
src/app       Next.js routing layer: pages, layouts, route handlers.
src/frontend  Browser UI: components, layout shell, styles, client helpers.
src/backend   Server/BFF code grouped by responsibility.
src/shared    Shared contracts and DTO types used by frontend and backend.
```

Keep route files in `src/app` thin. Page routes should import UI from `src/frontend`; API routes and server callbacks should import business logic from `src/backend`.

For request flow navigation, start with `src/app/api/ENDPOINTS.md`: it maps each endpoint to its route file and backend flow file.

Backend folders:

```text
src/backend/auth          Auth use cases, passkeys, redirects, profile presentation.
src/backend/cache         Cache clients such as Redis.
src/backend/config        Runtime environment parsing.
src/backend/database      Database clients such as Prisma.
src/backend/health        Readiness and health checks.
src/backend/http          BFF response/error helpers.
src/backend/integrations  External systems such as Remnashop and Telegram OIDC.
src/backend/limits        Rate limits and cooldowns.
src/backend/observability Logs, audit, debug traces.
src/backend/payments      Local payment record helpers.
src/backend/security      Crypto, security policy, Turnstile verification.
src/backend/sessions      Web session cookies and session lifecycle.
```

## Checks

```bash
npm run lint
npm run build
npm run test:unit
npm run test:route-handlers
npm run test:integration
npm run test:e2e:devcontainer
```

## Test Layers

Unit tests live in `tests/unit` and do not start Docker.

Route-handler contract tests live in `tests/integration/route-handlers`. They
may import route handlers and use explicit mocks, so they are not full-stack
tests.

Service-level integration tests live in `tests/integration/services`.

Full-stack e2e tests live in `tests/e2e/full-stack`. Run them from the host or
from inside the devcontainer:

```bash
npm run test:e2e:devcontainer
```

The e2e command uses `.devcontainer/docker-compose.yml`, starts the local
dependencies, runs Clean Pay on `http://localhost:4000`, calls the running app
through HTTP, and checks the real Remnashop service, PostgreSQL, Redis, Mailpit
at `http://localhost:8025`, Telegram OIDC mock at `http://localhost:8090`, and
the Remnawave mock. On failure it prints compose status and service logs.

The command stops the devcontainer services after the test run and keeps
volumes by default. Use a clean reset only when explicitly needed:

```bash
RESET_E2E=1 npm run test:e2e:devcontainer
```

PowerShell:

```powershell
$env:RESET_E2E = "1"
npm run test:e2e:devcontainer
Remove-Item Env:RESET_E2E
```
