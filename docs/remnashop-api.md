# Remnashop API integration

Source: https://github.com/snoups/remnashop

Clean Pay talks to Remnashop only through the public API:

```text
https://bot2.clear-vpn.org/api/v1/public
```

## Auth Contracts

### POST /auth/register

Request:

```json
{
  "email": "user@example.com",
  "password": "password",
  "name": "Name",
  "referral_code": "optional"
}
```

Response body:

```json
{
  "expires_at": "2026-06-19T00:00:00Z",
  "refresh_expires_at": "2026-07-19T00:00:00Z"
}
```

Remnashop also sets HttpOnly cookies:

- `access_token`
- `refresh_token`

### POST /auth/login

Request:

```json
{
  "email": "user@example.com",
  "password": "password"
}
```

Response is the same as register.

## Token Handling

- Remnashop tokens are never returned to the frontend.
- Clean Pay extracts Remnashop auth cookies server-side.
- Remnashop tokens are encrypted before storage in `WebSession`.
- Clean Pay exposes its own web-session cookies to the browser.

## BFF Routes

- `POST /api/bff/auth/register`
- `POST /api/bff/auth/login`
- `GET /api/bff/auth/me`
- `POST /api/bff/auth/logout`
- `POST /api/bff/auth/email/request-verification`
- `POST /api/bff/auth/email/confirm`
- `GET /api/bff/plans/public`
- `GET /api/bff/subscription/current`
- `GET /api/bff/subscription/offers`
- `POST /api/bff/subscription/purchase`
- `POST /api/bff/subscription/extend`
- `GET /api/bff/subscription/devices`
- `DELETE /api/bff/subscription/devices/{hwid}`

## Error Normalization

Initial normalized errors:

- invalid/expired auth -> `UNAUTHORIZED`
- forbidden/block -> `FORBIDDEN`
- missing data -> `NOT_FOUND`
- validation error -> `VALIDATION_ERROR`
- unverified email on purchase/extend -> `EMAIL_NOT_VERIFIED`
- too many attempts/cooldown -> `RATE_LIMITED`
- conflict -> `CONFLICT`
- 5xx upstream errors -> `UPSTREAM_UNAVAILABLE`

## E-mail Verification

Remnashop sends the code. Clean Pay adds a local 60-second cooldown before proxying the request.
