# Devcontainer Rebuild Plan

## Goal

Build a new local development and debug environment from scratch. Do not reuse the deleted legacy production, teststand, mock, or integration compose files.

The repository should contain one dev compose stack for local work. The stack must run the application and every local service needed for realistic development under one Docker Compose project.

## Cleanup Done

- Removed the legacy `.devcontainer` configuration.
- Removed the legacy VS Code launch/tasks configuration.
- Removed old production Docker/Caddy compose files.
- Removed old teststand deployment scripts and documentation.
- Removed old integration notes and historical planning docs.
- Simplified `package.json` scripts to application-level commands only.
- Removed standalone Next.js output configuration from `next.config.ts`.

## New Dev Stack Requirements

The new compose stack should include these services:

- `app`: devcontainer service for the Clean Pay source tree.
- `postgres`: Clean Pay application database.
- `redis`: Clean Pay rate-limit/session support where required.
- `remnashop`: local Remnashop service or a deliberately chosen local stub if full Remnashop is too heavy for inner-loop work.
- `remnashop-postgres`: Remnashop database, separate from Clean Pay database.
- `remnashop-cache`: Remnashop cache/queue service if required by Remnashop.
- `remnashop-worker`: Remnashop background worker if required for e-mail, payments, or async jobs.
- `smtp`: local SMTP catcher, preferably Mailpit.
- `caddy`: local reverse proxy entrypoint.

Optional services should be added only if the application flow needs them locally:

- Turnstile verifier stub.
- Telegram/OIDC stub.
- Payment provider stub.

## Compose Rules

- Use one compose file for development.
- Keep all services on the same compose network.
- Use stable internal DNS names matching service names.
- Do not commit real secrets.
- Keep local ports explicit and documented.
- Persist only databases, cache data, and `node_modules` in named volumes.
- Make service healthchecks real enough for `depends_on` to be useful.

## Expected Local Entrypoints

- Clean Pay direct dev server: `http://localhost:4000`
- Caddy proxied Clean Pay URL: `http://localhost:8080`
- Mailpit UI: `http://localhost:8025`
- Prisma Studio: `http://localhost:5555`
- Clean Pay Postgres: `localhost:5432`
- Remnashop Postgres: separate host port if exposed.

Exact ports can change during implementation if a conflict appears.

## Devcontainer Requirements

- Open the repository in the `app` service.
- Use Node 24.
- Install application dependencies in a Docker volume.
- Run `npm install` and `npm run prisma:generate` after container creation.
- Keep environment values in compose, not duplicated across launch profiles.
- Provide database and Redis CLI tools inside the devcontainer.

## VS Code Debug Requirements

Create a new `.vscode/launch.json` with only current, working profiles:

- Debug Next.js dev server.
- Start built app.
- Prisma Studio.

Create tasks only if they are necessary and current:

- Prepare dependencies and Prisma client.
- Run Clean Pay migrations.
- Build application.

Do not add legacy normal/mock profiles.

## Implementation Steps

1. Decide whether local Remnashop should run from an upstream image/source checkout or a minimal local stub.
2. Define the new `.devcontainer/docker-compose.yml`.
3. Define `.devcontainer/devcontainer.json`.
4. Add Caddy config for the local routes.
5. Add Mailpit SMTP settings to the Remnashop service.
6. Add application env for Clean Pay to talk to local services.
7. Add fresh VS Code launch/tasks.
8. Start the full stack and verify health.
9. Run migrations for Clean Pay and Remnashop.
10. Verify registration/login, e-mail code delivery, tariffs, cabinet, payment return pages, and debug breakpoints.

## Verification Checklist

- `docker compose config` succeeds.
- Devcontainer opens into the `app` service.
- `npm run dev` serves Clean Pay.
- Caddy proxies Clean Pay.
- Clean Pay connects to its Postgres database.
- Clean Pay connects to Redis.
- Clean Pay reaches Remnashop through compose DNS.
- Remnashop sends mail to Mailpit.
- Mailpit shows verification messages.
- VS Code debugger attaches/launches cleanly.
- Prisma Studio opens and sees Clean Pay tables.
