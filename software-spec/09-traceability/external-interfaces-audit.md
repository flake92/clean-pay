# Аудит интерфейсов внешних сервисов

## Метод проверки

Каждый внешний интерфейс проверяется по независимым источникам:

1. фактическое формирование запроса в Clean Pay;
2. runtime-разбор ответа и влияние на состояние;
3. схема/обработчик зафиксированного совместимого commit Remnashop, если сервис — Remnashop;
4. unit/integration/e2e test evidence;
5. Compose/env/mock topology.

Зафиксированный upstream Remnashop: commit `b9da68a651e9ab0b7ed52d030e13754311614759`, тот же, который используется build context dev-среды. Пути `upstream:` ниже относятся к этому commit и не являются зависимостью нормативной спецификации.

## Remnashop: построчная трассируемость

| ID | Method/path | Формирование Clean Pay | Upstream handler/schema | Проверки в проекте | Статическая сверка |
|---|---|---|---|---|---|
| RS-001 | POST `/auth/register` | `src/backend/auth/email-register.ts` | upstream:`src/web/endpoints/public/auth.py`, `src/web/schemas/auth.py` | auth use-cases, client, e2e full-stack | transport/schema/branch подтверждены |
| RS-002 | POST `/auth/login` | `src/backend/auth/email-login.ts`, registration resume, Remnashop link | те же auth handler/schema | auth use-cases, client, routes, e2e | подтверждено |
| RS-003 | POST `/auth/telegram` | Telegram OIDC и token recovery в `src/backend/integrations/` | upstream auth handler/schema | Telegram OIDC/merge/recovery tests | подтверждено |
| RS-004 | POST `/auth/telegram/webapp` | `src/app/api/bff/auth/telegram/webapp/route.ts` | upstream auth handler/schema | BFF routes, WebApp tests, e2e matrix | подтверждено |
| RS-005 | POST `/auth/refresh` | `src/backend/integrations/remnashop/client.ts` | upstream auth/session use-case | session token lifecycle/refresh rotation tests | подтверждено; literal-path test не является единственным evidence |
| RS-006 | POST `/auth/change-password` | client + password use-case | upstream auth handler/schema | auth use-cases, client, routes | подтверждено |
| RS-007 | GET `/auth/me` | client, session linking/recovery | upstream auth handler/schema | client/session/merge tests | подтверждено |
| RS-008 | POST `/auth/telegram/link` | client, email confirm и callback | upstream auth handler/schema | Telegram/account-link tests | подтверждено |
| RS-009 | POST `/auth/email/request-verification` | `src/backend/auth/email-verification.ts` | upstream auth handler, email use-case, SMTP sender | auth use-cases, e2e email flow | подтверждено, включая retry policy |
| RS-010 | POST `/auth/email/confirm` | email verification use-case | upstream auth handler/schema | auth use-cases, e2e email flow | подтверждено, включая partial success |
| RS-011 | POST `/auth/email/change` | email verification use-case | upstream auth handler/schema | auth use-cases, routes, e2e | подтверждено |
| RS-012 | GET `/plans/public` | BFF route и readiness check | upstream:`src/web/endpoints/public/plans.py`, plans schema | client, health, BFF route, e2e | подтверждено |
| RS-013 | GET `/subscription/current` | current route, payment status, merge | upstream subscription handler/schema | routes, errors, merge, full-stack | подтверждено |
| RS-014 | GET `/subscription/offers` | offers route и pre-dispatch recheck | upstream subscription handler/schema | frontend/payment/routes/e2e | подтверждено |
| RS-015 | POST `/subscription/purchase` | purchase route | upstream subscription handler/schema/idempotency | payment request/recovery/idempotency tests | подтверждено |
| RS-016 | POST `/subscription/extend` | extend route | upstream subscription handler/schema/idempotency | payment request/recovery/idempotency tests | подтверждено |
| RS-017 | POST `/subscription/reissue` | reissue route | upstream subscription handler | BFF routes/e2e | подтверждено |
| RS-018 | POST `/subscription/promocode` | promocode route | upstream subscription handler/schema | BFF routes/error mapper/e2e | подтверждено |
| RS-019 | GET `/subscription/devices` | devices route | upstream subscription handler/schema | BFF routes/e2e | подтверждено |
| RS-020 | DELETE `/subscription/devices` | devices route | upstream subscription handler/schema | BFF routes/e2e | подтверждено |
| RS-021 | DELETE `/subscription/devices/{hwid}` | nested device route | upstream subscription handler/schema | BFF routes/proxy/e2e | подтверждено, включая encodeURIComponent |
| RS-022 | GET `/subscription/capabilities` | payment recovery client | upstream subscription handler/schema | recovery contract/client tests | подтверждено |
| RS-023 | GET `/subscription/transactions/page` | payment recovery/history sync | upstream subscription handler/schema/cursor service | recovery contract/history tests | подтверждено |
| RS-024 | GET `/subscription/transactions/by-id/{id}` | payment recovery client | upstream subscription handler/schema | recovery contract/client tests | подтверждено |
| RS-025 | GET `/subscription/transactions` | legacy history fallback | upstream subscription handler/schema | recovery/history tests | подтверждено |
| RS-026 | GET `/subscription/payment-operations/{operation}` | payment recovery client | upstream subscription reconciliation handler | recovery client/reconciliation tests | подтверждено |
| RS-027 | POST `/subscription/payment-operations/{operation}` | payment recovery client | upstream subscription reconciliation handler | recovery client/reconciliation tests | подтверждено; не склеивать с RS-026 |
| RS-028 | POST `/users/merge?dry_run=...` | Remnashop merge client | upstream:`src/web/endpoints/admin/users.py`, admin schema | client/Telegram merge tests | подтверждено |
| RS-029 | GET `/payment-operations/{operation}?user_id=...` | admin recovery client | upstream:`src/web/endpoints/admin/payment_operations.py` | recovery/client/reconciliation tests | подтверждено |
| RS-030 | POST `/payment-operations/{operation}?user_id=...` | admin recovery client | тот же upstream handler | recovery/client/reconciliation tests | подтверждено; не склеивать с RS-029 |

