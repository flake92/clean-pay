# Clean Pay / CleanVPN Web Cabinet

Clean Pay is a standalone CleanVPN web cabinet built with Next.js App Router. The frontend talks only to the local BFF. The BFF talks to Remnashop Public API server-side, manages web-cookie sessions, cache DB records, audit logs, and Redis-backed rate limits.

## Architecture

- `web`: Next.js frontend + BFF.
- `postgres`: dedicated web-cabinet cache DB via Prisma.
- `redis`: rate-limit storage. Production has both bundled Redis and external Redis compose variants.
- `caddy`: reverse proxy on 80/443 with automatic TLS.
- `Remnashop`: external source of truth for auth, verification e-mails, plans, subscriptions, payments, and VPN access.
- `Cloudflare Turnstile`: optional server-side verification for sensitive auth actions.

## Devcontainer

Run project commands inside the existing devcontainer `clean-pay_devcontainer-app-1`. The devcontainer provides networked dev dependencies:

- PostgreSQL: `db:5432`
- Redis: `redis:6379`
- Remnashop API: configured by `REMNASHOP_API_BASE_URL`
- Turnstile verification: Cloudflare endpoint when `TURNSTILE_ENABLED=true`

```bash
cd /workspaces/clean-pay
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run dev
```

## Commands

```bash
npm run lint
npm run build
npm run start:normal -- --hostname 0.0.0.0
npm run smoke:normal
```

## Environment

Use `.env.example` and `.env.production.example`. Never commit real secrets. Key groups:

- App URLs: `APP_URL`, `NEXT_PUBLIC_APP_URL`, `APP_DOMAIN`
- PostgreSQL: `DATABASE_URL`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- Redis: `REDIS_URL`
- Remnashop API: `REMNASHOP_API_BASE_URL`
- Web secrets: `WEB_JWT_SECRET`, `WEB_REFRESH_SECRET`, `AUDIT_IP_HASH_SECRET`
- Cookies: `COOKIE_SECURE`, `COOKIE_SAMESITE`
- Telegram OIDC: `TELEGRAM_OIDC_*`
- Turnstile: `TURNSTILE_ENABLED`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_VERIFY_URL`
- Support: `SUPPORT_ENABLED`, `SUPPORT_EMAIL`, `SUPPORT_TELEGRAM_USERNAME`, `SUPPORT_FAQ_URL`

Clean Pay does not send e-mail directly. Verification codes are requested through Remnashop, so mail delivery is configured in Remnashop via `EMAIL_*` variables.

## Production With Bundled Redis

```bash
cp .env.production.example .env
# edit .env
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

Services: `web`, `postgres`, `redis`, `caddy`. Caddy listens on `80/443` and manages TLS automatically.

## Production With External Redis

Set `REDIS_URL` and run:

```bash
docker compose --env-file .env -f docker-compose.prod.external-redis.yml up -d --build
```

Services: `web`, `postgres`, `caddy`.

## Cloudflare

Use Cloudflare SSL/TLS `Full (strict)`. Point `oplata.clear-vpn.org` to the server. Caddy manages origin TLS automatically. If Cloudflare proxy blocks HTTP/HTTPS challenges, configure Caddy DNS challenge separately.

## Health

- `GET /api/health`: public minimal health.
- `GET /api/health/readiness`: detailed DB, Redis, and Remnashop `/plans/public` checks.

## Audit

User actions are stored in `AuditLog`; technical failures are emitted as JSON console logs. Secrets, cookies, JWTs, refresh tokens, verification codes, Turnstile tokens, and raw upstream details are not stored in audit metadata. IP addresses are stored only as hashes.

## Smoke And Acceptance

```bash
npm run smoke:normal
```

Manual real-Remnashop acceptance: registration, login, logout, e-mail confirmation, resend code, plan view, purchase, payment return, extension, current subscription, VPN link, device deletion, expired session, upstream errors, and mobile layout.

## Update

```bash
git pull
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
docker compose --env-file .env -f docker-compose.prod.yml exec web npx prisma migrate deploy
```

## Rollback

Checkout the previous tag/commit, rebuild compose, verify health endpoints, and restore PostgreSQL backup if a DB migration cannot be rolled back safely.
