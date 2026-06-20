# Auth flow

## Web Session

Clean Pay issues its own HttpOnly cookies:

- `clean_pay_access` - signed access token, 15 minutes.
- `clean_pay_refresh` - opaque refresh token, 30 days; only its hash is stored.

## Remnashop Session

After Remnashop `register`, `login`, or account linking:

- Remnashop `access_token` and `refresh_token` are extracted server-side.
- Tokens are encrypted before being saved in `WebSession`.
- Tokens are never returned to the frontend.
- Remnashop access token is refreshed automatically when it is near expiry.

## Account Linking

Linking is explicit and works in both directions.

### E-mail user to Telegram

1. User logs in with e-mail.
2. User opens `/link-account`.
3. User starts Telegram OIDC.
4. OIDC state stores current Clean Pay user id.
5. Callback attaches `telegramId` to that user.

### Telegram user to e-mail

1. User logs in with Telegram.
2. User opens `/link-account`.
3. User submits Remnashop e-mail/password.
4. Backend logs into Remnashop server-side.
5. Backend links `remnashopUserId` and `email` to current Clean Pay user.

If target e-mail or Telegram ID is already linked to another local user, BFF returns conflict.

## Minimal Pages

- `/login`
- `/register`
- `/cabinet`
- `/profile`
- `/link-account`
- `/verify-email`
- `/tariffs`
- `/payment`
- `/payment/success`
- `/payment/fail`
- `/payment/pending`
- `/extend`
- `/support`

## E-mail Verification

Clean Pay calls Remnashop public API:

- `POST /auth/email/request-verification`
- `POST /auth/email/confirm`

The web cabinet adds its own click protection before calling Remnashop:

- verification code request cooldown: 60 seconds per local user.
- events are stored in `RateLimitEvent`.
- code format: 6 digits.

The user-facing page is `/verify-email`.

## Profile

`/profile` lets the user view Remnashop profile data, change e-mail, request/confirm e-mail verification, and change password.

Name editing is not implemented because the current Remnashop public API has no endpoint for it.

## Cabinet

`/cabinet` shows the Clean Pay profile plus Remnashop subscription data through the BFF: status, expiry, traffic, devices, technical details, and subscription URL actions.

It also supports device deletion, full device reset, subscription URL reissue with warning, and promocode activation.

The cabinet shows local payment history for payments created through Clean Pay.

Payment return pages check local payment records and current Remnashop subscription through the BFF.

## Support

`/support` shows CleanVPN support contacts, a short connection checklist, and
the note that the site is intended for users who manage subscriptions without
the Telegram bot.
