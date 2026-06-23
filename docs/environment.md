# Environment configuration

## Rules

- Secrets are passed through environment variables.
- Secrets must not be committed to Git.
- `.env.example` contains placeholders only.
- In devcontainer, local development values are provided by `.devcontainer/docker-compose.yml`.
- Payment return URLs are derived from `APP_URL`.

## Variables

### Application

- `APP_URL` - server-side canonical web cabinet URL.
- `NEXT_PUBLIC_APP_URL` - browser-visible public web cabinet URL.

Production:

```bash
APP_URL="https://oplata.clear-vpn.org"
NEXT_PUBLIC_APP_URL="https://oplata.clear-vpn.org"
```

### Remnashop

- `REMNASHOP_API_BASE_URL` - public Remnashop API base URL used only by the BFF.

Current value:

```bash
REMNASHOP_API_BASE_URL="https://bot2.clear-vpn.org/api/v1/public"
```

### Database

- `DATABASE_URL` - PostgreSQL URL for the web cabinet database.

Local devcontainer:

```bash
DATABASE_URL="postgresql://postgres:postgres@db:5432/postgres?schema=public"
```

### Web Sessions

- `WEB_JWT_SECRET` - secret for web access tokens.
- `WEB_REFRESH_SECRET` - secret for web refresh tokens.
- `COOKIE_SECURE` - `true` in production, `false` in local development.
- `COOKIE_SAMESITE` - `lax`, `strict`, or `none`.

### E-mail Verification

Clean Pay does not send e-mail directly. Verification codes are requested through the Remnashop public auth API, so mail delivery must be configured in Remnashop, not in Clean Pay.

Remnashop `/opt/remnashop/.env`:

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

If `EMAIL_*` is missing in Remnashop, Clean Pay registration/login can return `Email delivery is not configured` and no confirmation code will be sent.

### Telegram OIDC

Telegram login uses authorization code flow with PKCE S256.

- `TELEGRAM_OIDC_ISSUER` - expected token issuer.
- `TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT` - authorization endpoint.
- `TELEGRAM_OIDC_TOKEN_ENDPOINT` - token endpoint.
- `TELEGRAM_OIDC_JWKS_URI` - JWKS endpoint for id_token signature validation.
- `TELEGRAM_OIDC_CLIENT_ID` - Telegram Bot ID / Client ID used as id_token audience.
- `TELEGRAM_OIDC_CLIENT_SECRET` - Telegram OIDC client secret.

The callback URL is derived from `APP_URL`:

```text
https://oplata.clear-vpn.org/auth/telegram/callback
```

### Payment Return URLs

Return URLs are not separate env variables. They are built from `APP_URL`:

- success: `/payment/success`
- fail: `/payment/fail`
- pending: `/payment/pending`

For production:

```text
https://oplata.clear-vpn.org/payment/success
https://oplata.clear-vpn.org/payment/fail
https://oplata.clear-vpn.org/payment/pending
```
## Support Block

Optional support links:

```env
SUPPORT_ENABLED="false"
SUPPORT_EMAIL=""
SUPPORT_TELEGRAM_USERNAME=""
SUPPORT_FAQ_URL=""
```

If `SUPPORT_ENABLED=false`, the cabinet support block is hidden.
