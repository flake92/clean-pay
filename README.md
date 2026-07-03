# Clean Pay

English | [Русский](README.ru_RU.md)

Clean Pay is a Docker Compose application for a CleanVPN payment and subscription cabinet.

It provides a web cabinet where users can sign in, view subscription status, open the connection link, manage devices, extend a subscription, and access support. Clean Pay stores its own sessions and service data in PostgreSQL and Redis, and integrates with Remnashop and Remnawave through public APIs.

Target runtime platform: Linux server with Docker and Docker Compose.

## Run In 3 Steps

### 1. Clone The Project

The public repository URL will be added after publication.

```bash
git clone <clean-pay-repository-url>
cd clean-pay
```

### 2. Create And Fill `.env`

```bash
cp deploy/prod/.env.example deploy/prod/.env
```

Open `deploy/prod/.env` and replace example values with real values for your stand.

### 3. Start Docker Compose

```bash
node deploy/prod/prod.mjs up
```

Default local URL:

```text
http://127.0.0.1:4000
```

## What Starts

```text
app       Clean Pay web cabinet
postgres  Clean Pay database
redis     Clean Pay cache/session storage
```

## Environment Variables

Use `deploy/prod/.env.example` as the template.

| Variable | Required | Values / Format | Description | Example |
| --- | --- | --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | No | Docker Compose project name. Letters, digits, dash, underscore. | Names containers, networks, and volumes created by Compose. | `clean-pay-prod` |
| `CLEAN_PAY_IMAGE` | No | Docker image name or registry image reference. | Image name used for the app service. Keep local value for local builds or set a registry image later. | `clean-pay-prod-app:local` |
| `CLEAN_PAY_BIND` | No | IP address. Common values: `127.0.0.1`, `0.0.0.0`. | Host interface for the app port. Use `127.0.0.1` behind a reverse proxy. Use `0.0.0.0` only for direct external access. | `127.0.0.1` |
| `CLEAN_PAY_PORT` | No | TCP port number, `1-65535`. | Host port mapped to container port `4000`. | `4000` |
| `CLEAN_PAY_EDGE_NETWORK` | No | Docker network name. | External Docker network used to connect Clean Pay to an existing reverse proxy/network. The production startup helper checks it and creates it when missing. | `remnawave-network` |
| `POSTGRES_DB` | No | PostgreSQL database name. | Database created by the bundled PostgreSQL container. Must match the database name inside `DATABASE_URL`. | `clean_pay` |
| `POSTGRES_USER` | No | PostgreSQL username. | User created by the bundled PostgreSQL container. Must match the user inside `DATABASE_URL`. | `clean_pay` |
| `POSTGRES_PASSWORD` | Yes | Non-empty string. Use a strong secret. | Password for the bundled PostgreSQL user. Must match the password inside `DATABASE_URL`. | `change-me-postgres-password` |
| `DATABASE_URL` | Yes | PostgreSQL URL: `postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public`. | Database connection string used by Prisma/Clean Pay. With bundled PostgreSQL, host must be `postgres`. | `postgresql://clean_pay:change-me-postgres-password@postgres:5432/clean_pay?schema=public` |
| `REDIS_URL` | Yes | Redis URL: `redis://HOST:PORT/DB`. | Redis connection string used for rate limits, cache, and session-related flows. With bundled Redis, use host `redis`. | `redis://redis:6379/0` |
| `APP_URL` | Yes | Absolute URL, `http://...` or `https://...`, no trailing slash required. | Public server URL used to build callbacks and payment return URLs. In production this should be the real HTTPS cabinet URL. | `https://oplata.example.com` |
| `NEXT_PUBLIC_APP_URL` | Yes | Absolute URL, `http://...` or `https://...`. | Public browser URL compiled into frontend code. Usually the same as `APP_URL`. | `https://oplata.example.com` |
| `NEXT_PUBLIC_BRAND_NAME` | No | Display name, 1-80 characters. Empty uses `Clean Pay`. | Cabinet brand name shown in metadata, login/register shell, app header/sidebar/footer, menu section, and passkey relying party name. Rebuild the app after changing it. | `Clean Pay` |
| `NEXT_PUBLIC_BRAND_LOGO_URL` | No | Root-relative public path starting with `/`, not `//`. Empty uses `/clean_vpn_logo.jpg`. | Cabinet logo shown in login/register shell, app header, and footer. Put the asset in the app public assets or serve it from the same deployment path. Rebuild the app after changing it. | `/clean_vpn_logo.jpg` |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error`. | Minimum log level printed by the app. Unknown values fall back to `info`. | `info` |
| `REMNASHOP_API_BASE_URL` | Yes | Absolute URL to Remnashop public API, usually ending with `/api/v1/public`. | Clean Pay uses it for auth, plans, subscriptions, payments, devices, and account linking. | `https://bot.example.com/api/v1/public` |
| `REMNAWAVE_API_BASE_URL` | Yes | Absolute URL to Remnawave panel API, without `/api`. | Required in production. Clean Pay uses Remnawave as the only source for subscription connection links. | `https://panel.example.com` |
| `REMNAWAVE_TOKEN` | Yes | Remnawave API token. May be raw token or `Bearer ...`. | Required in production together with `REMNAWAVE_API_BASE_URL`. Keep it secret. | `change-me` |
| `WEB_JWT_SECRET` | Yes | Long random string. Recommended 32+ bytes. | Secret for web access/session tokens. Rotating it can invalidate active sessions. | `change-me-long-random-web-jwt-secret` |
| `WEB_REFRESH_SECRET` | Yes | Long random string. Recommended 32+ bytes. | Secret for refresh/session lifecycle tokens. Rotating it can invalidate active sessions. | `change-me-long-random-web-refresh-secret` |
| `AUDIT_IP_HASH_SECRET` | No | Long random string. If empty, `WEB_JWT_SECRET` is used. | Secret used to hash IP addresses in audit logs. Use a dedicated value in production. | `change-me-long-random-audit-secret` |
| `COOKIE_SECURE` | No | `true` or `false`. | Set `true` when the public cabinet is served through HTTPS. Use `false` only for plain HTTP local or staging stands. | `true` |
| `COOKIE_SAMESITE` | No | `lax`, `strict`, or `none`. | Cookie SameSite policy. `lax` is the normal choice. `none` requires `COOKIE_SECURE=true`. | `lax` |
| `TELEGRAM_OIDC_ISSUER` | Yes | Absolute URL. | Telegram OAuth/OIDC issuer expected by Clean Pay. | `https://oauth.telegram.org` |
| `TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT` | Yes | Absolute URL. | Telegram authorization endpoint where users are redirected. | `https://oauth.telegram.org/auth` |
| `TELEGRAM_OIDC_TOKEN_ENDPOINT` | Yes | Absolute URL. | Telegram token endpoint used by the callback flow. | `https://oauth.telegram.org/token` |
| `TELEGRAM_OIDC_JWKS_URI` | Yes | Absolute URL. | Telegram JWKS endpoint used to verify signed tokens. | `https://oauth.telegram.org/.well-known/jwks.json` |
| `TELEGRAM_OIDC_CLIENT_ID` | Yes | Telegram bot numeric ID, usually the part before `:` in `TELEGRAM_BOT_TOKEN`. | OAuth client ID for Telegram login. | `1234567890` |
| `TELEGRAM_OIDC_CLIENT_SECRET` | Yes | Telegram OAuth client secret. | Secret used in Telegram OAuth token exchange. Keep it secret. | `change-me` |
| `TELEGRAM_BOT_TOKEN` | No | Bot token in `1234567890:secret` format. Required for Telegram widget/link flows. | Telegram bot token used where Bot API access or Telegram login widget validation is required. Keep it secret. | `1234567890:change-me` |
| `TURNSTILE_ENABLED` | No | `true` or `false`. | Enables Cloudflare Turnstile verification on protected forms. | `false` |
| `TURNSTILE_SITE_KEY` | No | Cloudflare Turnstile site key. Empty when disabled. | Build-time fallback for `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. | `1x00000000000000000000AA` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Required when Turnstile is enabled | Cloudflare Turnstile site key. Empty when disabled. | Public key compiled into frontend code. Rebuild the app after changing it. | `1x00000000000000000000AA` |
| `TURNSTILE_SECRET_KEY` | Required when Turnstile is enabled | Cloudflare Turnstile secret key. Empty when disabled. | Secret key sent to Cloudflare verification API. Keep it secret. | `1x0000000000000000000000000000000AA` |
| `TURNSTILE_VERIFY_URL` | No | Absolute URL. | Cloudflare Turnstile verification endpoint. Keep the default unless using a compatible verification endpoint. | `https://challenges.cloudflare.com/turnstile/v0/siteverify` |
| `SUPPORT_ENABLED` | No | `true` or `false`. | Enables the support block in the cabinet. | `true` |
| `SUPPORT_EMAIL` | No | Email address or empty. | Support email shown to users when support is enabled. | `support@example.com` |
| `SUPPORT_TELEGRAM_USERNAME` | No | Telegram username without `@`, or empty. | Support Telegram username shown to users when support is enabled. | `cleanpay_support` |
| `SUPPORT_FAQ_URL` | No | Absolute URL or empty. | FAQ/support page URL shown to users. | `https://oplata.example.com/support` |
| `CLEAN_PAY_READINESS_MAILPIT_URL` | No | Absolute URL or empty. | Optional Mailpit readiness check. Leave empty in production. | empty |
| `CLEAN_PAY_READINESS_REMNAWAVE_URL` | No | Absolute URL or empty. | Optional Remnawave readiness check. If set, readiness calls `/api/system/metadata` on this URL. | `https://panel.example.com` |

## Notes

- Do not commit `deploy/prod/.env` or any real secrets.
- `node deploy/prod/prod.mjs up` validates `deploy/prod/.env`, creates `CLEAN_PAY_EDGE_NETWORK` when missing, builds the app image, and starts Docker Compose.
- If `NEXT_PUBLIC_TURNSTILE_SITE_KEY` changes, rebuild the app with Docker Compose.
- Clean Pay does not modify Remnashop source code.
- Subscription connection links come only from Remnawave. If Remnawave cannot provide a link, Clean Pay shows an explicit error instead of falling back to a cached Remnashop URL.
- Full Telegram WebApp auto-login requires Telegram to open Clean Pay as a real WebApp and provide signed `initData`. If Telegram opens a regular URL, Clean Pay falls back to Telegram OAuth.
