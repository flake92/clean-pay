# API Endpoint Flow Map

Every endpoint starts in `src/app/api/**/route.ts`. Route files should stay thin:

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

## Plans, Subscription, Payments

| Endpoint | Route file | Backend flow |
| --- | --- | --- |
| `GET /api/bff/plans/public` | `src/app/api/bff/plans/public/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `GET /api/bff/subscription/current` | `src/app/api/bff/subscription/current/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `GET /api/bff/subscription/offers` | `src/app/api/bff/subscription/offers/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `POST /api/bff/subscription/purchase` | `src/app/api/bff/subscription/purchase/route.ts` | `src/backend/payments/records.ts`, `src/backend/integrations/remnashop/client.ts` |
| `POST /api/bff/subscription/extend` | `src/app/api/bff/subscription/extend/route.ts` | `src/backend/payments/records.ts`, `src/backend/integrations/remnashop/client.ts` |
| `POST /api/bff/subscription/reissue` | `src/app/api/bff/subscription/reissue/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `POST /api/bff/subscription/promocode` | `src/app/api/bff/subscription/promocode/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `GET /api/bff/subscription/devices` | `src/app/api/bff/subscription/devices/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `DELETE /api/bff/subscription/devices` | `src/app/api/bff/subscription/devices/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `DELETE /api/bff/subscription/devices/[hwid]` | `src/app/api/bff/subscription/devices/[hwid]/route.ts` | `src/backend/integrations/remnashop/client.ts` |
| `GET /api/bff/payments/history` | `src/app/api/bff/payments/history/route.ts` | `src/backend/payments/records.ts` |
| `GET /api/bff/payments/status` | `src/app/api/bff/payments/status/route.ts` | `src/backend/payments/records.ts`, `src/backend/integrations/remnashop/client.ts` |

## Support And Health

| Endpoint | Route file | Backend flow |
| --- | --- | --- |
| `GET /api/bff/support` | `src/app/api/bff/support/route.ts` | `src/backend/config/env.ts` |
| `GET /api/health` | `src/app/api/health/route.ts` | Inline route response |
| `GET /api/health/readiness` | `src/app/api/health/readiness/route.ts` | `src/backend/health/checks.ts` |
| `GET /api/me` | `src/app/api/me/route.ts` | `src/backend/sessions/web-session.ts` |
| `POST /api/logout` | `src/app/api/logout/route.ts` | `src/backend/sessions/web-session.ts` |
