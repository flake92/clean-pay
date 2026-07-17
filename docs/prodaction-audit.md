# Production audit

Обновлено: 2026-07-18

Этот документ — живой план устранения проблем, найденных при аудите Clean Pay. Главный инвариант: каждое исправление должно сохранять текущие рабочие пользовательские сценарии и публичные контракты, кроме поведения, которое само является уязвимостью или ошибкой.

## Правила безопасного внедрения

1. Исправлять по одному пункту или одной тесно связанной группе за раз.
2. Перед изменением зафиксировать совместимое ожидаемое поведение regression-тестом.
3. Не менять API, схему данных и UX без необходимости; миграции выполнять только с backfill/rollback-планом.
4. После каждого пункта запускать профильные тесты, полный unit/integration suite, lint и production build.
5. Для платежей, сессий и миграций отдельно проверять повтор запроса, потерю ответа, конкуренцию и восстановление после частичного сбоя.
6. Обновлять статус пункта и записывать фактические проверки в журнале внизу документа.

Статусы: `[ ]` — запланировано, `[~]` — в работе, `[x]` — исправлено локально и проверено. Production rollout отмечается отдельно и не подразумевается статусом `[x]`.

## P0 — немедленно

### 1. [x] Запретить перехват аккаунта через WebAuthn credential

Проблема: регистрация passkey делает `upsert` по глобальному `credentialId` и может заменить публичный ключ credential, принадлежащего другому пользователю.

План:

- запретить изменение credential, если его владелец не совпадает с текущей сессией;
- сохранить повторную регистрацию собственного синхронизированного credential;
- исключить TOCTOU при конкурентном создании одинакового `credentialId`;
- добавить тесты для нового credential, собственного credential, чужого credential и конкурентного конфликта;
- не менять успешный ответ API и последующее повышение assurance level.

Критерий готовности: чужой `credentialId` никогда не меняет владельца, ключ или счётчик; существующие легитимные сценарии регистрации и входа продолжают работать.

Результат:

- update выполняется только при совпадении `credentialId`, владельца и публичного ключа;
- новый credential создаётся отдельно, а конфликт `P2002` безопасно разрешается повторным owner-scoped update;
- повторная регистрация собственного синхронизированного credential сохранена;
- публичный ключ существующего credential неизменяем, sign counter не сбрасывается;
- успешный ответ API, повышение assurance level и audit event сохранены;
- production rollout не выполнялся.

## P1 — высокий приоритет

### 2. [x] Закрыть CSRF в изменении e-mail и других cookie-auth мутациях

Проверять доверенный `Origin`/`Referer`, допустимый `Content-Type` и серверное состояние registration flow. Не доверять клиентскому `registrationFlow` для отключения Turnstile. Добавить негативные тесты для cross-site и sibling-subdomain запросов.

Результат:

- все unsafe `/api/bff/**`, `/api/logout` и `POST /auth/telegram/callback` требуют точный public `Origin` либо доверенный `Referer`;
- `GET /auth/telegram/callback` сохранён для внешнего OIDC redirect; authenticated Telegram link start разрешён только с доверенной страницы;
- JSON обязателен по умолчанию для browser mutations, известные bodyless endpoints перечислены явно;
- cross-origin, sibling-subdomain, opaque/missing origin и `text/plain` запросы отклоняются до use case;
- client-controlled `registrationFlow` игнорируется, а email confirmation всегда проходит серверную Turnstile-проверку; текущий registration UI уже отправляет token;
- same-origin login, Telegram WebApp/popup, password, passkey, payment и subscription flows сохранены;
- production rollout не выполнялся.

### 3. [x] Сделать purchase/extend идемпотентными

Добавить server-generated idempotency key/operation record и повторно возвращать исходный результат. Проверить повтор запроса, timeout после upstream-успеха и бесплатный тариф.

Результат:

