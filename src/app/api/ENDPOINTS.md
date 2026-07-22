# API Endpoint Flow Map

Every API endpoint starts in `src/app/api/**/route.ts`. This table is checked against every exported HTTP method in that tree, so adding or removing a route requires updating this map in the same change. Route files should keep parsing and response translation near the edge while delegating reusable state transitions to backend modules:

1. Parse request.
2. Call one backend flow/use case.
3. Return `bffJson(...)` or `bffError(...)`.

If a route needs more than request parsing, a small audit call, and one backend call, move that logic into `src/backend/<domain>/<flow>.ts` and update this map.

## Auth

| Endpoint | Route file | Backend flow |
| --- | --- | --- |
| `POST /api/bff/auth/login` | `src/app/api/bff/auth/login/route.ts` | `src/backend/auth/email-login.ts` |
| `POST /api/bff/auth/register` | `src/app/api/bff/auth/register/route.ts` | `src/backend/auth/email-register.ts` |
| `GET /api/bff/auth/me` | `src/app/api/bff/auth/me/route.ts` | `src/backend/auth/profile.ts` |
| `POST /api/bff/auth/logout` | `src/app/api/bff/auth/logout/route.ts` | `src/backend/sessions/web-session.ts` |
| `POST /api/bff/auth/identify` | `src/app/api/bff/auth/identify/route.ts` | Inline route flow using `src/backend/database`, `src/backend/limits` |
| `POST /api/bff/auth/change-password` | `src/app/api/bff/auth/change-password/route.ts` | `src/backend/auth/password.ts` |

## E-mail

| Endpoint | Route file | Backend flow |
| --- | --- | --- |
| `POST /api/bff/auth/email/request-verification` | `src/app/api/bff/auth/email/request-verification/route.ts` | `src/backend/auth/email-verification.ts` |
| `POST /api/bff/auth/email/confirm` | `src/app/api/bff/auth/email/confirm/route.ts` | `src/backend/auth/email-verification.ts` |
| `POST /api/bff/auth/email/change` | `src/app/api/bff/auth/email/change/route.ts` | `src/backend/auth/email-verification.ts` |

## Passkeys

| Endpoint | Route file | Backend flow |
| --- | --- | --- |
| `POST /api/bff/auth/passkey/register/options` | `src/app/api/bff/auth/passkey/register/options/route.ts` | `src/backend/auth/passkeys.ts` |
| `POST /api/bff/auth/passkey/register/verify` | `src/app/api/bff/auth/passkey/register/verify/route.ts` | `src/backend/auth/passkeys.ts` |
| `POST /api/bff/auth/passkey/login/options` | `src/app/api/bff/auth/passkey/login/options/route.ts` | `src/backend/auth/passkeys.ts` |
| `POST /api/bff/auth/passkey/login/verify` | `src/app/api/bff/auth/passkey/login/verify/route.ts` | `src/backend/auth/passkeys.ts` |
| `GET /api/bff/auth/passkey/credentials` | `src/app/api/bff/auth/passkey/credentials/route.ts` | `src/backend/auth/passkeys.ts` |
| `DELETE /api/bff/auth/passkey/credentials/[id]` | `src/app/api/bff/auth/passkey/credentials/[id]/route.ts` | `src/backend/auth/passkeys.ts` |

## Remnashop Link And Telegram

| Endpoint | Route file | Backend flow |
| --- | --- | --- |
| `POST /api/bff/link/remnashop` | `src/app/api/bff/link/remnashop/route.ts` | `src/backend/auth/remnashop-link.ts` |
| `GET /auth/telegram/start` | `src/app/auth/telegram/start/route.ts` | `src/backend/integrations/telegram/oidc.ts` |
| `GET /auth/telegram/callback` | `src/app/auth/telegram/callback/route.ts` | `src/backend/integrations/telegram/oidc.ts`, `src/backend/integrations/remnashop/session.ts` |
| `GET /auth/telegram/webapp` | `src/app/auth/telegram/webapp/page.tsx` | `src/frontend/components/telegram-webapp-login.tsx` |
| `POST /api/bff/auth/telegram/webapp` | `src/app/api/bff/auth/telegram/webapp/route.ts` | `src/backend/integrations/remnashop/client.ts`, `src/backend/integrations/remnashop/session.ts` |
| `GET /api/bff/auth/telegram/merge-confirmation` | `src/app/api/bff/auth/telegram/merge-confirmation/route.ts` | `src/backend/auth/telegram-account-merge.ts` |
| `POST /api/bff/auth/telegram/merge-confirmation` | `src/app/api/bff/auth/telegram/merge-confirmation/route.ts` | `src/backend/auth/telegram-account-merge.ts` |
| `DELETE /api/bff/auth/telegram/merge-confirmation` | `src/app/api/bff/auth/telegram/merge-confirmation/route.ts` | `src/backend/auth/telegram-account-merge.ts` |

## Plans, Subscription, Payments

