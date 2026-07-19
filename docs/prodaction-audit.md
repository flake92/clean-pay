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

### 8. [x] Исправить жизненный цикл access/refresh Remnashop и web-сессий

- refresh Remnashop выполнять до `/auth/me`, если access истёк;
- не клонировать одноразовый upstream refresh token между сессиями;
- защитить refresh от гонок mutex/CAS;
- не удалять валидный web refresh cookie при обычной навигации после истечения access cookie.

Результат:

- получение/атомарный перенос token bundle и обязательный Remnashop refresh выполняются до первого `/auth/me`, поэтому identity-проверка больше не отправляет заведомо истёкший access token;
- passkey и Telegram session-create пути больше не копируют токены из другой строки; свежие upstream credentials сохраняются только из фактического upstream auth response, а существующий bundle при необходимости переносится target-сессии с одновременной очисткой прежнего владельца;
- legacy-дубли одного plaintext refresh token обнаруживаются после безопасной расшифровки и дедуплицируются, при этом независимые token pairs других логинов не удаляются;
- user и все активные web-сессии блокируются в стабильном порядке на время ownership/refresh-транзакции; refresh выполняется одним владельцем, а сохранение новой пары дополнительно защищено CAS по прежнему encrypted refresh token;
- profile flow умеет забрать bundle для новой локальной сессии и сохраняет local-only fallback, если доступного bundle/Telegram recovery нет;
- proxy рассматривает opaque web refresh cookie как кандидата на серверное восстановление и больше не удаляет его при обычной page-навигации с отсутствующим, истёкшим или неверным access cookie; защищённые API по-прежнему валидируют refresh по hash/revocation/expiry в БД;
- целевой suite 89/89, полный suite 336/336, ESLint без ошибок (один посторонний warning в сгенерированном coverage-файле), Next.js production build прошли; прямой `tsc` сохранил базовые 29 test-only ошибок без новых. На реальном PostgreSQL два параллельных запроса дали ровно один upstream refresh, а второй получил сохранённую winner-пару. Production rollout не выполнялся.

### 9. [x] Проверять владельца при Telegram-восстановлении Remnashop-сессии

Не возвращать восстановленные токены до проверки ожидаемого e-mail/Remnashop account ID и завершения согласованного merge.

Результат:

