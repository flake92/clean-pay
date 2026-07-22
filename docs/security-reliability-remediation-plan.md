# План исправления security & reliability backlog Clean Pay

**Дата:** 20 июля 2026 г.
**Статус:** пункты 1–10 реализованы и покрыты тестами; тестовый production-like rollout завершён с новыми secrets, миграцией refresh-token family и внешней HTTPS-проверкой.

## Результат выполнения

- Полный unit/route suite: 64 файла, 486 тестов — успешно.
- Full-stack E2E в devcontainer: 104 из 104 сценариев — успешно.
- PostgreSQL concurrency suite для удаления passkey, WebAuthn CAS, refresh rotation и сценариев account merge/recovery: 4 файла, 8 тестов — успешно на настоящем PostgreSQL со всеми 15 миграциями.
- TypeScript typecheck, ESLint, production build, production env validator и `git diff --check` — успешно. ESLint сохранил только ранее существовавшее предупреждение об ignored coverage artifact.
- На тестовом сервере app, PostgreSQL, Redis и retention worker находятся в состоянии healthy; detailed readiness подтвердил database, Redis, Remnashop, Telegram OIDC и Remnawave.
- Публичные health/liveness/readiness, login, registration и public plans отвечают успешно через валидный HTTPS. Internal detailed readiness без секрета возвращает `404`.
- На конечном HTTPS-ответе подтверждены enforcing CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` и `Permissions-Policy`; HTTP перенаправляется на HTTPS.
- Реальная платёжная операция и поздний refresh-token reuse намеренно не инициировались на общем стенде. Их инварианты проверены unit/integration/fault-model тестами; платёжный fault injection допускается только на disposable provider stub согласно design document.

## Приоритетный порядок реализации

### Phase 1 — высокий приоритет

#### 1. Redis timeouts & hanging protection

- Добавить connect timeout: 2 секунды.
- Добавить общий deadline команды, включая `AUTH`, `SELECT` и основную команду: 3 секунды.
- Ограничить размер RESP-буфера значением 1 МБ.
- При timeout, превышении лимита или ошибке протокола вызывать `socket.destroy(error)` и полностью очищать listeners и timers.
- Все transport-, timeout-, Redis protocol- и RESP-limit ошибки преобразовывать в `503 UPSTREAM_UNAVAILABLE`. Не маскировать этим кодом программные ошибки приложения.
- Работать в режиме fail closed, без обхода rate limit при недоступности Redis.
- Значения timeout и лимита хранить как константы кода, а не как environment variables.

Тесты:

- `FakeSocket`, который не отправляет событие `connect`, — connect timeout.
- Локальный TCP-stub, который принимает соединение и не отвечает, — command/read deadline.
- Ответ RESP размером больше 1 МБ — отклонение до неограниченного роста буфера.
- Проверка вызова `destroy()` и отсутствия dangling listeners и timers.
- Проверка преобразования сетевых и протокольных ошибок в `503 UPSTREAM_UNAVAILABLE`.

#### 2. Гонка удаления последнего passkey

- Начать транзакцию PostgreSQL.
- Выполнить `SELECT id FROM "WebUser" WHERE id = ... FOR UPDATE`, сериализуя изменения passkey одного пользователя.
- После получения блокировки найти удаляемый credential и проверить его принадлежность текущему пользователю.
- После получения блокировки заново посчитать credentials пользователя.
- Если credential отсутствует или не принадлежит пользователю, вернуть `404 Not Found`.
- Если credential является последним, сохранить текущий контракт и вернуть `403 Forbidden`.
- В остальных случаях удалить credential и завершить транзакцию.
- UI после `403` должен повторно загрузить список passkey.
- Вынести DB-инвариант в отдельный helper, принимающий `userId` и `credentialId`, чтобы PostgreSQL concurrency test не зависел от Next.js cookies и request context.

Тест:

- Интеграционный тест с настоящим PostgreSQL и двумя параллельными удалениями разных credentials.
- Результат: один запрос успешен, второй получает `403`, у пользователя остаётся ровно один credential.

### Phase 2 — средний приоритет

#### 3. Turnstile policy

- Проверять `success` и точное значение `hostname` из серверного `APP_URL`.
- Использовать новый Turnstile token для каждой операции: resend, confirm и change email.
- Проверять change email до первого upstream mutation.
- Отсутствующий, отклонённый token или несовпадающий hostname возвращает `403 Forbidden`.
- Недоступность Cloudflare, transport error, timeout или malformed response возвращают `503 UPSTREAM_UNAVAILABLE`.
- Не проверять `action` и `cdata`, пока widget явно их не задаёт.
- Не использовать wildcard hostname в production.
- Обновить `ProfilePanel`: сейчас он вызывает `/api/bff/auth/email/request-verification` и `/api/bff/auth/email/change` без Turnstile token и не отображает widget. Перед включением server enforcement передать в profile page настройки Turnstile, добавить widget, требовать token для обеих операций и сбрасывать его после каждого успешного или неуспешного запроса.

Тесты:

- Профильные unit- и route-тесты с `TURNSTILE_ENABLED=true` и управляемыми моками Cloudflare.
- Проверки отсутствующего token, отрицательного `success`, неверного hostname, timeout и успешного ответа.
- Frontend-тесты profile email resend/change: операция не отправляется без token при включённом Turnstile, token входит в JSON payload, после ответа widget сбрасывается.

#### 4. Readiness refactoring

- Сохранить `/api/health` и `/api/health/liveness` как дешёвые публичные endpoints без dependency fan-out.
- Добавить закрытый internal detailed readiness endpoint с `READINESS_INTERNAL_SECRET`.
- Сравнивать secret timing-safe; при неверном значении возвращать `404 Not Found`.
- Явно разрешить internal path в `proxy.ts`.
- Internal endpoint выполняет живые dependency checks и после каждого результата публикует агрегат в общий Redis cache с TTL 120 секунд.
- Использовать обязательный process-local single-flight: concurrent internal-вызовы одной реплики должны ожидать один общий in-flight Promise.
- Публичный `/api/health/readiness` только читает cache и никогда сам не запускает dependency checks.
- Публичный ответ содержит агрегированный `status` и `checkedAt`, но не `checks`, `error.message` или другие внутренние детали.
- Отсутствующий cache или результат старше 90 секунд возвращает `503` со статусом `degraded`.
- Свежий `ok` возвращает `200`; свежий `degraded` возвращает `503`.
- Docker healthcheck должен обращаться к internal detailed endpoint и передавать secret header.
- Таймауты: server deadline — 8 секунд, Docker fetch — 10 секунд, healthcheck timeout — 12 секунд, interval — 15 секунд.
- Обновить все consumers старого readiness-контракта: корневые `start.sh` и `docker-compose.yml`, `deploy/prod/docker-compose.yml`, `deploy/prod/prod.mjs`, `deploy/prod/readiness.mjs`, production startup tests и route integration tests.
- Обновить production validator, оба env example, Docker Compose и документацию для `READINESS_INTERNAL_SECRET`.

#### 5. WebAuthn counter CAS

- Для counter с ненулевой семантикой выполнять `updateMany` с условием по `id` и старому `counter`.
- CAS обязателен, если `oldCounter > 0` или `newCounter > 0`.
- Создавать сессию только после обновления ровно одной строки.
- Если обновлено ноль строк, вернуть `401 Unauthorized`, записать security audit уровня `WARN` и не создавать сессию.
- Не раскрывать клиенту сведения о counter или возможном клонировании authenticator.
- Для `0 → 0` разрешать вход, обновлять `lastUsedAt` и не заявлять защиту от clone/replay через counter.
- Не отзывать существующие сессии автоматически при одиночном CAS-конфликте.
- Вынести атомарный переход counter в отдельный DB helper, чтобы PostgreSQL concurrency test проверял переход состояния независимо от криптографических и request-context моков.

Тесты:

- PostgreSQL concurrency test для ненулевого counter.
- Unit-тесты zero-counter, CAS conflict, отсутствия новой сессии при конфликте и security audit.

#### 6. Security headers и CSP

- Добавить application-level headers в `next.config.ts`.
- Настроить `X-Content-Type-Options: nosniff`.
- Настроить `Referrer-Policy` и `Permissions-Policy`.
- Добавить `frame-ancestors 'none'` в CSP.
- Сначала выполнить локальный и staging-аудит с `Content-Security-Policy-Report-Only`.
- Проверить login, registration, Turnstile, Telegram, passkey, payment flows, PrimeReact overlays и service worker.
- После аудита включить enforcing `Content-Security-Policy`; только enforcing-режим считается завершением задачи.
- Учитывать необходимые Cloudflare Turnstile sources в `script-src`, `frame-src` и `connect-src`, а также фактические требования PrimeReact к styles.
- HSTS является отдельной внешней задачей владельца production HTTPS proxy и должен проверяться на конечном публичном HTTPS-ответе.

### Phase 3 — hardening

#### 7. Прикладной body size limit

- Добавить общий потоковый helper с default limit 64 КБ.
- Применить его ко всем JSON mutations, включая BFF routes и `POST /auth/telegram/callback`.
- Поддержать per-route override, в частности для WebAuthn после измерения реального размера payload.
- Считать фактически прочитанные байты, не полагаясь только на `Content-Length`.
- При превышении лимита возвращать `413 Payload Too Large`.
- Для malformed JSON в пределах лимита возвращать `400 Bad Request`.
- После миграции проверить поиском route handlers и явно обосновать любое оставшееся прямое использование `request.json()`.

#### 8. HMAC для rate-limit identities

- Добавить отдельный обязательный production secret `RATE_LIMIT_IDENTITY_SECRET` длиной не менее 32 байт.
- Использовать versioned namespace формата `v2:<action>:email:<digest>:tgid:<digest>`.
- Использовать domain separation при вычислении digest:
  - `HMAC(secret, "clean-pay:rate-limit:v2:email:" + normalizedEmail)`;
  - `HMAC(secret, "clean-pay:rate-limit:v2:tgid:" + normalizedTelegramId)`.
- Не включать исходный email или Telegram ID в Redis key.
- Обновить runtime config, production validator, оба env example, оба Dockerfile, `tests/setup/env.ts` и тесты конфигурации.
- Добавить тест, доказывающий отсутствие исходного email и Telegram ID в Redis command.
- Старые v1 keys не мигрировать: они должны естественно истечь по TTL.

### Phase 4 — Payment recovery и refresh rotation

#### 9. Payment idempotency recovery

- Подтверждено, что потеря browser state создаёт новый client idempotency key и допускает создание новой `PaymentOperation` с тем же payload.
- Cross-key дедупликация одинаковых payload не вводится: она может заблокировать легитимную повторную покупку и не имеет подтверждённого финансового контракта с upstream.
- `GET /api/bff/payments/status` без browser-local identifiers восстанавливает последнюю операцию текущего пользователя в `DISPATCHING` или `OUTCOME_UNKNOWN`.
- Поиск ограничен текущим `userId`, не создаёт новую операцию и использует существующую reconciliation state machine.
- Fault-injection matrix и условия будущего cross-key guard зафиксированы в `docs/payment-idempotency-recovery-design.md`.
- Fault injection с реальным платёжным провайдером не выполняется; для него обязателен disposable upstream/provider stub.

#### 10. Refresh token rotation и reuse detection

- Одна `WebSession` является token family; текущий hash остаётся в `refreshTokenHash`.
- Миграция `20260720233000_add_refresh_token_rotation` добавляет `WebRefreshToken` с историей использованных hashes и зашифрованным единственным successor.
- `SELECT ... FOR UPDATE` сериализует ротацию; ограниченное повторное чтение закрывает snapshot race PostgreSQL `READ COMMITTED`.
- Повтор старого token в течение 10 секунд возвращает тот же successor и не создаёт новую ветку.
- Reuse после grace отзывает только конкретную family, очищает cookies и создаёт WARN audit event.
- Существующие сессии мигрируют лениво при первом refresh, без массового logout.
- Design, retention и rollback описаны в `docs/refresh-token-rotation-design.md`.

## Критерии готовности PR

- Один пункт backlog — один PR; связанные конфигурационные изменения, документация и тесты входят в тот же PR.
- Во время разработки запускать профильные тесты.
- Для каждого PR запускать typecheck и ESLint.
- Перед завершением PR запускать полный набор unit/integration тестов и production build.
- Полный E2E запускать при наличии необходимой инфраструктуры; обязательный общий E2E — после Phase 1 и Phase 2.
- Redis: обязательны FakeSocket и TCP-stub тесты.
- Passkey и WebAuthn: обязательны PostgreSQL concurrency tests.
- PostgreSQL concurrency tests должны выполняться в отдельном обязательном CI job с `REAL_DATABASE_URL`, применёнными миграциями и проверкой, что suite не был пропущен.
- Manual smoke-test обязателен для auth, Turnstile, readiness, security headers и CSP.
- Каждый concurrency fix сопровождается тестом, воспроизводящим исходную гонку и подтверждающим новый инвариант.
- CSP считается готовой только после перехода в enforcing-режим.

## Влияние изменений и защита от регрессий

### Совместимость пользовательских сценариев

- Redis timeout не меняет успешный контракт API. При недоступном Redis зависший запрос заменяется ограниченным по времени ответом `503`; frontend должен показывать временную ошибку и позволять безопасный повтор.
- Passkey fix сохраняет текущие `200`, `403` и `404`. Пользователь не сможет остаться без последнего passkey из-за параллельных удалений; после `403` UI перечитывает список.
- Turnstile начинает реально применять заявленную frontend-политику. Verify-email формы уже передают и сбрасывают token, но `ProfilePanel` должен быть мигрирован в том же PR; иначе resend/change email из профиля сломаются при `TURNSTILE_ENABLED=true`. После каждой операции widget должен сбрасываться и получать новый token; повторная отправка использованного token не допускается.
- Public readiness сохраняет существующий URL, но меняет форму ответа. Все внутренние consumers старого поля `checks` должны быть мигрированы атомарно в одном PR.
- WebAuthn CAS не меняет нормальный вход. При реальном или конкурентном конфликте вход завершается контролируемым `401` без создания сессии; пользователь может повторить authentication ceremony.
- CSP является потенциально наиболее регрессионным изменением для UI. Enforcing policy нельзя включать до smoke-проверки всех перечисленных flows и устранения report-only violations.
- Body limit не влияет на штатные небольшие JSON payload. Перед включением необходимо измерить максимальные WebAuthn и Telegram payload и задать достаточные route-specific limits.
- HMAC меняет только внутренние Redis keys. Активные v1 counters временно существуют параллельно и естественно истекают; API-контракт не меняется.

### Совместимость deployment и эксплуатации

- Readiness PR должен одновременно менять приложение, proxy allow rule, оба Compose-файла, startup/verify scripts, env validation и тесты. Частичная выкладка несовместимых версий запрещена.
- Новый `READINESS_INTERNAL_SECRET` должен быть создан до запуска новой версии и доступен app healthcheck внутри контейнера.
- Новый `RATE_LIMIT_IDENTITY_SECRET` должен быть создан до запуска новой версии. Build-time placeholders используются только при сборке; production validator должен запрещать известные placeholders.
- Readiness cache хранится в Redis и доступен всем Next.js route-модулям и репликам. Process-local состояние используется только как fail-closed fallback текущего процесса и для single-flight.
- При старте cache пуст, поэтому public readiness возвращает `503 degraded` до первой успешной или неуспешной internal-проверки. Это ожидаемое fail-closed поведение.

### Порядок безопасного выпуска

1. Для каждого изменения сначала добавить тест, воспроизводящий текущий дефект.
2. Реализовать исправление без одновременного рефакторинга несвязанных модулей.
3. Запустить профильные тесты, typecheck, ESLint, unit/integration и production build.
4. Для DB concurrency запустить обязательный PostgreSQL CI job; skipped suite считается ошибкой CI.
5. Перед readiness rollout подготовить оба новых production secrets и атомарно обновить все readiness consumers.
6. CSP выпускать отдельно: report-only аудит, исправление violations, затем enforcing с подготовленным быстрым rollback заголовка.
7. После Phase 1 и Phase 2 выполнить полный E2E и manual smoke ключевых flows.

### Rollback

- Redis и passkey изменения не требуют миграции схемы и могут быть откатаны вместе с кодом.
- Turnstile rollback возвращает прежнюю policy, но не требует изменения данных.
- Readiness rollback должен откатывать приложение, Compose/startup consumers и contract tests одной согласованной версией.
- CSP rollback выполняется удалением или временным ослаблением enforcing header; HSTS не включается этим репозиторием и имеет отдельный внешний rollback-план.
- Body limit и HMAC не требуют миграции persistent business data. При откате HMAC новые v2 Redis counters перестанут читаться и истекут по TTL.
- Payment recovery не меняет правила создания операций и откатывается вместе с status endpoint. Refresh rotation имеет обратно совместимую additive migration; старый код продолжает принимать текущий `WebSession.refreshTokenHash`, а таблицу истории нельзя удалять до завершения rollback window.
