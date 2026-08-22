# Referral integration contract

Clean Pay exposes one canonical share link:

```text
https://pay.example.com/invite/AbC123
```

`GET /invite/<referral_code>` accepts only 3–64 ASCII alphanumeric characters, stores the attribution in a signed `HttpOnly`, `SameSite=Lax` cookie for at most 30 days, and redirects a guest to `/register?redirect_to=/tariffs`. The signature is domain-separated and verified again by the registration Server Action. Invalid, expired, future-dated, oversized, or modified values are ignored.

The attribution is sent only in the Remnashop `POST /auth/register` body as `referral_code`. It is never sent to identify, password/Passkey/Telegram login, password reset, or the existing-email fallback login. A terminal created-account result consumes the cookie; a terminal existing-account or Telegram session discards it as inapplicable; transient and pending-merge failures preserve it for retry. An already authenticated visitor opening another `/invite/` link is redirected to tariffs and any stale attribution is deleted. The internal registration-flow marker is removed before the Server Action response reaches the browser.

## Remnashop program response

Clean Pay reads authenticated `GET /referral/program`. In addition to the existing program settings and counters, the response contract contains these required additive fields:

```json
{
  "web_referral_url": "https://pay.example.com/invite/AbC123",
  "points_balance": 120,
  "total_points_issued": 200,
  "total_days_issued": 0
}
```

`web_referral_url` is the same link displayed by the Remnashop Telegram bot. Clean Pay rejects it unless it has the exact configured public origin, exact `/invite/<referral_code>` path, and no credentials, query, or fragment. All counters, reward enums, levels, and values are validated before crossing the backend reader boundary.

The referral panel always displays the current points balance. Historical point and extra-day totals are displayed independently whenever they are non-zero, including after the configured reward type changes.

## Rollout boundary

The reviewed Remnashop contract is PR #135 revision `8645d3e` with Alembic head `0055`. It includes the durable referral schema from `0052`, bounded legacy/operator recovery through `0055`, permanent Remnapy contract compatibility, serialized recipient claims, and database-owned reward audit timestamps. API, worker, and scheduler must run that same immutable image before referral traffic is enabled.

Historical compensation is deliberately separate from normal registration. Keep `REFERRAL_REWARD_BACKFILL_ENABLED=false` during a mixed-version rollout. After every pre-0052 Remnashop process has been drained, operators may enable it and follow Remnashop's `REFERRAL_REWARD_RECOVERY.md` inventory → preview → apply procedure. Legacy ambiguous rewards are never replayed automatically.
