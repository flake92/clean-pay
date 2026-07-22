# Инвентаризация источников

## Срез и метод

Идентификатор: `INV-2026-07-22-01`.

В manifest включено 340 файлов и 173 каталога исходного дерева. Исключены только Git internals, generated/runtime output, IDE metadata и сам каталог спецификации. Полный список: [`source-tree-manifest.md`](source-tree-manifest.md).

Инвентаризация выполнена по фактической структуре, экспортам HTTP methods, вызовам `fetch`, Prisma schema/migrations, Compose/launcher scripts, frontend pages/components и тестам. Итоговое покрытие каждого класса источника подтверждено matrices этого раздела.

## Приложение, пакеты и точки запуска

| ID | Элемент | Назначение | Источник |
|---|---|---|---|
| APP-001 | Next.js web application | SSR/React UI и route handlers | `package.json`, `src/app/**` |
| APP-002 | Edge request policy | auth gating, redirects, CSRF/source/media-type checks, request logging | `src/proxy.ts` |
| APP-003 | Production web process | env validation, migration startup, `next start` на `0.0.0.0:4000` | `package.json`, `deploy/prod/start.sh` |
| APP-004 | Root launcher | standalone/remnashop Compose modes, secrets, verify/logs lifecycle | `start.sh` |
| APP-005 | Production launcher | init/up/down/restart/backup/restore/update operations | `deploy.sh`, `deploy/prod/prod.mjs` |
| APP-006 | Retention worker | периодическая очистка служебных данных | `deploy/prod/retention-loop.mjs` |
| APP-007 | Reconciliation worker | периодический вызов внутренней сверки платежей | `deploy/prod/reconcile-loop.mjs` |
| APP-008 | E2E/devcontainer runner | поднимает полный mock stack и запускает tests | `scripts/e2e-devcontainer.*`, `.devcontainer/**` |

## Пакеты и среда выполнения

- Node.js 24 используется в Docker images.
- Next.js 16.2.9, React 19.2.4.
- Prisma 7.8 с PostgreSQL adapter.
- PrimeReact/PrimeFlex/PrimeIcons для UI.
- `jose` для Telegram OIDC/JWT verification.
- SimpleWebAuthn browser/server для passkeys.
- Vitest 4.1.9 для unit/integration/e2e.
- Источник: `package.json`, lock-файлы, Dockerfiles.

## HTTP-интерфейсы

Обнаружено 40 route-файлов и 44 экспортированных HTTP-метода. Полный реестр: [`../02-interfaces/http-api.md`](../02-interfaces/http-api.md).

| Группа | Количество операций |
|---|---:|
| `/api/bff/auth/**` | 19 |
| `/api/bff/link/**` | 1 |
| `/api/bff/subscription/**` | 9 |
| `/api/bff/payments/**` | 2 |
| `/api/bff/plans/**` и `/api/bff/support` | 2 |
| health/internal/compatibility API | 7 |
| Telegram OIDC routes | 3 |
| service worker | 1 |
| **Всего** | **44** |

Контрольные источники: `src/app/**/route.ts`, `src/app/api/ENDPOINTS.md`, `src/proxy.ts`, `tests/e2e/full-stack/endpoint-matrix.ts`, route-handler tests.

## Маршруты пользовательского интерфейса

| ID | Route | Назначение | Источник |
|---|---|---|---|
| PAGE-001 | `/` | обзор возможностей и навигация | `src/app/page.tsx` |
| PAGE-002 | `/login` | identify/login/conditional registration, Telegram/passkey | `src/app/login/page.tsx` |
| PAGE-003 | `/register` | e-mail registration | `src/app/register/page.tsx` |
| PAGE-004 | `/register/verify-email` | подтверждение регистрации кодом | `src/app/register/verify-email/page.tsx` |
| PAGE-005 | `/verify-email` | подтверждение e-mail существующей сессии | `src/app/verify-email/page.tsx` |
| PAGE-006 | `/auth/telegram/webapp` | Telegram WebApp login | `src/app/auth/telegram/webapp/page.tsx` |
| PAGE-007 | `/passkey/setup` | обязательный экран bootstrap-сессии/необязательная настройка | `src/app/passkey/setup/page.tsx` |
| PAGE-008 | `/cabinet` | подписка, подключение, устройства, платежи | `src/app/cabinet/page.tsx` |
| PAGE-009 | `/tariffs` | offers, plan/duration/gateway selection | `src/app/tariffs/page.tsx` |
| PAGE-010 | `/payment` | подтверждение покупки | `src/app/payment/page.tsx` |
| PAGE-011 | `/extend` | подтверждение продления | `src/app/extend/page.tsx` |
| PAGE-012 | `/payment/success` | возврат success | `src/app/payment/success/page.tsx` |
| PAGE-013 | `/payment/fail` | возврат fail | `src/app/payment/fail/page.tsx` |
| PAGE-014 | `/payment/pending` | возврат pending | `src/app/payment/pending/page.tsx` |
| PAGE-015 | `/profile` | профиль, e-mail и пароль | `src/app/profile/page.tsx` |
| PAGE-016 | `/link-account` | способы входа, merge, passkeys | `src/app/link-account/page.tsx` |
| PAGE-017 | `/support` | контакты поддержки | `src/app/support/page.tsx` |
| PAGE-018 | `/install` | установка PWA | `src/app/install/page.tsx` |
| PAGE-019 | `/offline` | offline fallback | `src/app/offline/page.tsx` |

