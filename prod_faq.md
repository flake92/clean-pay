# Clean Pay Production FAQ

## What Runs In Production

- `web`: Next.js frontend + BFF, built as standalone output.
- `postgres`: Prisma database for web-cabinet state, audit, payments, and service records.
- `redis`: rate-limit storage.
- `caddy`: reverse proxy on `80/443` with automatic TLS.
- External integrations: Remnashop API, Telegram OIDC, Cloudflare Turnstile.

Clean Pay does not send e-mail directly. Verification codes are requested through Remnashop, and Remnashop sends them using its own `EMAIL_*` configuration.

## Minimal Production Env

```env
APP_DOMAIN=oplata.clear-vpn.org
APP_URL=https://oplata.clear-vpn.org
NEXT_PUBLIC_APP_URL=https://oplata.clear-vpn.org

POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=clean_pay

REMNASHOP_API_BASE_URL=https://bot2.clear-vpn.org/api/v1/public
WEB_JWT_SECRET=<long-random-secret>
WEB_REFRESH_SECRET=<long-random-secret>
AUDIT_IP_HASH_SECRET=<long-random-secret>

TELEGRAM_OIDC_ISSUER=https://oauth.telegram.org
TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT=https://oauth.telegram.org/auth
TELEGRAM_OIDC_TOKEN_ENDPOINT=https://oauth.telegram.org/token
TELEGRAM_OIDC_JWKS_URI=https://oauth.telegram.org/.well-known/jwks.json
TELEGRAM_OIDC_CLIENT_ID=<telegram-client-id>
TELEGRAM_OIDC_CLIENT_SECRET=<telegram-client-secret>

TURNSTILE_ENABLED=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<cloudflare-turnstile-site-key>
TURNSTILE_SECRET_KEY=<cloudflare-turnstile-secret-key>
TURNSTILE_VERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify
```

For external Redis also set:

```env
REDIS_URL=redis://redis.example.internal:6379/0
```

## Remnashop E-mail Env

Configure this in Remnashop, for example `/opt/remnashop/.env`:

```env
EMAIL_ENABLED=true
EMAIL_HOST=clear-vpn.org
EMAIL_PORT=587
EMAIL_USE_TLS=true
EMAIL_USE_SSL=false
EMAIL_USERNAME=code@clear-vpn.org
EMAIL_PASSWORD=<password>
EMAIL_FROM_EMAIL=code@clear-vpn.org
EMAIL_FROM_NAME=CleanVPN
EMAIL_VERIFICATION_CODE_TTL_MINUTES=15
```

If these variables are missing in Remnashop, Clean Pay can request a verification code but no e-mail will be delivered.

## Deploy

Bundled Redis:

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
docker compose --env-file .env -f docker-compose.prod.yml exec web npx prisma migrate deploy
```

External Redis:

```bash
docker compose --env-file .env -f docker-compose.prod.external-redis.yml up -d --build
docker compose --env-file .env -f docker-compose.prod.external-redis.yml exec web npx prisma migrate deploy
```

## Health

- `/api/health`: basic app liveness.
- `/api/health/readiness`: DB, Redis, and Remnashop readiness.

## Common Checks

- If e-mail codes do not arrive, check Remnashop `EMAIL_*` env and Remnashop logs.
- If Telegram login fails, check redirect URL, client id/secret, `APP_URL`, `NEXT_PUBLIC_APP_URL`, and callback domain.
- If Turnstile rejects requests, check that site key and secret key belong to the same widget and the domain is allowed.
- If `/api/health/readiness` fails, inspect the JSON response and `web` logs.

## Production Checklist

- DNS points to the production server.
- `.env` has no placeholders.
- Docker stack is up.
- Prisma migrations are applied.
- `/api/health` returns OK.
- `/api/health/readiness` has no critical dependency errors.
- Remnashop `EMAIL_*` sends verification codes.
- Login/register, Telegram auth, Turnstile, plans, offers, and payment flow work.
- Caddy TLS is active.
- PostgreSQL backups are configured.
