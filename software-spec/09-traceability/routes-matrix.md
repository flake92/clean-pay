# Матрица HTTP-маршрутов

Статус каждой строки `описан`; owner означает единственного владельца transport operation. Common proxy/error/cookie rules: `02-interfaces/http/identity.md`, `error-contracts.md`.

| ID | Method/path | Source | Детальная карточка | Owner | Tests/evidence |
|---|---|---|---|---|---|
| HTTP-001 | POST `/api/bff/auth/identify` | auth/identify route | `http/operations/HTTP-001.md` | identity-access | anti-abuse, route handlers; полная карточка подтверждена |
| HTTP-002 | POST `/api/bff/auth/login` | auth/login route | `http/operations/HTTP-002.md` | identity-access | auth use cases/e2e; полная карточка подтверждена |
| HTTP-003 | POST `/api/bff/auth/register` | auth/register route | `http/operations/HTTP-003.md` | identity-access | auth use cases/e2e; полная карточка подтверждена, включая частичный успех письма |
| HTTP-004 | GET `/api/bff/auth/me` | auth/me route | `http/operations/HTTP-004.md` | identity-access | payload/profile/routes; полная карточка подтверждена |
| HTTP-005 | POST `/api/bff/auth/logout` | auth/logout route | `http/operations/HTTP-005.md` | identity-access | routes/proxy; полная карточка подтверждена |
| HTTP-006 | POST `/api/bff/auth/change-password` | change-password route | `http/operations/HTTP-006.md` | identity-access | auth/session use cases; полная карточка подтверждена |
| HTTP-007 | POST `/api/bff/auth/email/request-verification` | email request route | `http/operations/HTTP-007.md` | identity-access | anti-abuse/auth/e2e; полная карточка подтверждена |
| HTTP-008 | POST `/api/bff/auth/email/confirm` | email confirm route | `http/operations/HTTP-008.md` | identity-access | auth/merge/e2e; полная карточка подтверждена |
| HTTP-009 | POST `/api/bff/auth/email/change` | email change route | `http/operations/HTTP-009.md` | identity-access | auth/profile; полная карточка подтверждена, включая частичный успех |
| HTTP-010 | POST `/api/bff/auth/passkey/register/options` | passkey route | `http/operations/HTTP-010.md` | identity-access | passkey/proxy; полная карточка подтверждена |
| HTTP-011 | POST `/api/bff/auth/passkey/register/verify` | passkey route | `http/operations/HTTP-011.md` | identity-access | passkey; полная карточка подтверждена |
| HTTP-012 | POST `/api/bff/auth/passkey/login/options` | passkey route | `http/operations/HTTP-012.md` | identity-access | passkey/rate; полная карточка подтверждена |
| HTTP-013 | POST `/api/bff/auth/passkey/login/verify` | passkey route | `http/operations/HTTP-013.md` | identity-access | passkey/concurrency; полная карточка подтверждена |
| HTTP-014 | GET `/api/bff/auth/passkey/credentials` | credentials route | `http/operations/HTTP-014.md` | identity-access | passkey; полная карточка подтверждена |
| HTTP-015 | DELETE `/api/bff/auth/passkey/credentials/{id}` | dynamic route | `http/operations/HTTP-015.md` | identity-access | passkey deletion PG; полная карточка подтверждена |
| HTTP-016 | POST `/api/bff/auth/telegram/webapp` | webapp route | `http/operations/HTTP-016.md` | identity-access | Telegram WebApp; полная карточка подтверждена |
| HTTP-017 | GET `/api/bff/auth/telegram/merge-confirmation` | merge route | `http/operations/HTTP-017.md` | identity-access | merge route/service; исправлена точная схема ответа |
| HTTP-018 | POST same | merge route | `http/operations/HTTP-018.md` | identity-access | merge PG; полная карточка подтверждена |
| HTTP-019 | DELETE same | merge route | `http/operations/HTTP-019.md` | identity-access | merge route; полная карточка подтверждена |
| HTTP-020 | POST `/api/bff/link/remnashop` | link route | `http/operations/HTTP-020.md` | identity-access | auth/merge; полная карточка подтверждена |
| HTTP-021 | GET `/api/bff/plans/public` | plans route | `http/operations/HTTP-021.md` | subscription | полная карточка; route/e2e |
| HTTP-022 | GET `/api/bff/subscription/current` | current route | `http/operations/HTTP-022.md` | subscription | полная карточка; URL-source/Remnawave |
| HTTP-023 | GET `/api/bff/subscription/offers` | offers route | `http/operations/HTTP-023.md` | subscription | полная карточка; routes/frontend |
| HTTP-024 | POST `/api/bff/subscription/purchase` | purchase route | `http/operations/HTTP-024.md` | payments | полная карточка; idempotency/rate/e2e |
| HTTP-025 | POST `/api/bff/subscription/extend` | extend route | `http/operations/HTTP-025.md` | payments | полная карточка; idempotency/rate/e2e |
| HTTP-026 | POST `/api/bff/subscription/reissue` | reissue route | `http/operations/HTTP-026.md` | subscription | полная карточка; mutation audit/routes |
| HTTP-027 | POST `/api/bff/subscription/promocode` | promo route | `http/operations/HTTP-027.md` | subscription | полная карточка; routes/e2e |
| HTTP-028 | GET `/api/bff/subscription/devices` | devices route | `http/operations/HTTP-028.md` | subscription | полная карточка; routes/e2e |
| HTTP-029 | DELETE same | devices route | `http/operations/HTTP-029.md` | subscription | полная карточка; mutation/routes |
| HTTP-030 | DELETE `/api/bff/subscription/devices/{hwid}` | dynamic route | `http/operations/HTTP-030.md` | subscription | полная карточка; routes/e2e |
| HTTP-031 | GET `/api/bff/payments/history` | history route | `http/operations/HTTP-031.md` | payments | полная карточка; history/recovery |
| HTTP-032 | GET `/api/bff/payments/status` | status route | `http/operations/HTTP-032.md` | payments | полная карточка; reconciliation/status |
| HTTP-033 | GET `/api/bff/support` | support route | `http/operations/HTTP-033.md` | platform | полная карточка; routes/frontend |
| HTTP-034 | GET `/api/health` | health route | `http/operations/HTTP-034.md` | platform | полная карточка; health |
| HTTP-035 | GET `/api/health/liveness` | liveness route | `http/operations/HTTP-035.md` | platform | полная карточка; health/e2e |
| HTTP-036 | GET `/api/health/readiness` | readiness route | `http/operations/HTTP-036.md` | platform | полная карточка; health/routes |
| HTTP-037 | GET `/api/internal/health/readiness` | internal readiness | `http/operations/HTTP-037.md` | platform | полная карточка; health/compose |
| HTTP-038 | POST `/api/internal/payments/reconcile` | reconcile route | `http/operations/HTTP-038.md` | payments | полная карточка; route/reconciliation |
| HTTP-039 | GET `/api/me` | legacy me route | `http/operations/HTTP-039.md` | identity-access | полная карточка; e2e matrix |
| HTTP-040 | POST `/api/logout` | legacy logout | `http/operations/HTTP-040.md` | platform | полная карточка; e2e matrix |
| HTTP-041 | GET `/auth/telegram/start` | start route | `http/operations/HTTP-041.md` | identity-access | полная карточка; redirect/OIDC |
| HTTP-042 | GET `/auth/telegram/callback` | callback route | `http/operations/HTTP-042.md` | identity-access | полная карточка; callback/OIDC |
| HTTP-043 | POST `/auth/telegram/callback` | callback route | `http/operations/HTTP-043.md` | identity-access | полная карточка; popup + widget |
| HTTP-044 | GET `/sw.js` | SW route | `http/operations/HTTP-044.md` | platform | полная карточка; SW/privacy tests |