| Endpoint | Route file | Backend flow |
| --- | --- | --- |
| `GET /api/bff/plans/public` | `src/app/api/bff/plans/public/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `GET /api/bff/subscription/current` | `src/app/api/bff/subscription/current/route.ts` | `src/backend/integrations/remnashop/client.ts`, `src/backend/integrations/remnawave/client.ts` |
| `GET /api/bff/subscription/offers` | `src/app/api/bff/subscription/offers/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `POST /api/bff/subscription/purchase` | `src/app/api/bff/subscription/purchase/route.ts` | `src/backend/payments/request-validation.ts`, `src/backend/payments/return-url.ts`, `src/backend/payments/idempotency.ts`, `src/backend/payments/operation-response.ts`, `src/backend/payments/records.ts`, `src/backend/integrations/remnashop/client.ts` |
| `POST /api/bff/subscription/extend` | `src/app/api/bff/subscription/extend/route.ts` | `src/backend/payments/request-validation.ts`, `src/backend/payments/return-url.ts`, `src/backend/payments/idempotency.ts`, `src/backend/payments/operation-response.ts`, `src/backend/payments/records.ts`, `src/backend/integrations/remnashop/client.ts` |
| `POST /api/bff/subscription/reissue` | `src/app/api/bff/subscription/reissue/route.ts` | `src/backend/integrations/remnashop/client.ts`, `src/backend/observability/mutation-audit.ts` |
| `POST /api/bff/subscription/promocode` | `src/app/api/bff/subscription/promocode/route.ts` | `src/backend/integrations/remnashop/client.ts`, `src/backend/observability/mutation-audit.ts` |
| `GET /api/bff/subscription/devices` | `src/app/api/bff/subscription/devices/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `DELETE /api/bff/subscription/devices` | `src/app/api/bff/subscription/devices/route.ts` | `src/backend/integrations/remnashop/client.ts`, `src/backend/observability/mutation-audit.ts` |
| `DELETE /api/bff/subscription/devices/[hwid]` | `src/app/api/bff/subscription/devices/[hwid]/route.ts` | `src/backend/integrations/remnashop/client.ts`, `src/backend/observability/mutation-audit.ts` |
| `GET /api/bff/payments/history` | `src/app/api/bff/payments/history/route.ts` | `src/backend/payments/history-sync.ts`, `src/backend/payments/owner.ts`, `src/backend/payments/records.ts` |
| `GET /api/bff/payments/status` | `src/app/api/bff/payments/status/route.ts` | `src/backend/payments/history-sync.ts`, `src/backend/payments/reconciliation.ts`, `src/backend/payments/manual-review.ts`, `src/backend/payments/owner.ts`, `src/backend/payments/records.ts` |

`purchase` and `extend` require a UUID `Idempotency-Key` plus the offer snapshot fields `confirmed_amount`, `confirmed_currency`, and `offer_version` returned/derived from the selected `/subscription/offers` entry. Clean Pay rechecks that snapshot immediately before dispatch; a changed offer returns `409 OFFER_CHANGED` and no invoice is created. The same key is bound to one user, operation kind, normalized request payload, and offer snapshot. A completed replay returns the original `200` payload with `Idempotency-Replayed: true`; an active or fail-closed unknown outcome returns `202` with `operation_id`, `status`, and `retry_after_seconds`. Clients must retain the same key after transport errors, malformed success responses, `202`, `408`, `429`, and `5xx` responses.

Payment history negotiates Remnashop recovery contract v1. With v1 it applies one keyset page and its owner-bound cursor atomically, creates missing local records, preserves upstream timestamps, and rejects cross-user `payment_id` collisions. A legacy Remnashop falls back to its validated 20-row response without guessing unknown outcomes. Payment status uses the v1 exact lookup for a requested UUID, so old payments are not limited to the first history page.

`OUTCOME_UNKNOWN` operations use a separate fenced reconciliation lease. A successful recovery atomically settles the operation and its `PaymentRecord`; `MANUAL_REQUIRED` remains fail-closed. A durable upstream `404` proves that the operation never crossed the dispatch boundary and safely resets the local operation to `READY` with the same upstream key.

## Support And Health

| Endpoint | Route file | Backend flow |
| --- | --- | --- |
| `GET /api/bff/support` | `src/app/api/bff/support/route.ts` | `src/backend/config/env.ts` |
| `GET /api/health` | `src/app/api/health/route.ts` | Inline route response |
| `GET /api/health/liveness` | `src/app/api/health/liveness/route.ts` | Inline route response |
| `GET /api/health/readiness` | `src/app/api/health/readiness/route.ts` | `src/backend/health/readiness.ts` cached aggregate |
| `GET /api/me` | `src/app/api/me/route.ts` | `src/backend/sessions/web-session.ts` |
| `POST /api/logout` | `src/app/api/logout/route.ts` | `src/backend/sessions/web-session.ts` |

## Internal Operations

| Endpoint | Route file | Backend flow |
| --- | --- | --- |
| `GET /api/internal/health/readiness` | `src/app/api/internal/health/readiness/route.ts` | `src/backend/health/readiness.ts`, `src/backend/health/checks.ts` |
| `POST /api/internal/payments/reconcile` | `src/app/api/internal/payments/reconcile/route.ts` | `src/backend/payments/reconciliation.ts`, `src/backend/payments/history-sync.ts` |

The internal detailed readiness endpoint requires the timing-safe `X-Clean-Pay-Readiness-Secret`, performs a single-flight bounded dependency fan-out and refreshes the process-local public cache. Invalid secrets return `404`. The internal reconciliation endpoint is disabled by default and returns `404` unless `PAYMENT_RECONCILIATION_ENABLED=true`. It requires the fixed-length timing-safe `X-Clean-Pay-Reconciliation-Secret`, enforces a bounded batch/deadline, and is called by the Compose `reconciliation` profile. The supported launchers enable that profile automatically when the flag is true and verify that its worker is running. History work uses complete bounded cursor generations; payment recovery resets an exact missing claim only with the same locked owner, while owner ambiguity becomes terminal `manual_required`. Never expose internal routes or secrets to a browser.