- браузер создаёт UUID один раз на нормализованный purchase/extend-запрос, повторно использует его после сетевой ошибки, `202`, `408`, `429` и `5xx` и очищает только после подтверждённого успеха либо окончательной клиентской ошибки;
- Clean Pay хранит только hash клиентского ключа и отдельный server-generated upstream UUID; операция имеет lease/CAS-состояния `READY`, `DISPATCHING`, `OUTCOME_UNKNOWN`, `SUCCEEDED`, `FAILED_FINAL`;
- replay завершённой операции возвращает исходный `200`, активная или неоднозначная операция — контролируемый `202`; post-dispatch ошибки явно разделены на `FINAL`, `RETRYABLE` и `UNKNOWN`, причём локальная ошибка записи после upstream-успеха всегда fail-closed;
- новый operation record создаётся только после локального rate limit и успешной upstream-аутентификации; lookup/replay существующего ключа не требует повторной Remnashop-аутентификации;
- fingerprint строится по тому же нормализованному payload, который отправляется upstream; неизвестные клиентские поля не пересылаются;
- результат операции и `PaymentRecord` фиксируются одной транзакцией, а чужой `payment_id`, другой пользователь, другой вид операции или другой payload не могут присвоить существующий результат;
- при merge пользователей операции атомарно переносятся на target-user; конфликт одинаковых ключей отменяет весь merge, а `ON DELETE RESTRICT` не позволяет каскадно потерять новый или активный ключ;
- повреждённый upstream replay и неожиданный upstream-конфликт idempotency считаются `UNKNOWN`, поэтому клиент не очищает ключ и не создаёт потенциальный дубль;
- Remnashop commit `b08549e` добавляет обратно совместимый optional `Idempotency-Key`, durable operation/lease/CAS, стабильный replay и fail-closed `409`; YooKassa получает тот же provider idempotency key, бесплатный flow не выполняет fulfillment повторно;
- Remnashop follow-up `9e543bc` переносит операции до фиксации merge, заменяет каскадный FK на `RESTRICT` и добавляет DB-триггеры, которые сериализуют конкурентный claim и запрещают старой версии приложения оставить операции у merged-user; миграция `0044` fail-closed останавливается при уже нарушенном инварианте;
- порядок rollout: сначала миграции и версия Remnashop с `b08549e` и `9e543bc`, затем additive-миграция Clean Pay и приложение; rollback приложения безопасен без удаления новых таблицы/nullable-колонки;
- reconciliation для `UNKNOWN`, provider lookup и реальный PostgreSQL crash/concurrency rehearsal остаются обязательной частью пункта 4; production rollout не выполнялся.

### 4. [x] Восстанавливать локальные платежи после частичного сбоя

Синхронизация должна создавать отсутствующий `PaymentRecord`, а не только обновлять существующий. Нужны reconciliation-процесс, пагинация/курсор и тест сбоя БД после успешного ответа Remnashop.

Результат:

