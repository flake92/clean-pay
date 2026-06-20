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
- `POST /api/bff/auth/email/change`
- `POST /api/bff/auth/email/confirm`
- `POST /api/bff/auth/change-password`
- `GET /api/bff/plans/public`
- `GET /api/bff/subscription/current`
- `GET /api/bff/subscription/offers`
- `POST /api/bff/subscription/purchase`
- `POST /api/bff/subscription/extend`
- `POST /api/bff/subscription/reissue`
- `POST /api/bff/subscription/promocode`
- `GET /api/bff/subscription/devices`
- `DELETE /api/bff/subscription/devices`
- `DELETE /api/bff/subscription/devices/{hwid}`
- `GET /api/bff/payments/history`
- `GET /api/bff/payments/status`
- `GET /api/bff/support`

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

## Profile

`/profile` uses Remnashop public auth endpoints:

- `GET /auth/me`
- `POST /auth/email/change`
- `POST /auth/email/request-verification`
- `POST /auth/email/confirm`
- `POST /auth/change-password`

Current Remnashop public API does not expose user-name editing, so the name is read-only.

After password change, Remnashop rotates auth cookies; Clean Pay updates the encrypted Remnashop tokens stored in the current web session.

## Tariffs

The tariff page uses authenticated offers:

```text
GET /api/bff/subscription/offers
```

It displays available plans, device limits, traffic limits, durations, prices, and payment gateways.

## Purchase

Clean Pay creates payments through:

```text
POST /api/bff/subscription/purchase
```

The frontend confirms selected plan, duration, and gateway on `/payment`.
If Remnashop returns `payment_url`, the browser redirects to it immediately.
If Remnashop returns `is_free: true`, the browser redirects to `/cabinet`.

## Extend

Clean Pay extends current subscriptions through:

```text
POST /api/bff/subscription/extend
```

The frontend uses authenticated offers from `/api/bff/subscription/offers` and selects the plan marked by Remnashop as `recommended_purchase_type = renew`.

If there is no current subscription, the user goes back to `/tariffs`.

## Cabinet Subscription Data

`/cabinet` uses:

- `GET /api/bff/subscription/current`
- `GET /api/bff/subscription/devices`

Current subscription fields shown when present:

- `status`, `is_trial`, `expire_at`
- `plan_name`, `plan_duration_days`
- `traffic_limit`, `used_traffic_bytes`, `lifetime_used_traffic_bytes`
- `device_limit`, `traffic_limit_strategy`
- `url`, `online_at`, `user_remna_id`

The subscription URL is shown as two actions: connect and copy.

Cabinet management actions:

- delete one device through `DELETE /api/bff/subscription/devices/{hwid}`
- delete all devices through `DELETE /api/bff/subscription/devices`
- reissue subscription URL through `POST /api/bff/subscription/reissue`
- activate promocode through `POST /api/bff/subscription/promocode`

Reissue must show a warning because it disconnects existing devices.

## Payments

Remnashop public API creates payments through purchase/extend responses, but no public payment history endpoint was found in the current Remnashop source.

Clean Pay stores local `PaymentRecord` rows for payments initiated through the web cabinet. Return pages call `GET /api/bff/payments/status`, which combines the local payment record with current subscription data from Remnashop public API.

This is not direct Remnashop DB access.

## Support

The `/support` page and cabinet support block are controlled by env:

- `SUPPORT_ENABLED`
- `SUPPORT_EMAIL`
- `SUPPORT_TELEGRAM_USERNAME`
- `SUPPORT_FAQ_URL`