## Формы и действия

| ID | Группа действий | Источники |
|---|---|---|
| FORM-001 | identify, login, conditional/explicit registration | `src/frontend/components/auth-forms.tsx` |
| FORM-002 | request/resend/confirm e-mail verification | `register-email-confirm-form.tsx`, `verify-email-panel.tsx` |
| FORM-003 | change e-mail, change password | `profile-panel.tsx` |
| FORM-004 | passkey login/register/name/list/delete/skip | `passkey-actions.tsx`, `link-account-panel.tsx` |
| FORM-005 | Telegram OIDC/WebApp login and relink | `auth-forms.tsx`, `telegram-webapp-login.tsx`, `link-account-panel.tsx` |
| FORM-006 | link Remnashop e-mail account, confirm/cancel Telegram merge | `link-account-panel.tsx` |
| FORM-007 | select plan/duration/gateway, purchase, extend | `tariffs-panel.tsx`, `payment-confirmation.tsx`, `extend-confirmation.tsx` |
| FORM-008 | delete device/all devices, reissue, promo | `cabinet-panel.tsx` |
| FORM-009 | refresh payment return status | `payment-return-status.tsx` |
| FORM-010 | PWA install and platform-specific guides | `install-app-button.tsx`, `ios-install-guide.tsx` |

## Хранилища и данные

Prisma schema содержит 15 моделей и 9 enum; 15 SQL migrations описывают эволюцию физической схемы.

| Область | Модели |
|---|---|
| Identity/session | `WebUser`, `WebSession`, `WebRefreshToken` |
| One-time auth | `TelegramAuthState`, `EmailVerificationCode`, `WebAuthnChallenge`, `WebAuthnCredential`, `AccountMergeConfirmation` |
| Payments | `PaymentOperation`, `PaymentRecord`, `PaymentHistorySyncState` |
| Operations | `AuditLog`, `RateLimitEvent`, `AppSetting`, `IntegrationStatus` |

PostgreSQL — durable store. Redis — custom RESP client для rate/cache/readiness paths. Browser storage используется для payment idempotency/return correlation и PWA caches. Источники: `prisma/schema.prisma`, migrations, `src/backend/cache/redis.ts`, frontend storage helpers, service worker.

## Внешние интеграции

| ID | Система | Направления | Источник |
|---|---|---|---|
| INT-001 | Remnashop public API | auth, e-mail, profile, plans, offers, subscription, devices, promo, payments/history/recovery | `src/backend/integrations/remnashop/**` |
| INT-002 | Remnashop admin API | user merge, owner-bound payment recovery | тот же |
| INT-003 | Remnawave | live subscription URL lookup, readiness metadata | `remnawave/client.ts`, health checks |
| INT-004 | Telegram OIDC | authorization redirect, token exchange, JWKS verification | `telegram/oidc.ts` |
| INT-005 | Telegram WebApp/Bot identity | signed init data and bot-signed Remnashop identity | Telegram/Remnashop modules |
| INT-006 | Cloudflare Turnstile | anti-abuse verification | `security/turnstile.ts` |
| INT-007 | Mailpit | optional readiness and e2e mailbox inspection | health/e2e/mock logger |
| INT-008 | PostgreSQL | durable application state | Prisma/database modules |
| INT-009 | Redis | rate/cache coordination | Redis/rate-limit/readiness modules |

## Фоновые процессы

| ID | Процесс | Schedule | Эффект | Источник |
|---|---|---|---|---|
| JOB-001 | Retention cleanup | loop, default 21600 s, range 300–86400 | удаление просроченных auth state, old sessions, audit/rate events; payment records не удаляются | `retention-loop.mjs`, `retention-cleanup.mjs` |
| JOB-002 | Payment reconciliation | feature-gated loop, default 30 s, range 5–3600 | POST internal endpoint, bounded batch, heartbeat, retry next interval | `reconcile-loop.mjs`, internal route |
| JOB-003 | Public readiness refresh | on-demand internal readiness call, process-local single-flight/cache | dependency fan-out и обновление public snapshot | `health/readiness.ts` |

Message broker, incoming webhook receiver и cron expression не обнаружены.

## Конфигурация и развёртывание

- Runtime application env: `src/backend/config/env.ts`.
- Strict production validation: `deploy/prod/production-env-rules.mjs`.
- Root and production `.env.example`.
- Local/production/devcontainer Compose variants.
- Security headers/build ID: `next.config.ts`.
- CI: `.github/workflows/ci.yml`.
- Backup/restore/update/migration procedures: `deploy/prod/prod.mjs`, runbooks.

## Тесты, фикстуры и имитаторы

| Категория | Количество/состав |
|---|---|
| Unit | 67 test files |
| Integration | 8 test files |
| E2E | 1 full-stack test file + endpoint matrix/setup |
| Mocks | Telegram API, Telegram OIDC, Remnawave, Mailpit logger, Remnashop pinned build |

Отдельного fixture directory не обнаружено; данные задаются непосредственно в tests/mock servers.

## Документация как проверяемый источник

`README.md`, `README.ru_RU.md`, `src/app/api/ENDPOINTS.md` и шесть документов `docs/**`. Документационные утверждения не считаются фактическим контрактом без сверки с кодом/tests.

## Результат

Все видимые классы источников включены в manifest, классифицированы и связаны с финальными разделами спецификации. Исходники сохранены.