- history sync теперь идемпотентно создаёт отсутствующие `PaymentRecord`, обновляет существующие только более свежими upstream-данными и проходит все страницы стабильным cursor contract; поколения синхронизации ограничены по числу страниц, защищены owner lease и продолжаются отдельными bounded batch;
- локальная операция после потерянного ответа сверяется по точному server-generated upstream key и виду операции; успешный исход фиксируется вместе с `PaymentRecord`, точный `404` безопасно возвращает только просроченный claim к повтору с тем же ключом, а смена/неоднозначность владельца переводит операцию в `manual_required` без создания дубля;
- reconciliation выключен по умолчанию и запускается отдельным Compose profile только при валидных `REMNASHOP_ADMIN_API_BASE_URL`, `PAYMENT_RECONCILIATION_SECRET` и `PAYMENT_RECONCILIATION_ENABLED=true`; внутренний endpoint принимает только отдельный bearer secret, а production `up`/`verify`/`ps` проверяют наличие worker;
- Remnashop хранит provider/recovery snapshot, использует DB-clock leases и fencing tokens, имеет конечный retry budget и очереди ручного разбора. YooKassa replay разрешён только по полностью провалидированному сохранённому запросу и до deadline; бесплатный `LOCAL` исход считается успешным только после доказанного fulfillment; остальные gateways, включая RollyPay, fail closed в manual recovery;
- webhook inbox и fulfillment state machine не допускают позднему worker завершить работу после истечения lease, сохраняют первый подтверждённый payment method, переводят конфликтующие/осиротевшие события в ручной разбор и блокируют merge пользователя при активной или замороженной платёжной работе;
- additive-миграции Remnashop имеют backfill, legacy-writer fencing, rollout gate и проверенный downgrade; порядок maintenance rollout, backup, drain всех HTTP/Taskiq/scheduler процессов, same-image restart и безопасный rollback описаны в `docs/clean-pay-payment-recovery-rollout.md` companion-ветки;
- companion commit `3ae9014` запушен в fork, а актуальная ветка поверх `snoups/remnashop:dev` с миграциями `0046–0049` и RollyPay compatibility направлена как [`snoups/remnashop#135`](https://github.com/snoups/remnashop/pull/135) (`fd33391`, migration rebase `d1b30ea`); Remnawave не изменялся;
- Clean Pay: 320/320 тестов, Prisma validate/generate, ESLint (0 ошибок), production build, Compose config и shell syntax прошли. На реальном PostgreSQL проверены upgrade непустой старой схемы, точный backfill дат, FK cascade, старый writer, `SKIP LOCKED` concurrency и owner lock;
- Remnashop: 131/131 тест, Ruff, strict mypy по 540 source-файлам, единственная Alembic head `0049`, production Docker build и реальные PostgreSQL rehearsal `0045 → 0049 → 0045 → 0049`, operation/webhook/fulfillment concurrency и crash-recovery matrix прошли;
- production rollout ещё не выполнялся; включать worker можно только после развёртывания проверенного Remnashop commit и выполнения runbook.

### 5. [x] Исправить опасные production-миграции

- `WebSession`: добавить новые обязательные поля через nullable/default, backfill, затем `NOT NULL`;
- Telegram ID: мигрировать тип без удаления данных;
- прогнать upgrade на копии непустой БД и подготовить rollback/backup-инструкцию.

Результат:

- `20260619153000_add_auth_cache_models` теперь выполняется одной транзакцией под `ACCESS EXCLUSIVE` lock: новые expiry-поля сначала nullable, затем обе даты backfill’ятся из обязательного legacy `expiresAt`, после чего включается `NOT NULL` и только в конце удаляется старый столбец;
- `20260619154500_add_telegram_oidc` больше не выполняет `DROP COLUMN telegramId`: значения проверяются без вывода PII, некорректная или выходящая за signed `BIGINT` строка атомарно блокирует миграцию, валидные IDs преобразуются in-place, а индексы пересоздаются внутри той же транзакции; последующая миграция возвращает тип в `TEXT` через lossless cast;
- добавлен regression-test порядка nullable → backfill → `NOT NULL` → drop, обязательных lock/transaction и запрета drop/add Telegram ID;
- [production migration runbook](production-migration-runbook.md) фиксирует maintenance-stop всех writers, preflight, custom-format `pg_dump`, проверку каталога dump, `prisma migrate deploy/status`, post-checks и восстановление предыдущего образа через отдельную БД без перезаписи повреждённой;
- на реальном PostgreSQL пройдена вся цепочка от seeded legacy schema: expiry сохранены с миллисекундами, оба Telegram ID сохранены через `TEXT → BIGINT → TEXT`, намеренно испорченное значение завершило migration ошибкой и оставило прежнюю схему/данные, после исправления upgrade завершился;
- pre-migration custom dump восстановлен в отдельную БД с исходными `WebUser`, `WebSession` и legacy `expiresAt`; свежий Prisma `migrate deploy/status` применил все 11 миграций, а повторный production deploy не переиграл уже завершённую миграцию даже при отличающемся сохранённом checksum;
- полный suite 323/323, Prisma validate/generate, ESLint без ошибок и Next.js production build прошли; production rollout не выполнялся.

### 6. [x] Безопасно объединять аккаунты

При merge отзывать или ротировать source-сессии, не переносить действующие refresh tokens как есть, переносить passkeys/challenges с явной политикой конфликтов и проверять итогового владельца.

Результат:

- оба локальных merge-пути (Remnashop reconciliation/link и Telegram OIDC link) используют единую транзакционную политику с детерминированной блокировкой target/source пользователей;
- source `WebSession` удаляются целиком, поэтому локальные refresh hashes и зашифрованные Remnashop access/refresh tokens не переживают merge и не перепривязываются к target;
- passkeys переносятся target-пользователю по глобально уникальному `credentialId`; незавершённые WebAuthn challenges, e-mail verification codes и Telegram auth states удаляются как привязанные к прежнему владельцу/контексту;
- перенос audit/payment данных и удаление source выполняются в той же транзакции; несоответствие заблокированных/обновлённых/удалённых строк завершает операцию `ACCOUNT_MERGE_REQUIRED` (409);
- после назначения проверенных identity полей отдельно проверяются итоговый target-владелец и отсутствие source-пользователей;
- целевой suite 27/27, полный suite 329/329, ESLint без ошибок (один посторонний warning в сгенерированном coverage-файле) и Next.js production build прошли; production rollout не выполнялся.

### 7. [x] Отзывать скомпрометированные сессии при смене пароля

Отзывать остальные локальные сессии пользователя, ротировать текущий refresh token и определить политику для passkeys. Добавить тест, что старый refresh больше не выдаёт access token.

Результат:

- после успешной смены пароля все прежние локальные сессии пользователя, включая текущую, атомарно отзываются, их сроки принудительно завершаются, а сохранённые Remnashop access/refresh tokens очищаются;
- вместо переиспользования прежнего `sid` создаётся новая сессия с новым криптографическим local refresh token/hash и новой access cookie, поэтому ранее выданные access cookies также перестают проходить DB-проверку;
- пользователь и текущая сессия блокируются на время замены; refresh-path использует CAS по исходному hash/revocation/expiry и не выдаёт access cookie, если проиграл гонку с отзывом;
- если upstream-пароль уже изменён, но replacement-транзакция не завершилась, выполняется fail-closed отзыв всех оставшихся активных сессий и cookies браузера очищаются;
- passkey credentials сохраняются как независимый фактор входа, однако все существующие сессии, в том числе созданные через passkey, отзываются и требуют нового входа;
- целевой suite 29/29, полный suite 332/332, ESLint без ошибок (один посторонний warning в сгенерированном coverage-файле) и Next.js production build прошли; на одноразовой реальной PostgreSQL-БД подтверждены отзыв двух сессий, новый hash, отказ старого refresh и сохранение passkey. Production rollout не выполнялся.

### 8. [ ] Исправить жизненный цикл access/refresh Remnashop и web-сессий

- refresh Remnashop выполнять до `/auth/me`, если access истёк;
- не клонировать одноразовый upstream refresh token между сессиями;
- защитить refresh от гонок mutex/CAS;
- не удалять валидный web refresh cookie при обычной навигации после истечения access cookie.

### 9. [ ] Проверять владельца при Telegram-восстановлении Remnashop-сессии

Не возвращать восстановленные токены до проверки ожидаемого e-mail/Remnashop account ID и завершения согласованного merge.

### 10. [ ] Ужесточить production environment validator

Отклонять localhost, `change-me*`, короткие/известные секреты, небезопасные cookie-настройки и несовместимые URL. Example-файл не должен проходить production validation без явной замены значений.

### 11. [ ] Исключить выдачу чужого subscription URL в fallback Remnawave

Fallback по Telegram/e-mail должен подтверждать UUID и владельца, обрабатывать дубли однозначно и не выбирать произвольную отключённую/истёкшую запись.

## P2 — средний приоритет

### 12. [ ] Исправить rate limiting и anti-abuse

- не проглатывать `RATE_LIMITED` в `/auth/identify`;
- лимитировать enumeration также по IP/устройству;
- не использовать общий anonymous key для всех Telegram login;
- проверять Telegram identity до применения identity-based limiter;
- сделать Redis `INCR + EXPIRE` атомарным;
- защитить публичное создание WebAuthn challenge от заполнения БД.

### 13. [ ] Атомарно потреблять WebAuthn challenge и Telegram state

Использовать условный update (`consumedAt IS NULL`, срок не истёк) и проверять число изменённых строк. Добавить конкурентные тесты, допускающие ровно одного победителя.

### 14. [ ] Добавить timeout/cancellation внешним запросам

Ограничить по времени Remnashop, Remnawave и readiness fetch-вызовы; readiness выполнять параллельно с общим deadline и различимыми причинами ошибок.

### 15. [ ] Сделать production verify реальной проверкой готовности

Проверять `/api/health/readiness`, добавить healthcheck app-сервису и не считать deploy успешным при недоступных критичных зависимостях.

### 16. [ ] Довести payment return flow до конечного состояния

Передавать/проверять return URL в платёжном контракте, добавить polling с backoff и ручное обновление, а заголовок страницы строить по подтверждённому сервером статусу.

### 17. [ ] Гарантированно снимать loading после frontend-ошибок

Добавить `try/catch/finally`, безопасный разбор не-JSON ответов и понятное состояние «результат неизвестен» для login, purchase и extend. Повтор платежа должен идти через тот же idempotency key.

### 18. [ ] Добавить runtime-валидацию BFF request body и защиту цены

Возвращать контролируемый `400` для неверного JSON/полей. Перед созданием invoice сверять подтверждённые пользователем amount/currency/version оффера и показывать изменение цены до оплаты.

### 19. [ ] Писать success audit только после успешной мутации

Для promocode, reissue и device mutations разделить attempted/failed/succeeded события; не оставлять ложный success при upstream-ошибке.

### 20. [ ] Ввести retention и минимизацию PII

Удалять expired/consumed challenges и Telegram states, старые revoked sessions и audit rows по утверждённой политике. Не писать raw Telegram ID и лишние внутренние идентификаторы в production INFO logs.

## P3 — качество и эксплуатация

### 21. [ ] Сохранять исходный `redirect_to` после всех способов входа

Провалидировать локальный путь и передавать его через password, passkey и Telegram login вместо жёсткого `/cabinet`.

### 22. [ ] Вернуть TypeScript-проверку тестов в обязательный pipeline

Исправить текущие type errors, добавить `typecheck` script и CI gate. Усилить full-stack assertions: ключевые routes не должны считаться успешными при произвольном non-5xx или условном пропуске сценария.

### 23. [ ] Сделать PWA cache версионируемым и тестируемым

Связать cache name/precache со сборкой, корректно обновлять offline shell и добавить browser-тест обновления service worker.

### 24. [ ] Устранить эксплуатационные расхождения

Зафиксировать совместимую версию Remnashop в devcontainer вместо mutable `latest`, убрать дублирующие БД-индексы отдельной безопасной миграцией и синхронизировать документацию с фактическим API.

## Базовая линия перед исправлениями

- Unit/integration: 29 файлов, 179 тестов — пройдены.
- ESLint — пройден.
- Production build с безопасными локальными placeholder-переменными — пройден.
- Coverage: statements 86.70%, branches 70.92%, functions 91.88%, lines 86.84%.
- Прямой `tsc --noEmit` — 29 существующих ошибок в тестах; это вынесено в пункт 22.
- Upgrade production-БД не выполнялся: для миграций обязателен отдельный rehearsal на непустой копии.

## Журнал выполнения

- 2026-07-17: аудит зафиксирован; начата работа над пунктом 1.
- 2026-07-17: пункт 1 исправлен и локально проверен: passkey suite 10/10, полный suite 183/183, ESLint без ошибок, production build успешен. Добавлены проверки нового, собственного, чужого, изменённого и конкурентно созданного credential.
- 2026-07-17: пункт 2 исправлен и локально проверен: профильный suite 58/58, полный suite 209/209, ESLint без ошибок в исходниках, production build успешен. Прямой `tsc --noEmit` сохранил базовые 29 ошибок тестовой типизации, новых ошибок не добавлено. Devcontainer E2E локально не запущен: Docker Desktop daemon недоступен; проверка перенесена на тестовый стенд перед production rollout.
- 2026-07-17: пункт 3 исправлен и локально проверен: расширенный профильный suite 92/92, полный suite 253/253, Prisma validate/generate, ESLint без ошибок в исходниках и production build успешны. Прямой `tsc --noEmit` сохранил базовые 29 ошибок тестовой типизации, новых ошибок в изменённых файлах нет. Companion Remnashop commits `b08549e` и `9e543bc` запушены в `fork/codex/clean-pay-integration-pr`: полный suite 19/19, Ruff, strict mypy по 521 файлу, compileall, Alembic head `0044`, migration SQL/diff-check прошли; опубликованная миграция `0043` не изменялась. Devcontainer/PostgreSQL E2E локально не запущен из-за недоступного Docker Desktop и остаётся release gate тестового стенда.
- 2026-07-18: пункт 4 исправлен и полностью проверен локально. Clean Pay: 39 файлов/320 тестов, Prisma validate/generate, ESLint без ошибок, production build, Compose/shell checks и реальная PostgreSQL crash/concurrency matrix. Remnashop: 131 тест, Ruff, strict mypy по 540 файлам, Alembic head `0049`, непустой и чистый upgrade/downgrade/re-upgrade, legacy writer, DB-clock lease fencing, webhook/fulfillment/manual-queue matrix и production Docker build. Companion fork обновлён, актуальный PR [`snoups/remnashop#135`](https://github.com/snoups/remnashop/pull/135) направлен в `dev`; код Remnawave не менялся. Production rollout не выполнялся.
- 2026-07-18: пункт 5 исправлен и проверен: опасные historical Prisma migrations стали атомарными и lossless, добавлен migration runbook и regression-suite. Полный suite 323/323, Prisma validate/generate, ESLint и production build прошли. На отдельной непустой PostgreSQL-БД проверены legacy backfill, точное сохранение Telegram IDs, fail-closed/rollback на malformed ID, полная migration chain, Prisma deploy/status и восстановление pre-migration custom dump. Production rollout не выполнялся.
- 2026-07-18: пункт 6 исправлен и проверен: оба merge-пути отзывают source-сессии, сохраняют passkeys, инвалидируют временные auth-состояния и fail-closed проверяют конечного владельца. Целевой suite 27/27, полный suite 329/329, ESLint без ошибок и Next.js production build прошли. Код Remnashop и Remnawave в этом пункте не изменялся; production rollout не выполнялся.
- 2026-07-18: пункт 7 исправлен и проверен: смена пароля заменяет текущую сессию и отзывает все прежние, refresh/revoke защищён CAS, failure после upstream success закрывается полным отзывом, passkeys сохраняются. Целевой suite 29/29, полный suite 332/332, ESLint без ошибок, production build и отдельный реальный PostgreSQL rehearsal прошли. Код Remnashop и Remnawave не изменялся; production rollout не выполнялся.