- Telegram recovery сначала проверяет `telegram_id` из `/auth/me`, ожидаемый сохранённый Remnashop account ID и подтверждённый e-mail; при расхождении аккаунтов merge разрешён только после однозначного сопоставления владельца, а после merge выполняются повторная Telegram-аутентификация и полная повторная проверка профиля;
- локальные пользователи, активные сессии, платёжные операции и состояние истории блокируются в стабильном порядке; конфликт identity/idempotency обнаруживается до upstream-мутации, смена платёжного владельца атомарно перепривязывает операции, сбрасывает claims/history cursor, а неоднозначная незавершённая работа переводится в `MANUAL_REQUIRED`;
- токены записываются и возвращаются только после успешного локального merge, финальной проверки владельца и commit; при upstream merge token bundle остальных активных сессий очищается, а устаревший session snapshot после lifecycle cleanup обязательно перечитывается;
- сетевые вызовы под DB-lock ограничены общим deadline 20 секунд, отдельными timeout не более 8 секунд и transaction timeout 30 секунд; потеря ответа безопасно повторяется благодаря идемпотентному same-target merge в companion Remnashop commit `9cc68fb` и миграции `0050`, запрещающей перенаправить уже объединённый source на другой target;
- Clean Pay: целевой suite 80/80, unit 321/321, opt-in integration 32/32 с реальной PostgreSQL-конкуренцией, ESLint и production build прошли; прямой `tsc` сохранил ровно прежние 29 test-only ошибок. Remnashop: unit 137/137, Ruff, PostgreSQL upgrade/downgrade/re-upgrade `0049 ↔ 0050` и immutable-target trigger прошли; единственная mypy-ошибка воспроизводится на чистом upstream HEAD. PR [`snoups/remnashop#135`](https://github.com/snoups/remnashop/pull/135) обновлён до `9cc68fb`; Remnawave не изменялся. Production rollout не выполнялся.

### 10. [x] Ужесточить production environment validator

Отклонять localhost, `change-me*`, короткие/известные секреты, небезопасные cookie-настройки и несовместимые URL. Example-файл не должен проходить production validation без явной замены значений.

Результат:

- единый строгий parser/validator используется deployment-скриптом, legacy `start.sh`, `npm start` и production runtime (с отдельным разрешённым build-phase); `.env` parser отвергает дубли, malformed строки, Compose-control переменные и подстановки окружения;
- production допускает только точный публичный HTTPS origin приложения и secure cookies, согласованные public/internal URL интеграций, Docker build marker и runtime origin; localhost/private origin, unsafe URL, несовместимые DB/Redis/Compose настройки и ambient Compose overrides отклоняются до запуска;
- проверяются длина, уникальность и небанальность секретов, Telegram/Turnstile endpoints и ключи, reconciliation contract, bind/ports и feature flags; example-файлы намеренно невалидны без замены placeholder-значений;
- adversarial matrix закрыла обходы через query overrides PostgreSQL, shell-unsafe DB identities, переменные host environment, baked/runtime origin mismatch, слабые/повторные secrets и `$VAR` interpolation. Целевые тесты 27/27, полный unit suite 329/329, integration 32/32 с PostgreSQL/Redis, ESLint без ошибок (один известный warning generated coverage), production build 50/50, Docker image build/runtime validation, Compose config и Alpine shell syntax прошли; прямой `tsc` сохранил ровно 29 базовых test-only ошибок;
- текущий локальный deployment `.env` fail-closed отклонён из-за `COOKIE_SECURE=false` и не изменялся. Код Remnashop и Remnawave в этом пункте не менялся; production rollout не выполнялся.

### 11. [x] Исключить выдачу чужого subscription URL в fallback Remnawave

Fallback по Telegram/e-mail должен подтверждать UUID и владельца, обрабатывать дубли однозначно и не выбирать произвольную отключённую/истёкшую запись.

Результат:

- UUID endpoint принимается только при точном совпадении с `user_remna_id`, активном статусе и неистёкшем `expireAt`; некорректная дата, disabled и expired user fail-closed;
- fallback требует UUID (если он известен) и подтверждения каждого переданного identity: e-mail сравнивается нормализованно, Telegram ID — как нормализованная строка. Несколько записей одного UUID агрегируют доказательства владельца;
- дубликаты с одним URL допускаются, а конфликтующие URLs либо несколько подходящих UUID возвращают `null`, поэтому URL чужой или произвольно выбранной записи не выдаётся;
- профильные тесты 36/36, полный unit suite 332/332, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 с изолированными безопасными значениями прошли. Код Remnashop и Remnawave не менялся; production rollout не выполнялся.

## P2 — средний приоритет

### 12. [x] Исправить rate limiting и anti-abuse

- не проглатывать `RATE_LIMITED` в `/auth/identify`;
- нелимитировать enumeration  по IP/устройству так как все работает через reverse proxy через localhost;
- не использовать общий anonymous key для всех Telegram login;
- проверять Telegram identity до применения identity-based limiter;
- сделать Redis `INCR + EXPIRE` атомарным;
- защитить публичное создание WebAuthn challenge от заполнения БД.

Результат:

- `/auth/identify` больше не проглатывает `RATE_LIMITED`: ответ `429` возвращается до DB enumeration; временная недоступность Redis сохраняет прежний fail-open режим с техническим warning;
- согласно deployment topology отдельный IP/device limiter не добавлен: reverse proxy передаёт localhost. Anonymous Telegram start не использует общий ключ; link-start ограничивается подтверждённой текущей сессией, а login-confirm — уже проверенным Telegram ID;
- Telegram WebApp limiter перенесён после upstream-проверки `initData` и `/auth/me`; локальная reconciliation получает тот же verified profile, поэтому неподписанный ID из запроса не может исчерпать лимит чужого пользователя;
- Redis `INCR + EXPIRE` выполняется одной Lua-командой `EVAL`, исключая вечные ключи при сбое между командами; публичная выдача WebAuthn authentication challenge защищена отдельным limiter до записи в БД;
- профильные тесты 36/36, полный unit suite 336/336, integration 32/32 с PostgreSQL/Redis, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 прошли. Код Remnashop и Remnawave не менялся; production rollout не выполнялся.

### 13. [x] Атомарно потреблять WebAuthn challenge и Telegram state

Использовать условный update (`consumedAt IS NULL`, срок не истёк) и проверять число изменённых строк. Добавить конкурентные тесты, допускающие ровно одного победителя.

Результат:

- WebAuthn challenge после чтения захватывается условным `updateMany` по `id`, `consumedAt IS NULL` и `expiresAt > now`; проверяется `count === 1`, проигравший конкурент получает controlled validation error до проверки credential и mutation;
- Telegram OIDC/popup/widget после криптографической проверки identity атомарно захватывают state до Remnashop/local mutation; повторный или истёкший state отклоняется, а финальная запись только привязывает уже потреблённый state к пользователю;
- общие claim-функции покрыты unit concurrency-тестами и реальным PostgreSQL rehearsal: по 16 параллельных claim для WebAuthn и Telegram дали ровно одного победителя, expired challenge остался непотреблённым;
- профильные тесты 23/23, полный unit suite 338/338, integration 35/35, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 прошли. Код Remnashop и Remnawave не менялся; production rollout не выполнялся.

### 14. [x] Добавить timeout/cancellation внешним запросам

Ограничить по времени Remnashop, Remnawave и readiness fetch-вызовы; readiness выполнять параллельно с общим deadline и различимыми причинами ошибок.

Результат:

- все Remnashop public/admin/auth/refresh/password HTTP paths имеют abort timeout; Remnawave live lookup, Telegram token exchange и Turnstile verification также ограничены и отменяют зависший fetch;
- каждая readiness dependency имеет 5-секундный per-check timeout, все обязательные и optional checks стартуют одним `Promise.all` с общим 8-секундным AbortSignal; общий deadline передаётся тем же объектом каждому check;
- fetch получает объединённый cancellation signal, а результат различает локальный timeout, отмену общим readiness deadline, HTTP status, malformed response и dependency-specific failure; DB/Redis также не удерживают readiness response сверх deadline;
- профильные тесты 92/92, полный unit suite 339/339, integration 36/36, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 прошли. Тест с общей незавершённой gate подтвердил одновременный старт всех шести checks. Код Remnashop и Remnawave не менялся; production rollout не выполнялся.

### 15. [x] Сделать production verify реальной проверкой готовности

Проверять `/api/health/readiness`, добавить healthcheck app-сервису и не считать deploy успешным при недоступных критичных зависимостях.

Результат:

- production и legacy `verify` проверяют `/api/health/readiness` до 120 секунд вместо liveness; ответ принимается только при HTTP 200, `status=ok`, непустом `checks` и `ok` у каждой критической/настроенной зависимости;
- `prod.mjs up` и `start.sh up/restart` после Compose автоматически ждут readiness и завершаются ненулевым кодом, если приложение или dependency не готовы; reconciliation worker проверяется только после app readiness;
- app healthcheck в обоих Compose-файлах имеет собственный 4-секундный abort и валидирует JSON/status каждого check, поэтому Docker `healthy` не возникает на malformed/degraded ответе;
- parser readiness ответа отдельно протестирован на malformed JSON, degraded dependency и полностью healthy payload; Compose config и Alpine shell syntax прошли;
- профильные тесты 39/39, полный unit suite 343/343, integration 36/36, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 прошли. Код Remnashop и Remnawave не менялся; production rollout не выполнялся.

### 16. [x] Довести payment return flow до конечного состояния

Передавать/проверять return URL в платёжном контракте, добавить polling с backoff и ручное обновление, а заголовок страницы строить по подтверждённому сервером статусу.

Результат:

- Clean Pay формирует return URL только на сервере и привязывает его к `operation_id`; purchase/extend передают URL в Remnashop и принимают платёжный ответ только при точном совпадении возвращённого URL, поэтому браузер не может подменить origin или конечный маршрут;
- companion Remnashop commit `a08c4c8` принимает return URL в публичном платёжном контракте, разрешает только настроенный origin и маршруты `/payment/success`, `/payment/fail`, `/payment/pending`, отклоняет fragment и передаёт проверенный URL в YooKassa. Для старых bot-клиентов без URL сохранён прежний redirect;
- страницы возврата строят заголовок только по подтверждённому сервером состоянию: route `/success` сам по себе больше не означает успех. Неопределённый результат отображается безопасно, незавершённые операции опрашиваются с exponential backoff 2–30 секунд и `retry_after`, доступно ручное обновление;
- профильные тесты Clean Pay 51/51, полный unit suite 347/347, integration 36/36, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 прошли. Remnashop: unit 140/140 и Ruff прошли; fork commit `a08c4c8` запушен, PR [`snoups/remnashop#135`](https://github.com/snoups/remnashop/pull/135) обновлён. Remnawave не изменялся; production rollout не выполнялся.

### 17. [x] Гарантированно снимать loading после frontend-ошибок

Добавить `try/catch/finally`, безопасный разбор не-JSON ответов и понятное состояние «результат неизвестен» для login, purchase и extend. Повтор платежа должен идти через тот же idempotency key.

Результат:

- identify/password/register login-потоки теперь ограничены общим `try/catch/finally`: transport error, исключение обработки и успешный non-JSON/malformed ответ переводят интерфейс в понятное состояние, а loading гарантированно снимается, если навигация не началась;
- purchase/extend перехватывают не только сетевую ошибку, но и любое исключение разбора/обработки ответа; non-JSON `2xx` не считается подтверждённой оплатой и отображается как неопределённый результат без зависшей кнопки;
- idempotency key удаляется только после валидного подтверждённого платёжного ответа либо однозначной клиентской ошибки. При потере ответа, malformed/non-JSON, `202`, `408`, `429` и `5xx` повтор использует тот же сохранённый ключ;
- новые browser-level component tests воспроизводят потерю ответа login/purchase/extend, malformed identity и non-JSON payment responses, проверяют снятие loading и одинаковый ключ при повторе. Профильные тесты 15/15, полный unit suite 354/354, integration 36/36, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout не выполнялся.

### 18. [x] Добавить runtime-валидацию BFF request body и защиту цены

Возвращать контролируемый `400` для неверного JSON/полей. Перед созданием invoice сверять подтверждённые пользователем amount/currency/version оффера и показывать изменение цены до оплаты.

Результат:

- общий BFF JSON reader отклоняет malformed JSON, массивы, `null` и scalar body контролируемым `400 VALIDATION_ERROR`; он подключён ко всем BFF routes с JSON body. Payment parser дополнительно проверяет типы, диапазон duration, формат amount/currency, длины и обязательность всех invoice-полей;
- purchase/extend передают подтверждённый снимок `confirmed_amount`, `confirmed_currency`, `offer_version`; version детерминированно связывает plan ID/code, duration, gateway, original/final amount, discount, currency и free-флаг и включён в idempotency fingerprint contract v2;
- непосредственно перед созданием invoice клиент заново получает offers. При изменении показывает «было → стало», обновляет отображаемый оффер, не создаёт idempotency key и не вызывает payment mutation. BFF независимо повторяет ту же проверку после авторизации и до `markPaymentOperationDispatched`, возвращая `409 OFFER_CHANGED` без invoice при гонке или подмене клиента;
- профильная матрица 72/72 проверяет malformed/invalid body, привязку версии ко всем ценовым полям, отсутствие dispatch при изменении цены, browser UX и прежние idempotency/recovery сценарии. Полный unit suite 365/365, integration 38/38, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout не выполнялся.

### 19. [x] Писать success audit только после успешной мутации

Для promocode, reissue и device mutations разделить attempted/failed/succeeded события; не оставлять ложный success при upstream-ошибке.

Результат:

- общий `auditedMutation` lifecycle сначала пишет `<action>_attempted`, выполняет upstream mutation и только после её успешного ответа пишет `<action>_succeeded`; исключение даёт `<action>_failed` с `WARN` и повторно выбрасывается в обычный BFF error path;
- promocode activation, subscription reissue, delete-all devices и delete-one device переведены на единый lifecycle. Старые `promocode_activated`, `subscription_reissued`, `devices_deleted_all`, `device_deleted`, записывавшиеся до mutation, удалены;
- failed audit содержит только bounded `errorCode/errorStatus`, без текста upstream-ошибки и без raw device HWID. Тесты проверяют порядок mutation → success, отсутствие success для всех четырёх upstream failures и неизменный HTTP error response;
- профильные тесты 36/36, полный unit suite 367/367, integration 42/42, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout не выполнялся.

### 20. [x] Ввести retention и минимизацию PII

Удалять expired/consumed challenges и Telegram states, старые revoked sessions и audit rows по утверждённой политике. Не писать raw Telegram ID и лишние внутренние идентификаторы в production INFO logs.

Результат:

- всегда включённый `retention-worker` каждые 6 часов удаляет expired/consumed WebAuthn challenges, Telegram auth states и e-mail verification codes старше 7 дней, revoked/expired sessions старше 90 дней, INFO audit старше 180 дней, WARN/ERROR audit старше 365 дней и rate-limit events старше 30 дней. Payment records/operations не удаляются;
- сроки настраиваются только в консервативных диапазонах и проверяются production environment validator до запуска; security audit нельзя хранить меньше INFO. Worker пишет heartbeat только после полного успешного прохода, а `up/verify/ps` fail-closed требуют healthy контейнер;
- общий recursive log/audit sanitizer редактирует raw e-mail, Telegram ID, user/session/credential/operation/payment/Remnashop/device identifiers, сохраняя только безопасные boolean-признаки и trace request ID. Success login и Telegram audit больше не добавляют дублирующую identity metadata;
- профильные тесты 28/28, полный unit suite 371/371, integration 42/42, ESLint без ошибок (один известный warning generated coverage), production build 50/50, Compose config, JS/Alpine syntax и production Docker build прошли. На реальной PostgreSQL-БД boundary rehearsal удалил четыре старые строки и сохранил четыре свежие; упакованный worker выполнил cleanup и записал heartbeat. Remnashop и Remnawave не менялись; production rollout не выполнялся.

## P3 — качество и эксплуатация

### 21. [x] Сохранять исходный `redirect_to` после всех способов входа

Провалидировать локальный путь и передавать его через password, passkey и Telegram login вместо жёсткого `/cabinet`.

Результат:

- единая shared policy принимает только локальный absolute path текущего origin, отклоняет protocol-relative/external/backslash URL, credentials и auth/login/register destinations, исключая open redirect и циклы входа;
- server login page один раз валидирует `redirect_to` и передаёт результат password/register fallback, passkey и Telegram OIDC button. Password и passkey после подтверждённого входа используют этот путь вместо жёсткого `/cabinet`; fallback остаётся `/cabinet`;
- Telegram OIDC продолжает хранить путь в одноразовом state, но теперь получает исходный путь от login page. Telegram WebApp page также валидирует параметр на сервере, передаёт его BFF, а BFF независимо валидирует снова перед ответом/redirect; fallback-ссылки сохраняют тот же путь;
- профильные тесты 28/28 покрывают safe/unsafe matrix, server/client wiring, Telegram state/WebApp и frontend error flows. Полный unit suite 373/373, integration 42/42, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout не выполнялся.

### 22. [x] Вернуть TypeScript-проверку тестов в обязательный pipeline

Исправить текущие type errors, добавить `typecheck` script и CI gate. Усилить full-stack assertions: ключевые routes не должны считаться успешными при произвольном non-5xx или условном пропуске сценария.

Результат:

- исправлены все ошибки полного `tsc --noEmit`, включая test sources; кроссплатформенный `npm run typecheck` сам генерирует Prisma Client с безопасным локальным placeholder URL и затем проверяет весь проект. Новый GitHub Actions gate на Node.js 24 последовательно запускает clean install, lint, typecheck, unit tests и production build;
- full-stack matrix больше не принимает произвольный non-5xx для ключевых auth/payment границ: passkey, invalid verification/login, Telegram-only business routes, purchase/extend validation и Remnashop link проверяют точные HTTP status и BFF error/data contract. Условные purchase/extend пропуски заменены детерминированным выполнением обоих маршрутов;
- devcontainer E2E стал герметичным по умолчанию и переносимым на Docker Desktop: тестовые volumes очищаются перед прогоном, bootstrap ждёт готовности пользователя/сокета, Windows host paths нормализуются для всех mock mounts, shell helpers вызываются независимо от executable bit, а Remnashop/readiness fixtures получают валидную конфигурацию;
- `typecheck`, ESLint без ошибок (один известный warning generated coverage), unit 373/373, integration 42/42, production build 50/50 и чистый real devcontainer full-stack suite 104/104 прошли. Remnashop и Remnawave не менялись; production rollout ещё не выполнялся.

### 23. [x] Сделать PWA cache версионируемым и тестируемым

Связать cache name/precache со сборкой, корректно обновлять offline shell и добавить browser-тест обновления service worker.

Результат:

- каждая Next.js сборка получает единый build ID (`CLEAN_PAY_BUILD_ID`, GitHub SHA или случайный fallback), который одновременно используется как Next build ID и в имени `clean-pay-shell-<build>`; статический вечный `clean-pay-shell-v1` удалён;
- `/sw.js` теперь отдаётся динамическим route с `no-cache, no-store`, root scope и build-specific source. Регистрация использует `updateViaCache: none` и явно вызывает update; install перезагружает каждый shell asset с `cache: reload`, fail-closed не активирует неполный cache, activate удаляет только устаревшие Clean Pay caches и сохраняет caches других приложений;
- browser-contract тест исполняет worker через ServiceWorker/Cache API harness: устанавливает первую сборку, проверяет offline navigation, активирует вторую, доказывает удаление старого cache, сохранение постороннего cache и выдачу обновлённого offline shell. Отдельно проверяются HTTP cache headers и build-specific worker source;
- стабильный `tsconfig.typecheck.json` изолировал обязательный typecheck от автоматически меняемого `next-env.d.ts` и прерванных `.next/dev` артефактов. Профильные тесты 2/2, полный unit suite 375/375, integration 42/42, typecheck, ESLint без ошибок (один известный warning generated coverage) и production build 50/50 с `/sw.js` route прошли. Remnashop и Remnawave не менялись; production rollout ещё не выполнялся.

### 24. [x] Устранить эксплуатационные расхождения

Зафиксировать совместимую версию Remnashop в devcontainer вместо mutable `latest`, убрать дублирующие БД-индексы отдельной безопасной миграцией и синхронизировать документацию с фактическим API.

Результат:

- devcontainer собирает Remnashop из полного immutable commit `b9da68a651e9ab0b7ed52d030e13754311614759` ветки направленного PR [`snoups/remnashop#135`](https://github.com/snoups/remnashop/pull/135), а локальный overlay стороннего исходного кода удалён. `WEB_CABINET_URL` остаётся только HTTPS; поддержка HTTP loopback исключена. Единственная дополнительная dev/test-настройка `BOT_API_BASE_URL` типизированно направляет aiogram в локальный Telegram mock и отклоняет credentials/query/fragment;
- из Prisma schema удалены три лишних `@@index`, дублировавших unique B-tree индексы `WebUser.email`, `WebUser.telegramId` и `PaymentRecord.paymentId`. Отдельная идемпотентная миграция удаляет только известные индексы с bounded `lock_timeout`; runbook описывает preflight, проверку и безопасный повтор. Репетиция на непустой PostgreSQL сохранила 4 пользователей и контрольный платёж, оставила 3 unique индекса и 0 дубликатов;
- `src/app/api/ENDPOINTS.md` синхронизирован с реальными auth, payment, owner-verification, reconciliation и audit контрактами. Автоматический тест перечисляет каждый экспортированный HTTP method во всех `src/app/api/**/route.ts`, требует точного совпадения документации и проверяет существование упомянутых source-файлов;
- host E2E runner bounded ждёт bootstrap до 120 секунд и сообщает понятный timeout вместо гонки с установкой зависимостей. После удаления loopback текущий Remnashop head прошёл 153/153 теста, Ruff и mypy затронутого bot config; Clean Pay — typecheck и 455/455 тестов. Полный devcontainer E2E после смены pin не переобъявляется пройденным без нового запуска. Remnawave не изменялся.

## Базовая линия перед исправлениями

- Unit/integration: 29 файлов, 179 тестов — пройдены.
- ESLint — пройден.
- Production build с безопасными локальными placeholder-переменными — пройден.
- Coverage: statements 86.70%, branches 70.92%, functions 91.88%, lines 86.84%.
- Прямой `tsc --noEmit` — 29 существующих ошибок в тестах; это вынесено в пункт 22.
- Upgrade production-БД не выполнялся: для миграций обязателен отдельный rehearsal на непустой копии.

## Журнал выполнения

- 2026-07-19: production incident после rollout устранён без создания повторного платежа. Remnashop recovery нормализует legacy string enum в snapshot/response (`6b64a87`), исходная операция `cmrr2legx00111kulm84rum7q` восстановлена в `SUCCEEDED` с сохранённым payment URL, а отдельный reconciliation worker включён и healthy. Clean Pay развернут на `c676c20`, production branding указывает на существующий `/clean-pay-logo.png` (public `200 image/png`). После проверки fleet временный `payment_runtime_control.legacy_rollout_gate_active` транзакционно снят с backup; постоянные guards активной платёжной работы сохранены. PR #135 обновлён до `b9da68a`, 153/153 теста, Ruff и mypy затронутого bot config прошли; #136–#138 закрыты без merge, loopback #137 исключён, а dev/test изменение #138 находится только в #135. Remnawave не изменялся.

- 2026-07-17: аудит зафиксирован; начата работа над пунктом 1.
- 2026-07-17: пункт 1 исправлен и локально проверен: passkey suite 10/10, полный suite 183/183, ESLint без ошибок, production build успешен. Добавлены проверки нового, собственного, чужого, изменённого и конкурентно созданного credential.
- 2026-07-17: пункт 2 исправлен и локально проверен: профильный suite 58/58, полный suite 209/209, ESLint без ошибок в исходниках, production build успешен. Прямой `tsc --noEmit` сохранил базовые 29 ошибок тестовой типизации, новых ошибок не добавлено. Devcontainer E2E локально не запущен: Docker Desktop daemon недоступен; проверка перенесена на тестовый стенд перед production rollout.
- 2026-07-17: пункт 3 исправлен и локально проверен: расширенный профильный suite 92/92, полный suite 253/253, Prisma validate/generate, ESLint без ошибок в исходниках и production build успешны. Прямой `tsc --noEmit` сохранил базовые 29 ошибок тестовой типизации, новых ошибок в изменённых файлах нет. Companion Remnashop commits `b08549e` и `9e543bc` запушены в `fork/codex/clean-pay-integration-pr`: полный suite 19/19, Ruff, strict mypy по 521 файлу, compileall, Alembic head `0044`, migration SQL/diff-check прошли; опубликованная миграция `0043` не изменялась. Devcontainer/PostgreSQL E2E локально не запущен из-за недоступного Docker Desktop и остаётся release gate тестового стенда.
- 2026-07-18: пункт 4 исправлен и полностью проверен локально. Clean Pay: 39 файлов/320 тестов, Prisma validate/generate, ESLint без ошибок, production build, Compose/shell checks и реальная PostgreSQL crash/concurrency matrix. Remnashop: 131 тест, Ruff, strict mypy по 540 файлам, Alembic head `0049`, непустой и чистый upgrade/downgrade/re-upgrade, legacy writer, DB-clock lease fencing, webhook/fulfillment/manual-queue matrix и production Docker build. Companion fork обновлён, актуальный PR [`snoups/remnashop#135`](https://github.com/snoups/remnashop/pull/135) направлен в `dev`; код Remnawave не менялся. Production rollout не выполнялся.
- 2026-07-18: пункт 5 исправлен и проверен: опасные historical Prisma migrations стали атомарными и lossless, добавлен migration runbook и regression-suite. Полный suite 323/323, Prisma validate/generate, ESLint и production build прошли. На отдельной непустой PostgreSQL-БД проверены legacy backfill, точное сохранение Telegram IDs, fail-closed/rollback на malformed ID, полная migration chain, Prisma deploy/status и восстановление pre-migration custom dump. Production rollout не выполнялся.
- 2026-07-18: пункт 6 исправлен и проверен: оба merge-пути отзывают source-сессии, сохраняют passkeys, инвалидируют временные auth-состояния и fail-closed проверяют конечного владельца. Целевой suite 27/27, полный suite 329/329, ESLint без ошибок и Next.js production build прошли. Код Remnashop и Remnawave в этом пункте не изменялся; production rollout не выполнялся.
- 2026-07-18: пункт 7 исправлен и проверен: смена пароля заменяет текущую сессию и отзывает все прежние, refresh/revoke защищён CAS, failure после upstream success закрывается полным отзывом, passkeys сохраняются. Целевой suite 29/29, полный suite 332/332, ESLint без ошибок, production build и отдельный реальный PostgreSQL rehearsal прошли. Код Remnashop и Remnawave не изменялся; production rollout не выполнялся.
- 2026-07-18: пункт 8 исправлен и проверен: upstream refresh предшествует `/auth/me`, token bundle имеет одного владельца без клонирования, refresh сериализован DB-lock/CAS, а валидный web refresh сохраняется при page-навигации. Целевой suite 89/89, полный suite 336/336, ESLint без ошибок, production build и реальный PostgreSQL concurrency rehearsal прошли; два конкурента вызвали upstream refresh один раз. Код Remnashop и Remnawave не изменялся; production rollout не выполнялся.
- 2026-07-18: пункт 9 исправлен и проверен: Telegram recovery доказывает Telegram/account/e-mail владельца до возврата токенов, согласованно объединяет локальные и upstream-аккаунты, защищает платёжные операции и sibling-сессии, а потеря ответа допускает безопасный повтор. Clean Pay: 80/80 целевых, 321/321 unit и 32/32 integration-теста, ESLint и production build; PostgreSQL concurrency/rebind matrix прошла. Remnashop: 137/137 unit-тестов, Ruff и реальная reversible migration `0050`; fork commit `9cc68fb` запушен и PR [`snoups/remnashop#135`](https://github.com/snoups/remnashop/pull/135) обновлён. Remnawave не изменялся; production rollout не выполнялся.
- 2026-07-18: пункт 10 исправлен и проверен: единый production validator и изолированный `.env` parser применяются до Compose, в `start.sh`, `npm start` и runtime; закрыты unsafe origins/cookies, секреты, URL и Compose/DB/Redis consistency, environment interpolation и baked/runtime public origin drift. Целевые тесты 27/27, unit 329/329, integration 32/32, ESLint, production build 50/50, Docker build/runtime validation, Compose config и Alpine shell syntax прошли; прямой `tsc` сохранил 29 базовых test-only ошибок. Локальный deployment `.env` корректно fail-closed на `COOKIE_SECURE=false`; Remnashop и Remnawave не менялись, production rollout не выполнялся.
- 2026-07-18: пункт 11 исправлен и проверен: Remnawave subscription URL возвращается только для точного UUID и доказанного владельца с активной неистёкшей записью; identity fallback однозначно агрегирует дубли и отказывает на конфликтующих URL/кандидатах. Профильные тесты 36/36, unit 332/332, ESLint и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout не выполнялся.
- 2026-07-18: пункт 12 исправлен и проверен: `RATE_LIMITED` в identify возвращается как `429`, Redis counter атомарно получает TTL, Telegram limiter применяется только к подтверждённой identity, общий anonymous Telegram key удалён, а WebAuthn login challenge ограничен до DB-write. Отдельный IP/device limiter не добавлялся согласно reverse-proxy topology из плана. Профильные тесты 36/36, unit 336/336, integration 32/32, ESLint и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout не выполнялся.
- 2026-07-18: пункт 13 исправлен и проверен: WebAuthn challenge и Telegram state потребляются условным update с проверкой единственного изменённого ряда до внешних/локальных mutations. Профильные тесты 23/23, unit 338/338, integration 35/35, ESLint и production build 50/50 прошли; реальная PostgreSQL-конкуренция с 16 claim подтвердила ровно одного победителя для каждого state type и отказ для expired challenge. Remnashop и Remnawave не менялись; production rollout не выполнялся.
- 2026-07-18: пункт 14 исправлен и проверен: внешние HTTP paths получили abort timeout, readiness запускает шесть dependencies параллельно с общим 8-секундным deadline и 5-секундными per-check limits, причины timeout/deadline/HTTP/response ошибок различимы. Профильные тесты 92/92, unit 339/339, integration 36/36, ESLint и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout не выполнялся.
- 2026-07-18: пункт 15 исправлен и проверен: app healthcheck и оба deployment entrypoint принимают только полный healthy `/api/health/readiness`, `up` ждёт readiness до 120 секунд и fail-closed завершает deploy при malformed/degraded ответе либо недоступной dependency. Профильные тесты 39/39, unit 343/343, integration 36/36, ESLint, production build 50/50, Compose config и Alpine shell syntax прошли. Remnashop и Remnawave не менялись; production rollout ещё не выполнялся.
- 2026-07-18: пункт 16 исправлен и проверен: server-owned return URL привязан к платёжной операции и проверяется end-to-end, route не может объявить неподтверждённый успех, polling использует bounded exponential backoff и допускает ручное обновление. Clean Pay: профильные тесты 51/51, unit 347/347, integration 36/36, ESLint и production build 50/50 прошли. Companion Remnashop commit `a08c4c8` прошёл 140/140 unit-тестов и Ruff, запушен в fork и обновил PR [`snoups/remnashop#135`](https://github.com/snoups/remnashop/pull/135); Remnawave не изменялся, production rollout ещё не выполнялся.
- 2026-07-18: пункт 17 исправлен и проверен: login, purchase и extend гарантированно снимают loading после transport/parse/processing ошибок, non-JSON success не принимается за подтверждённый результат, а неопределённый платёж повторяется с тем же idempotency key. Browser-level профильные тесты 15/15, unit 354/354, integration 36/36, ESLint и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout ещё не выполнялся.
- 2026-07-18: пункт 18 исправлен и проверен: все JSON BFF routes fail-closed возвращают `400` на malformed/non-object body, payment fields проходят строгую runtime-валидацию, а подтверждённые amount/currency/version входят в idempotency contract и повторно сверяются перед dispatch. Клиент показывает изменение цены «было → стало» до invoice. Профильные тесты 72/72, unit 365/365, integration 38/38, ESLint и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout ещё не выполнялся.
- 2026-07-18: пункт 19 исправлен и проверен: promocode, reissue и обе device mutations используют attempted/succeeded/failed audit lifecycle; success пишется строго после upstream mutation, failure содержит только безопасную классификацию и никогда не сопровождается ложным success. Профильные тесты 36/36, unit 367/367, integration 42/42, ESLint и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout ещё не выполнялся.
- 2026-07-18: пункт 20 исправлен и проверен: always-on retention-worker применяет документированную bounded policy к auth states, verification codes, sessions, audit и rate-limit rows, heartbeat включён в deployment gate; raw identity/PII централизованно редактируется из log/audit metadata. Профильные тесты 28/28, unit 371/371, integration 42/42, ESLint, production build 50/50, Compose/syntax, production Docker build/smoke и реальная PostgreSQL boundary matrix прошли. Remnashop и Remnawave не менялись; production rollout ещё не выполнялся.
- 2026-07-18: пункт 21 исправлен и проверен: единая local redirect policy валидирует исходный `redirect_to` и сохраняет его через password, passkey, Telegram OIDC и Telegram WebApp login; external/auth-loop destinations дают безопасный `/cabinet` fallback. Профильные тесты 28/28, unit 373/373, integration 42/42, ESLint и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout ещё не выполнялся.
- 2026-07-18: пункт 22 исправлен и проверен: полный TypeScript check тестов стал обязательным локальным/CI gate, все type errors устранены, а full-stack contracts и devcontainer runner стали точными, герметичными и воспроизводимыми на Windows Docker Desktop. Typecheck, unit 373/373, integration 42/42, ESLint, production build 50/50 и чистый full-stack E2E 104/104 прошли. Remnashop и Remnawave не менялись; production rollout ещё не выполнялся.
- 2026-07-18: пункт 23 исправлен и проверен: cache/service worker связан с ID конкретной сборки, offline shell обновляется fail-closed без удаления чужих caches, а браузерная Cache API matrix доказывает переход build-one → build-two. Typecheck, профильные тесты 2/2, unit 375/375, integration 42/42, ESLint и production build 50/50 прошли. Remnashop и Remnawave не менялись; production rollout ещё не выполнялся.
- 2026-07-18: пункт 24 первоначально закрепил devcontainer на SHA Remnashop и удалил локальный source overlay. На 19 июля pin актуализирован до `b9da68a651e9ab0b7ed52d030e13754311614759`: HTTP loopback исключён, `WEB_CABINET_URL` снова требует HTTPS, а в PR #135 сохранён только необходимый локальному Telegram mock контракт `BOT_API_BASE_URL`. Три дублирующих индекса удалены bounded идемпотентной миграцией, отрепетированной на непустой PostgreSQL без потери данных; API docs автоматически совпадают со всеми route methods. Текущий Remnashop head прошёл 153/153 теста, Ruff и mypy затронутого bot config; новый полный devcontainer E2E после смены pin ещё не запускался. Remnawave не изменялся.
- 2026-07-19: дополнительный regression пунктов 6 и 9 исправляет частичную Telegram-привязку при разных подтверждённых e-mail. До явного предупреждения о замене e-mail никакие локальные/upstream identity не меняются; подтверждение имеет hash-only token, срок, CAS/lease и safe replay, включая восстановление после потерянного ответа уже применённого upstream merge. Явные политики существующего PR `snoups/remnashop#135` сохраняют target e-mail, выбранный source Telegram, подписку, Telegram-профиль, баллы, скидки и все платежи; совпавшие idempotency-ключи детерминированно rekey source-операцию без удаления истории и без возможности повторного списания. Единственный terminal product-conflict — две текущие подписки; активная платёжная работа остаётся retryable. После merge повторно доказываются итоговые Remnashop user/e-mail/Telegram и наличие текущей подписки, затем атомарно переносятся локальные payments/passkeys/audit и отзываются source-сессии. Clean Pay: typecheck, 455/455 unit, 38 route integration, ESLint без ошибок в исходниках, production build 51/51 и production Docker build; PostgreSQL: 7/7 concurrency/merge-тестов, rollback и повторный upgrade additive-миграции на непустой схеме. Remnashop: 147/147, Ruff и production Docker build; полный mypy сохраняет единственную существующую ошибку внешнего контракта `WebhookPayloadDto.meta` в неизменённом `src/web/endpoints/remnawave.py`. Remnawave не изменялся; test/production rollout ещё не выполнялся.
- 2026-07-19: test и production rollout завершены. Test (`oplata.clear-vpn.org`) развернут на Clean Pay `10cd9d9d902c99e936e072bc5dd001896432228b` и Remnashop `6aa25b515b3e91a987ed65614dd8891d6a2355e3`; readiness, SMTP TLS-auth без отправки, CSRF/origin и identity consistency прошли. Production (`cleanvpn.edge-connect.uk`) предварительно проверен на восстановленных копиях обеих БД; из-за совпадения номеров старых и новых Alembic `0041/0042` выполнен проверенный schema bridge старых password/merge-audit миграций в новую цепочку `0045/0046`, после чего Remnashop штатно дошёл до `0050`. Первый fail-closed запуск обнаружил оставленный на сервере слабый placeholder PostgreSQL и неустойчивый ручной Docker alias; пароль роли безопасно ротирован, а повторный rollout выполнен через штатный `deploy/prod/docker-compose.yml` с декларативной external network/alias. Финальный production: app и retention healthy на `10cd9d9`, Remnashop HTTP/worker/scheduler на производном образе `6aa25b5`, PLATEGA и YOOKASSA активны, SMTP auth, public readiness/plans, migration presence, CSRF и error-log scan прошли. Три обязательных Remnashop compatibility-скрипта выполнены последовательно в отдельном `screen`; HWID и expiration подтверждены нативными в новой зависимости, hosts compatibility запечена в производный образ и повторно проверена runtime assertions. Backup: `/opt/deployment-backups/prod-rollout-20260719T002539Z`. Для реального проблемного владельца dry-run `56 → 18808` с политиками `KEEP_TARGET`/`KEEP_SOURCE`/`REKEY_SOURCE` вернул пустой список конфликтов; реальный merge без нового пользовательского подтверждения намеренно не выполнялся. Финальный контракт требует, чтобы после подтверждения e-mail и выбранный Telegram ID разрешались в один Remnashop user UUID и обе поверхности показывали одну текущую подписку; mismatch отменяет локальную фиксацию. PR #136–#138 закрыты без merge: hardening #136 отложен, loopback #137 исключён, custom Telegram API #138 перенесён в единственный upstream PR #135.
