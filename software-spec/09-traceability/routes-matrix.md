# Матрица HTTP-маршрутов

Матрица проходит re-baseline 2026-07-23 после перехода на resourceful,
server-rendered Rails. Старые BFF/e2e evidence недействительны; owner означает
единственного владельца операции.

| ID | Method/path | Source | Детальная карточка | Owner | Tests/evidence |
|---|---|---|---|---|---|
| HTTP-001 | POST `/account/identity` | auth/identify route | `http/operations/HTTP-001.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-002 | POST `/account/session` | auth/login route | `http/operations/HTTP-002.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-003 | POST `/account/registration` | auth/register route | `http/operations/HTTP-003.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-004 | GET `/account/session` | auth/me route | `http/operations/HTTP-004.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-005 | DELETE `/account/session` | session resource | `http/operations/HTTP-005.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-006 | PATCH `/account/password` | password resource | `http/operations/HTTP-006.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-007 | POST `/account/email_verification` | email request route | `http/operations/HTTP-007.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-008 | PATCH `/account/email_verification` | email verification resource | `http/operations/HTTP-008.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-009 | PATCH `/account/email` | email resource | `http/operations/HTTP-009.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-010 | POST `/account/passkey_registration` | passkey route | `http/operations/HTTP-010.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-011 | PATCH `/account/passkey_registration` | passkey registration resource | `http/operations/HTTP-011.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-012 | POST `/account/passkey_session` | passkey route | `http/operations/HTTP-012.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-013 | PATCH `/account/passkey_session` | passkey session resource | `http/operations/HTTP-013.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-014 | GET `/account/passkeys` | credentials route | `http/operations/HTTP-014.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-015 | DELETE `/account/passkeys/{id}` | dynamic route | `http/operations/HTTP-015.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-016 | POST `/account/telegram_session` | webapp route | `http/operations/HTTP-016.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-017 | GET `/account/merge_confirmation` | merge route | `http/operations/HTTP-017.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-018 | PATCH same | merge resource | `http/operations/HTTP-018.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-019 | DELETE same | merge route | `http/operations/HTTP-019.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-020 | POST `/account/remnashop_link` | link route | `http/operations/HTTP-020.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-021 | GET `/plans` | plans route | `http/operations/HTTP-021.md` | subscription | ПРОВЕРЕНО В БЛОКЕ 4G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-022 | GET `/subscription` | current route | `http/operations/HTTP-022.md` | subscription | ПРОВЕРЕНО В БЛОКЕ 4G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-023 | GET `/subscription/offers` | offers route | `http/operations/HTTP-023.md` | subscription | ПРОВЕРЕНО В БЛОКЕ 4G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-024 | POST `/purchases` | purchase route | `http/operations/HTTP-024.md` | payments | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| HTTP-025 | POST `/extensions` | extend route | `http/operations/HTTP-025.md` | payments | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| HTTP-026 | POST `/subscription/reissue` | reissue route | `http/operations/HTTP-026.md` | subscription | ПРОВЕРЕНО В БЛОКЕ 4G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-027 | POST `/subscription/promocode` | promo route | `http/operations/HTTP-027.md` | subscription | ПРОВЕРЕНО В БЛОКЕ 4G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-028 | GET `/subscription/devices` | devices route | `http/operations/HTTP-028.md` | subscription | ПРОВЕРЕНО В БЛОКЕ 4G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-029 | DELETE same | devices route | `http/operations/HTTP-029.md` | subscription | ПРОВЕРЕНО В БЛОКЕ 4G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-030 | DELETE `/subscription/devices/{id}` | dynamic route | `http/operations/HTTP-030.md` | subscription | ПРОВЕРЕНО В БЛОКЕ 4G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-031 | GET `/payments` | history route | `http/operations/HTTP-031.md` | payments | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| HTTP-032 | GET `/payments/{id}` | status route | `http/operations/HTTP-032.md` | payments | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| HTTP-033 | GET `/support` | support route | `http/operations/HTTP-033.md` | platform | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| HTTP-034 | GET `/health` | health route | `http/operations/HTTP-034.md` | platform | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| HTTP-035 | GET `/health/liveness` | liveness route | `http/operations/HTTP-035.md` | platform | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| HTTP-036 | GET `/health/readiness` | readiness route | `http/operations/HTTP-036.md` | platform | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| HTTP-037 | GET `/internal/health/readiness` | internal readiness | `http/operations/HTTP-037.md` | platform | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| HTTP-038 | POST `/internal/payment_reconciliations` | reconcile route | `http/operations/HTTP-038.md` | payments | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| HTTP-039 | — | superseded by HTTP-004; alias removed | ADR-003 | identity-access | СНЯТ ПРИ RE-BASELINE |
| HTTP-040 | — | superseded by HTTP-005; alias removed | ADR-003 | identity-access | СНЯТ ПРИ RE-BASELINE |
| HTTP-041 | GET `/account/telegram_authorization/new` | start route | `http/operations/HTTP-041.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-042 | GET `/account/telegram_authorization/callback` | callback route | `http/operations/HTTP-042.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-043 | POST `/account/telegram_authorization/callback` | callback route | `http/operations/HTTP-043.md` | identity-access | ПРОВЕРЕНО В БЛОКЕ 3G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTP-044 | GET `/service-worker.js` | SW route | `http/operations/HTTP-044.md` | platform | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