## Другие прямые внешние интерфейсы

| IDs | Источник формирования | Runtime response handling | Mock/config evidence | Статическая сверка |
|---|---|---|---|---|
| TG-001…003 | `src/backend/integrations/telegram/oidc.ts` | JWT issuer/audience/nonce/claims, callback state | env defaults, OIDC mock, Telegram tests | подтверждено |
| TG-006 | `src/frontend/lib/telegram-webapp.ts` | `window.Telegram.WebApp`, initData/openLink | WebApp mock environment and frontend tests | подтверждено |
| RW-001…004 | `src/backend/integrations/remnawave/client.ts`, health checks | identity/ACTIVE/expiry/ambiguity filtering | Remnawave mock, client/health tests | подтверждено |
| TS-000…001 | Turnstile widget + backend verifier | token callbacks, hostname match, error mapping | env rules, security tests | подтверждено |
| MP-001 | health check | status only | Mailpit Compose/e2e | подтверждено |
| REDIS-001…005 | Redis adapter/callers | strict RESP parsing/deadlines | Redis unit/integration tests, Compose | подтверждено |
| SUP-001…003 | support frontend links | browser navigation only | support BFF/config | подтверждено |

## Косвенные интерфейсы

| IDs | Первичный источник | Дополнительное подтверждение | Статическая сверка |
|---|---|---|---|
| SMTP-001 | pinned upstream email config/sender/use-case | dev Compose Mailpit, README production SMTP | подтверждено |
| MP-002…003 | `.devcontainer/mailpit-logger/server.js` | Mailpit Compose webhook config | подтверждено |
| BOT-001 | pinned upstream bot config/aiogram integration | `telegram-mock` + Compose `BOT_API_BASE_URL` | граница и mock подтверждены |
| PAY-001…003 | pinned upstream gateway clients/webhook | Clean Pay payment/recovery contracts | gateway set, endpoints и ownership подтверждены |
| REMNA-IND-001 | pinned upstream Remnawave integration/config | full-stack Compose topology | ownership подтверждено |

## Динамическая проверка

Зафиксированные зависимости установлены. На текущем срезе успешно выполнены:

- typecheck;
- lint;
- 67 unit-файлов, 475 тестов;
- 2 route-handler файла, 44 теста;
- production build со всеми 44 HTTP-операциями и 19 страницами;
- запуск полной Docker-топологии, применение 15 миграций на чистой dev-базе;
- реальная цепочка регистрация → SMTP → Mailpit → шестизначный код → bootstrap → Passkey skip → кабинет → выход;
- браузерный рендер 19 desktop + 19 mobile эталонов действующего приложения;
- браузерный рендер 19 desktop + 19 mobile сцен автономного макета без page errors и горизонтального overflow.

Повторная динамическая проверка завершена: integration-набор с реальными PostgreSQL/Redis прошёл 58/58, полный full-stack E2E без сброса общих данных — 104/104. Подробности и осознанные ограничения production provider/disaster-recovery rehearsal записаны в `verification-report.md`. Полевая спецификация внешних интерфейсов завершена; разрешение на удаление определяется отдельным отчётом и явным подтверждением пользователя.
