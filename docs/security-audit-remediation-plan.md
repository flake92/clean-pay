# План устранения результатов security-аудита Clean Pay + Remnashop

## Карточка документа

| Поле | Значение |
|---|---|
| Статус | В реализации; выполняется по одному проверяемому пункту и коммиту |
| Дата первичной проверки | 2026-07-27 (MSK) |
| Проверенный Clean Pay commit | `d2637e1`, `main` / `origin/main` |
| Проверенный Remnashop commit | PR [#135](https://github.com/snoups/remnashop/pull/135), `b9da68a` |
| Дополнительно проверен | закрытый без merge PR [#136](https://github.com/snoups/remnashop/pull/136), `377f981` |
| Область | Межпроектная идентичность и auth, production-зависимости, account enumeration, anti-abuse без client-IP, password recovery, production containers |
| Целевой результат | Нулевые production dependency advisories, отсутствие поддерживаемого account-state oracle, fail-closed anti-abuse, закрытая server-to-server граница Remnashop auth, зелёный полный regression suite обоих проектов |
| Владелец решений | Ожидает назначения |
| Владелец реализации | Ожидает назначения |

Этот файл одновременно является:

1. отчётом о подтверждённых фактах;
2. планом исправления;
3. листом вопросов на утверждение;
4. append-only журналом решений, работ, проверок и релизов.

До начала журнала изменений production-код и зависимости не изменялись. Реализация ниже ведётся последовательно: один пункт, полный соразмерный набор проверок, отдельный коммит и остановка для пользовательской приёмки.

## 1. Краткий вывод

Исходный аудит в основной части подтверждён, но проверка кода Remnashop расширила область обязательного исправления.

- В текущем lock-файле действительно присутствуют 10 production-уязвимостей: 5 `high` и 5 `moderate`.
- Обновления только `next` с `16.2.9` до `16.2.12` недостаточно: прямые advisory Next закрываются, но уязвимые транзитивные зависимости остаются.
- В изолированной копии `package.json` и `package-lock.json` найден кандидат, для которого `npm audit --omit=dev` возвращает `found 0 vulnerabilities`. Это пока только доказательство разрешимости dependency graph: установка, build и тесты на этом графе ещё не выполнялись.
- `/api/bff/auth/identify` действительно раскрывает существование аккаунта и наличие Passkey.
- При любой ошибке Redis, кроме штатного `RATE_LIMITED`, этот endpoint продолжает запрос к PostgreSQL и возвращает `200`. Поведение fail-open не случайно: оно закреплено unit-тестом.
- Это противоречит уже принятому в документации правилу fail-closed при недоступности Redis.
- В Remnashop нет и не требуется отдельная сущность «идентификация»: каноническая сущность — строка `users`, её `id` попадает в JWT `sub`; Clean Pay хранит локальную проекцию с уникальным `remnashopUserId`.
- `/identify` проверяет только локальную БД Clean Pay. Поэтому он не только раскрывает данные, но и может ошибочно вернуть `exists: false` для существующего в Remnashop пользователя, который ещё не синхронизирован с Clean Pay.
- Текущий `registerWithEmail` в Clean Pay уже умеет работать без предварительного `identify`: сначала вызывает Remnashop `/auth/register`, а при конфликте существующего e-mail пробует `/auth/login` с тем же паролем. Прежняя рекомендация обязательно разделить login/register после ввода e-mail была избыточной.
- PR #135 добавляет в существующую модель `users` email/password auth. README по-прежнему описывает Remnashop прежде всего как Telegram-бот; отдельного внешнего identity-provider слоя документация не заявляет.
- В PR #135 публичный password-reset confirm принимает e-mail и шестизначный код без счётчика неудачных попыток и без общего HTTP rate limit. Если `/api/v1/public/auth/*` доступен из Интернета, это существенная brute-force поверхность и одновременно обход любых ограничений Clean Pay.
- Документированный deployment делает такую доступность вероятной: Clean Pay README использует `https://shop.example.com/api/v1/public`, а public router PR #135 не требует `APP_API_KEY`. Передаваемый Clean Pay `REMNASHOP_API_KEY` используется для admin API и сам по себе не защищает public auth.
- PR #136 закрывает этот password-reset риск Redis-backed cooldown/attempt limit и блокировками. Его patch чисто накладывается на точный commit PR #135; объединённый вариант прошёл `165/165` тестов и Ruff.
- Python production lock PR #135 содержит 81 advisory-запись в 10 registry-пакетах. Полный совместимый dependency-кандидат дал `0` известных registry advisory и прошёл тесты, Ruff и выборочный mypy, но production build/migration rehearsal ещё обязательны. VCS-зависимость `remnapy` не покрывается `pip-audit` автоматически.

Рекомендуемый путь:

1. удалить локальный account-state oracle и оставить единый auth flow, который не выбирает действие по результату публичного lookup;
2. не использовать client IP как security primitive: применить Turnstile с проверкой `action`, независимый HMAC-bucket по цели, общий capacity-bucket по действию и ограничение конкурентной нагрузки;
3. при ошибке Redis прекращать обработку до обращения к БД/provider; для обычного auth возвращать контролируемый `503`, а для enumeration-sensitive recovery request — одинаковый generic-ответ без отправки письма;
4. закрыть прямой публичный доступ к Remnashop auth или защитить его отдельной server-to-server аутентификацией, иначе BFF-защита обходится;
5. перенести hardening PR #136 в актуальную ветку Remnashop;
6. обновить зависимости обоих проектов через проверенный release candidate, полный regression suite и canary;
7. отдельным этапом отделить migration jobs от runtime-контейнеров и проверять фактический состав production images.

## 2. Подтверждённый baseline и доказательства

### 2.1. Зависимости

Текущие прямые версии:

- `next: 16.2.9` — `package.json:32`;
- `eslint-config-next: 16.2.9` — `package.json:47`.

Production Docker build использует lock-файл через `npm ci`, поэтому результат воспроизводим относительно текущего `package-lock.json`.

Команда:

```text
npm audit --omit=dev
```

Подтверждённый результат:

```text
10 vulnerabilities (5 high, 5 moderate)
```

Затронутые package groups:

| Severity | Пакеты |
|---|---|
| High | `next`, `postcss`, `sharp`, `fast-uri`, `immutable` |
| Moderate | `@hono/node-server`, `@prisma/dev`, `hono`, `prisma`, `valibot` |

Установленные транзитивные версии из текущего lock-файла:

| Пакет | Текущая версия | Минимальная безопасная граница по advisory | Кандидат |
|---|---:|---:|---:|
| `next` | `16.2.9` | `>=16.2.11` для найденных прямых advisory | `16.2.12` |
| `postcss` | `8.4.31` | `>=8.5.18` | `8.5.23` |
| `sharp` | `0.34.5` | `>=0.35.0` | `0.35.3` |
| `fast-uri` | `3.1.2` | `>=3.1.4` | `3.1.4` |
| `immutable` | `5.1.6` | `>=5.1.8` | `5.1.9` |
| `hono` | `4.12.26` | `>=4.12.27` | `4.12.32` |
| `@hono/node-server` | `1.19.11` | `>=2.0.5` для всех найденных advisory | `2.0.12` |
| `valibot` | `1.2.0` | `>=1.4.2` | `1.4.2` |
| `find-my-way` | транзитивный | `>=9.7.0` | `9.7.0` |
| Prisma packages | `7.8.0` | обновление цепочки необходимо для remediation | `7.9.0` |

Важные результаты dependency-spike:

1. Изолированное обновление только `next` и `eslint-config-next` до `16.2.12` оставляет 10 production-уязвимостей.
2. Автоматический `npm audit fix --force` предлагал несовместимое понижение Next до `9.3.3`; использовать эту команду вслепую нельзя.
3. Изолированный lock-only кандидат со следующими версиями дал `found 0 vulnerabilities`:

```json
{
  "dependencies": {
    "next": "16.2.12",
    "@prisma/adapter-pg": "7.9.0",
    "@prisma/client": "7.9.0"
  },
  "devDependencies": {
    "eslint-config-next": "16.2.12",
    "prisma": "7.9.0"
  },
  "overrides": {
    "postcss": "8.5.23",
    "sharp": "0.35.3",
    "fast-uri": "3.1.4",
    "immutable": "5.1.9",
    "hono": "4.12.32",
    "@hono/node-server": "2.0.12",
    "valibot": "1.4.2",
    "find-my-way": "9.7.0"
  }
}
```

Это не разрешение на выпуск. `sharp 0.35.x` и `@hono/node-server 2.x` выходят за проверенные текущими upstream-пакетами диапазоны и требуют runtime-проверок.

### 2.2. Account enumeration

Endpoint `src/app/api/bff/auth/identify/route.ts`:

- принимает e-mail;
- обращается к БД;
- возвращает `exists` и `hasPasskey` на строках 57–58.

Endpoint публичный: он находится в списке публичных маршрутов в `src/proxy.ts`.

Frontend использует ответ как ветвление бизнес-потока:

- отправляет запрос на `/api/bff/auth/identify` в `src/frontend/components/auth-forms.tsx:150`;
- сохраняет `hasPasskey` в строке 170;
- выбирает `/api/bff/auth/login` или `/api/bff/auth/register` по `knownLocalUser` в строке 205.

E2E-тесты также фиксируют различимый контракт:

- неизвестный e-mail: `{ exists: false, hasPasskey: false }`;
- существующий пользователь: `exists: true`.

Следствие: любой внешний клиент может отличить зарегистрированный e-mail от незарегистрированного и дополнительно узнать наличие Passkey. Пароль и доступ к аккаунту это не раскрывает, но облегчает таргетированный фишинг и составление списка пользователей.

### 2.3. Fail-open при недоступном Redis

В `src/app/api/bff/auth/identify/route.ts:24` вызывается `assertRateLimit`.

Обработка исключений:

- `RATE_LIMITED` пробрасывается;
- любая другая ошибка логируется как `auth_identify_rate_limit_unavailable`;
- после этого выполняется запрос к PostgreSQL и формируется обычный ответ.

Unit-тест `tests/unit/backend/anti-abuse-routes.test.ts:81` намеренно моделирует ошибку Redis и ожидает:

- HTTP `200`;
- выполнение запроса к БД.

То есть это подтверждённое и покрытое тестом fail-open поведение.

Оно противоречит `docs/security-reliability-remediation-plan.md:28`, где закреплено:

```text
Работать в режиме fail closed, без обхода rate limit при недоступности Redis.
```

Тот же документ в строке 183 требует ограниченный по времени ответ `503` и безопасный повтор на frontend.

### 2.4. Ограничения текущего composite rate-limit key

Текущий helper в `src/backend/limits/rate-limit.ts` строит один ключ из всех переданных измерений: action, e-mail, Telegram ID и IP. Один composite bucket не ограничивает измерения независимо.

По решению пользователя client IP исключён из предлагаемой модели. Это снимает зависимость от `X-Forwarded-For`, NAT, IPv6 privacy addresses и конфигурации доверенного proxy, но требует нескольких независимых защит:

- target bucket по HMAC от нормализованного e-mail или другого идентификатора цели;
- общий высокопороговый capacity bucket по действию, не зависящий от существования пользователя;
- bucket по аутентифицированной локальной session/user identity там, где сессия уже есть;
- action-bound Turnstile для анонимных auth-операций;
- ограничение числа одновременно выполняемых дорогих операций и числа незавершённых Passkey challenge.

Target и capacity buckets следует обновлять одной Redis Lua-операцией: это даст атомарность и единый fail-closed результат. Общий bucket не должен быть основным auth-решением: слишком низкий порог позволит устроить глобальный отказ в обслуживании. Его назначение — верхняя граница нагрузки; порог выбирается по production-метрикам, а защита дополняется bounded concurrency/load shedding.

Target bucket также не должен бессрочно блокировать правильный пароль. После порога неудач рекомендуется переводить flow на proof-of-possession (email code, Passkey или Telegram) с одинаковым публичным ответом для known/unknown e-mail. Это ограничивает online guessing и одновременно оставляет владельцу альтернативный путь входа.

Текущий `src/backend/security/turnstile.ts`:

- опционально отправляет `remoteip`, от чего можно отказаться;
- проверяет `success` и ожидаемый `hostname`;
- не описывает и не проверяет поле ответа `action`;
- включается через `TURNSTILE_ENABLED`, значение по умолчанию — `false`, а отдельного production-инварианта в конфигурации нет.

Следовательно, Turnstile уже интегрирован, но для no-IP модели его нужно сделать обязательным в production и связать token с конкретным auth action.

### 2.5. Подтверждённые проверки текущего кода

На исходном commit выполнено:

| Проверка | Результат |
|---|---:|
| Lint | успешно |
| Typecheck | успешно |
| Unit tests | `475/475` |
| Route-handler tests | `44/44` |
| Integration tests на чистой PostgreSQL | `58/58` |
| Full-stack Docker E2E | `104/104` |
| Production build | успешно |
| Prisma migrations на чистой PostgreSQL | `15/15` применены |
| Поиск секретов по репозиторию | совпадений не найдено |
| Поиск опасных raw SQL, `eval`, `innerHTML`, `dangerouslySetInnerHTML` | совпадений не найдено |

Примечание по воспроизводимости: integration suite должен запускаться на чистой одноразовой БД. На уже заполненной E2E-базе три теста были пропущены из-за коллизии статического `remnashopUserId`; повтор на новой БД дал `58/58`. Это не подтверждённая production-уязвимость, но отдельный долг тестовой изоляции.

### 2.6. Модель идентичности Remnashop и связь с Clean Pay

Проверены README, исходный код точного commit PR #135 и фактическая интеграция Clean Pay.

В Remnashop нет отдельной таблицы «account» или «identity provider». Модель `src/infrastructure/database/models/user.py` содержит одну каноническую сущность `User`:

- `id` — первичный идентификатор;
- nullable unique `telegram_id`;
- nullable unique `email`;
- `password_hash` и поля подтверждения/recovery.

Миграция PR #135 добавляет email/password поля в существующую таблицу `users` и разрешает `telegram_id = NULL`. JWT создаётся с `sub = user.id` в `src/web/endpoints/public/_common.py:37`.

Clean Pay не должен повторно «идентифицировать» этого пользователя отдельной сущностью:

1. Clean Pay вызывает Remnashop `/auth/register`, `/auth/login` или `/auth/telegram`.
2. Из JWT `sub` извлекается Remnashop user ID.
3. `/auth/me` подтверждает upstream-профиль.
4. `src/backend/integrations/remnashop/session.ts` связывает или создаёт локальный `WebUser`.
5. `WebUser.remnashopUserId` в `prisma/schema.prisma:69` является уникальной ссылкой на канонического upstream-пользователя.

Локальный `WebUser` нужен для сессии Clean Pay, Passkey, платежного ownership и recovery, но не является вторым каноническим аккаунтом Remnashop.

Вывод для Q-001: `/api/bff/auth/identify` не участвует в установлении канонической идентичности. Он лишь предварительно читает локальную проекцию и может быть удалён без добавления новой сущности в Remnashop.

### 2.7. Фактический email auth flow

`src/backend/auth/email-register.ts:21-50` уже реализует единый server-side flow:

1. попытка Remnashop `/auth/register`;
2. если e-mail уже существует, попытка `/auth/login` с теми же credentials;
3. при успехе — создание локальной сессии из Remnashop identity.

Следовательно, UI может показывать одно действие «Продолжить» и всегда вызывать этот flow без `/identify`. Отдельные страницы login/register допустимы как UX-вариант, но технически не обязательны.

Остаточный риск: PR #135 сам отвечает `409 Email already exists` на прямой `/auth/register`. Полное устранение enumeration достигается только если:

- этот endpoint недоступен внешнему клиенту и вызывается только Clean Pay; либо
- контракт Remnashop также меняется на неразличимый двухфазный flow с подтверждением владения e-mail.

### 2.8. Прямая поверхность Remnashop auth и password reset

В PR #135 маршруты `src/web/endpoints/public/auth.py` являются публичными. `src/web/app.py` подключает `public_router` без router-level dependency, а auth endpoints не вызывают `require_api_key`. Общего HTTP rate limiter для email auth в проверенном коде не найдено.

`src/application/use_cases/auth/commands/password.py:164-216` проверяет шестизначный reset code, но в PR #135 отсутствуют:

- счётчик неверных confirm-попыток;
- лимит на перебор одной цели;
- атомарная блокировка конкурентных confirm;
- общий HTTP anti-abuse слой.

Confirm endpoint дополнительно различает состояния: неизвестный/заблокированный пользователь получает `400 Invalid or expired reset code`, известный пользователь без reset request — `400 Password reset was not requested`, истёкший request — `410`. Это самостоятельный account/reset-state oracle.

Запрос reset маскирует неизвестный e-mail, но resend cooldown применяется к состоянию найденного пользователя. Главный риск — перебор confirm code. Если public auth Remnashop доступен из Интернета, атакующий может обойти Turnstile и Redis limits Clean Pay полностью.

PR #136 реализует HMAC-ключи в Redis, request cooldown, максимум 5 confirm-попыток за 15 минут, owner-safe lock, PostgreSQL `FOR UPDATE` и очистку счётчика после успеха. PR закрыт без merge, хотя patch чисто применяется к точному commit PR #135. При этом PR #136 сохраняет различимые `400/410` и тексты confirm-reset, поэтому brute-force hardening нужно дополнить generic external error contract.

Clean Pay README на строках 78–80 рекомендует `REMNASHOP_API_BASE_URL=https://shop.example.com/api/v1/public`. Production validator допускает как public HTTPS, так и internal HTTP service host. Поэтому deployment по README выставляет public auth на публичном origin; `REMNASHOP_API_KEY=<APP_API_KEY>` этого не исправляет, поскольку PR #135 проверяет этот ключ на admin/health paths, но не на public auth.

Фактическая production-топология всё же не доказана: `deploy/prod/.env` с реальным `REMNASHOP_API_BASE_URL` отсутствует, а во время повторной проверки запущенных Docker-контейнеров не было. Необходимо проверить реальный ingress, DNS и access logs.

### 2.9. Passkey и upstream-сессия

Passkey принадлежит локальному `WebUser` Clean Pay. `src/backend/auth/passkeys.ts:378-417` проверяет локальный credential и создаёт локальную сессию.

Remnashop при этом не получает доказательство WebAuthn и не выпускает новый JWT. `getAuthorizedRemnashopTokens` в `src/backend/integrations/remnashop/client.ts:1274-1364` может продолжить работу только со свежими/refresh upstream tokens или через Telegram recovery; иначе возвращает `EMAIL_REQUIRED`.

Следствие: текущий Passkey — полноценный вход в локальную сессию Clean Pay, но не автономный способ заново получить Remnashop-сессию после утраты upstream token bundle. Это не account-identification проблема, однако поведение должно быть явно отражено в UX и критериях приёмки.

### 2.10. Remnashop dependency audit

Для точного `uv.lock` PR #135 выполнен frozen export production dependencies и `pip-audit --no-deps`.

| Граф | Результат registry-аудита | Проверка кода |
|---|---:|---|
| Точный PR #135 lock | 81 advisory-запись в 10 пакетах | `153/153` tests, Ruff успешно, выборочный mypy успешно |
| Обычный `uv lock --upgrade` | 12 advisory-записей в 2 пакетах | Не является полным исправлением |
| Исследованный совместимый кандидат | `0` известных advisory | `153/153` tests, Ruff и выборочный mypy успешно |
| PR #135 + patch PR #136 + dependency candidate | `0` известных registry advisory | `165/165` tests, Ruff успешно |

После обычного upgrade остаются:

- `aiohttp 3.13.5`: диапазон удерживается `aiogram~=3.25.0`, а исправление требует более новой ветки;
- `cryptography 46.0.7`: pinned VCS `remnapy` ограничивает `<47`, тогда как исправление advisory требует `>=48.0.1`.

Исследованный кандидат использовал `aiogram~=3.30.0`, `aiohttp 3.14.3`, `cryptography 49.0.0` и обновлённый FastAPI/Starlette stack. Временный `uv` override доказывает совместимость тестов, но постоянное решение — исправить диапазон `cryptography` в `remnapy`, выпустить/зафиксировать проверенный revision и затем пересобрать `uv.lock`.

Ограничение доказательства: `pip-audit` не проанализировал исходники VCS-зависимости `remnapy`; production image build, миграции и E2E на кандидате ещё не выполнялись.

## 3. Цели и границы

### Цели

- Нулевой результат `npm audit --omit=dev`.
- Нулевой результат registry production audit Remnashop с отдельной проверкой VCS-зависимостей.
- Одинаковый публичный ответ и сопоставимое время обработки для известного и неизвестного e-mail.
- Отсутствие БД-запроса, целью которого является публичное определение наличия аккаунта.
- Anti-abuse без зависимости от client IP: target/action/session buckets, challenge и concurrency caps.
- Fail-closed при timeout, protocol error или недоступности Redis.
- Невозможность обойти Clean Pay BFF через прямой публичный Remnashop auth.
- Сохранение корректной работы email login/register, usernameless Passkey, WebAuthn, Telegram OIDC, платежей и recovery.
- Воспроизводимые Docker builds обоих проектов и проверяемый rollback.

### Не входит в немедленный hotfix

- Изменение схемы PostgreSQL или бизнес-данных.
- Перепроектирование платежного домена.
- Замена Redis или PostgreSQL.
- Полный редизайн auth UI.
- Устранение dev-only advisory, если они не попадают в production image; они учитываются отдельным отчётом.

## 4. Вопросы на утверждение

Ответы следует вписывать в колонку «Решение». После утверждения в журнал добавляется отдельная строка `DEC-*`; старые строки журнала не редактируются.

| ID | Вопрос | Рекомендация | Альтернатива и последствия | Решение | Статус |
|---|---|---|---|---|---|
| Q-001 | Утверждаем ли двухэтапное устранение enumeration? | Да: A) немедленно удалить `identify`/`hasPasskey` oracle и закрыть Remnashop boundary; B) сделать generic email start/complete с подтверждением владения адресом | Ограничиться этапом A: прямой lookup исчезнет, но combined register/login сможет косвенно различать новый e-mail и существующий e-mail с неверным паролем |  | Ожидает |
| Q-003 | Как оформляем dependency fixes за пределами текущих upstream ranges? | Clean Pay: временные exact npm overrides с owner/expiry. Remnashop: исправить constraint в `remnapy` и закрепить проверенный revision; `uv override` допустим только как time-bound аварийная мера | Ждать upstream-релизов — известные advisory дольше останутся в production |  | Ожидает |
| Q-008 | Какая server-to-server граница для Remnashop auth утверждается? | Internal Docker/network URL плюс отдельный least-privilege BFF credential на `/api/v1/public/auth/*`; наружу оставить только действительно необходимые webhook endpoints | Для удалённого Remnashop — mTLS или тот же отдельный service credential. Оставить auth публичным означает возможность обхода BFF |  | Ожидает подтверждения topology/клиентов |
| Q-009 | Какая семантика Passkey должна быть целевой? | Немедленно: локальный вход + явный step-up email/Telegram при отсутствии upstream tokens. Долгосрочно: Remnashop сам проверяет WebAuthn и выдаёт обычный JWT | Signed token exchange заставит Remnashop доверять Clean Pay на impersonation всех связанных users и расширит trust boundary |  | Ожидает |
| Q-010 | Как гарантировать резервный пароль для уже подтверждённого Telegram e-mail, у которого в Remnashop отсутствует `password_hash`? | Добавить в Remnashop authenticated-признак `has_password` и безопасный idempotent flow создания первого пароля после подтверждения владения e-mail; до готовности не обещать автономный email-login | Только локальный proof в Clean Pay может fail-closed блокировать оплату, но не создаст пароль: редкий legacy/direct-verification случай потребует поддержки и ухудшит конверсию |  | Ожидает межпроектного решения |

Уже определённые ограничения, не требующие повторного утверждения:

- A-001—A-004 были временными обозначениями четырёх дополнительных вопросов в рабочем обсуждении и не относятся к реестру `Q-*` этого документа. По указанию пользователя они сняты; это не утверждает и не изменяет ответы на Q-001, Q-003, Q-008 или Q-009.
- Q-002: fail-closed уже закреплён в `docs/security-reliability-remediation-plan.md`; требуется привести код и тест к принятому правилу.
- Q-004: снят с рассмотрения по решению пользователя. Client IP и forwarded headers не используются в предлагаемом rate-limit решении.
- Q-005: release gate — `0` известных production advisory обоих registry-графов; исключение возможно только отдельным time-bound risk acceptance.
- Q-006: отделение migration job остаётся следующим hardening-релизом и не блокирует срочное исправление.
- Q-007: численные thresholds являются конфигурацией rollout: сначала observe-only метрики и нагрузочный тест, затем canary; отдельное продуктовое решение не требуется.

Блокирующие изменение межпроектного контракта решения: Q-001, Q-008, Q-009 и Q-010. Q-003 блокирует фиксацию финальных lock-файлов. Q-010 не блокирует новый сопровождаемый flow для Telegram-only пользователя, но блокирует глобальное обещание резервного пароля для любого исторического состояния.

## 5. Целевой auth-контракт

### Рекомендуемый вариант

1. `/api/bff/auth/identify` удаляется; если требуется короткий переходный период, он отвечает статически без БД/provider lookup.
2. UI не выбирает login/register по `exists`. Краткосрочно одно действие «Продолжить» может использовать существующий register-first/login-fallback flow Clean Pay.
3. Usernameless Passkey login доступен независимо от e-mail. Backend уже создаёт generic challenge без account-specific `allowCredentials`, поэтому раскрывать `hasPasskey` не требуется.
4. Remnashop auth не доступен браузеру напрямую: запросы принимает только BFF/service identity.
5. Login возвращает одну generic-ошибку для неизвестного e-mail и неверного пароля; dummy password verification сохраняется.
6. Для полного устранения register oracle вводится двухфазный контракт:
   - `email/start` всегда отвечает одинаковым `202`, независимо от account state;
   - письмо/код отправляется согласно внутреннему состоянию, без его раскрытия;
   - `email/complete` после доказательства владения адресом выполняет регистрацию, login/step-up или recovery;
   - до подтверждения e-mail не создаются пользователь и сессия.
7. Known/unknown e-mail неразличимы по status, body shape, headers и статистически сопоставимому времени до доказательства владения e-mail.
8. Passkey создаёт локальную сессию; если upstream token bundle недоступен, UI запрашивает step-up, а не обещает полностью автономный Remnashop login.

Не рекомендуется оставлять скрытый lookup в `identify` и только маскировать body: различие сохранится через timing и побочные эффекты.

Общий email-register flow и Telegram-link flow используют разный безопасный порядок попыток. `registerWithEmail` выполняет register-first/login-fallback, а `linkRemnashopAccount` — login-first/register-fallback. Эти контракты нельзя описывать как один и тот же алгоритм.

### Изменение UX

Пользователь потеряет только скрытое переключение логики по локальной БД. Интерфейс может сохранить одну кнопку «Продолжить» и независимо показывать «Войти с Passkey». На полном двухфазном контракте добавится подтверждение e-mail до регистрации/recovery. Для существующего пользователя это может быть дополнительным шагом, зато account state не раскрывается до подтверждения владения адресом.

## 6. План реализации

### Приоритетная очередь исполнения

По решению пользователя работа выполняется небольшими независимо проверяемыми изменениями:

1. **UI-1 — представление устройств:** не выводить в DOM видимый HWID и необработанный User-Agent, показывать тип устройства, ОС и клиент с доступными версиями. BFF по-прежнему передаёт эти поля браузеру, потому что HWID необходим для удаления.
2. **AUTH-UX-1 — сопровождаемый Telegram → e-mail/password flow:** после Telegram-входа довести пользователя через ввод e-mail, создание или проверку пароля и, когда это требуется состоянием адреса, подтверждение кода обратно к исходной оплате; отдельно предложить установку приложения и Passkey.
3. **SEC-1—SEC-7 — security remediation:** выполнить этапы 0–7 ниже, включая закрытую Remnashop auth boundary, password-reset hardening, зависимости, enumeration, fail-closed anti-abuse и Passkey contract.
4. **OPS-1 — воспроизводимое обновление и откат:** immutable images, отдельные миграции, проверяемый backup/restore, release manifest и rehearsal обновления/rollback.
5. **REL-1 — тестовый стенд:** развернуть зафиксированные baseline/candidate версии, выполнить межпроектные smoke/E2E без реального списания и проверить повторное обновление.
6. **DOC-1 — README:** актуализировать пользовательские сценарии, межпроектную границу, установку, обновление, rollback и release gates.

После каждого пункта работа останавливается на отдельном коммите для ручной проверки и решения о продолжении.

### Этап UI-1. Понятное представление устройств

1. Использовать уже доступные поля Remnashop: `device_model`, `platform`, `os_version`, `user_agent`; upstream API не изменять.
2. Показывать три поля: «Тип устройства», «ОС», «Клиент».
3. Преобразовывать начальный фрагмент `Client/version` или `Client version` в компактное значение, например `INCY 2.4.7`, `Happ 5.2.0` или `Streisand 1.6.48`; служебный хвост User-Agent не показывать.
4. Если модель является технической архитектурой (`byte_x86_64`, `aarch64` и аналоги), использовать платформу: например, `Windows`.
5. Если значение отсутствует, показывать `—`; неизвестные версии ОС сохранять без попытки угадать их семантику.
6. HWID сохранить только как внутренний ключ операции удаления, но не выводить пользователю.
7. Добавить регрессионные тесты для iOS/INCY, iOS/Happ, Android/Happ, Windows/Happ, отсутствующих и некорректных данных, а также отсутствия HWID/raw User-Agent в разметке.

Условие завершения: интерфейс выдаёт компактные строки вида `iPhone 12 INCY 2.4.7` или `Windows Happ 5.2.0`, отдельно показывает ОС и не выводит технический HWID в DOM. Это требование относится к представлению, а не к удалению полей из BFF response.

Статус: реализовано в `CHG-001`, повторно проверено и скорректировано в `FIND-010`/`CHG-002`; принято переходом пользователя к AUTH-UX-1 (`DEC-003`).

Известное UX-ограничение: два устройства с полностью одинаковыми типом, ОС и клиентом после скрытия HWID визуально неразличимы. Кнопка удаления по-прежнему относится к выбранной строке и использует полный внутренний HWID. В текущем upstream payload нет безопасного времени последней активности или другой понятной пользователю характеристики; технический идентификатор ради различения обратно не выводится.

### Этап AUTH-UX-1. Сопровождаемый Telegram → e-mail/password → исходное действие

Граница этапа: это UX- и commerce-gate изменение Clean Pay, использующее существующий контракт Remnashop PR #135. Оно не устраняет `/identify` enumeration, не закрывает публичную Remnashop auth boundary и не меняет Passkey trust model — эти задачи остаются в SEC-этапах.

Пароль в этом сценарии обязателен. Telegram OIDC доказывает владение Telegram-аккаунтом, но не создаёт пароль для входа по e-mail. Код подтверждает владение e-mail, но также не заменяет пароль. Remnashop PR #135 требует пароль длиной 8–256 символов при регистрации и текущий пароль при входе.

`linkRemnashopAccount` использует login-first/register-fallback. Это не следует смешивать с общим `registerWithEmail`, где применяется register-first/login-fallback.

Password-backed доказательство для нового или неподтверждённого e-mail сохраняется атомарно вместе с pending token и ожидаемым Remnashop user id. До успешного ввода кода локальный `authPending` остаётся `false`: обычное чтение профиля не должно преждевременно запускать Telegram recovery или merge неподтверждённого адреса. После подтверждения кода `authPending` включается только тогда, когда для фактической сходимости identities действительно требуется recovery/merge.

Доказательство привязано к владельцу: для Telegram-сессии подтверждающий access token должен принадлежать сохранённому `pendingRemnashopUserId`, а подтверждаемый адрес — совпадать с pending e-mail. Если между вводом пароля и кода Telegram-сессия сменилась, Clean Pay не отправляет запрос подтверждения от имени другого пользователя и возвращает человека к вводу пароля с тем же безопасным continuation. Параметр `step=password` служит только UX-подсказкой; публичный query-параметр не может отключить повтор нового пароля, когда локального e-mail ещё нет.

| Состояние e-mail | Действие | Нужен код | Результат |
|---|---|---|---|
| Новый e-mail | Пользователь вводит e-mail, новый пароль и повтор пароля; после неуспешного login выполняется register | Да | После кода e-mail identity связывается или объединяется с Telegram identity |
| Существующий подтверждённый e-mail | Пользователь вводит текущий пароль; выполняется login | Нет | Связь или merge выполняется сразу, затем пользователь возвращается к исходному действию |
| Существующий неподтверждённый e-mail | Пользователь вводит текущий пароль; выполняется login | Да | До ввода кода объединение не выполняется |
| Уже начатое подтверждение | Используется сохранённый pending flow | Да | Пользователь продолжает ввод кода без повторного создания аккаунта |
| Неверный пароль существующего e-mail | Login отклоняется, register получает конфликт существующего адреса | Нет | Возвращается auth failure; связь, merge и отправка нового verification flow не выполняются |

Пользовательский сценарий:

1. Перед подтверждением покупки или продления Clean Pay проверяет локальную сессию через `/api/bff/auth/me`.
2. Если подтверждённого e-mail нет, payment/extend operation не создаётся; пользователь автоматически направляется на сопровождаемую настройку.
3. В URL сохраняется только безопасный локальный `redirect_to`. Для оплаты сохраняются выбранные `plan`, `duration` и `gateway`; для продления — `duration` и `gateway`. Внешние URL, API paths и рекурсивные setup/auth paths заменяются на `/cabinet`.
4. Пользователь получает явное объяснение, что e-mail и пароль нужны для доступа к кабинету без Telegram.
5. Для нового адреса запрашиваются e-mail, пароль и повтор пароля. Для существующего адреса требуется его текущий пароль.
6. Новый или неподтверждённый e-mail направляется на ввод шестизначного кода. Подтверждённый существующий e-mail после правильного пароля продолжает без кода.
7. После подтверждения Clean Pay дополнительно проверяет фактическую сходимость `/api/bff/auth/me`; authenticated profile явно передаёт `accountSyncPending`.
8. При `account_sync_pending` пользователь остаётся на странице и может выполнить «Проверить и продолжить». Повторная оплата и повторное использование кода не выполняются.
9. Если Telegram-сессия сменилась до ввода кода, подтверждение fail-closed отклоняется, а пользователь видит форму текущего пароля с сохранённым continuation.
10. Terminal merge conflict ведёт в поддержку, завершившаяся сессия — на повторный вход с сохранённым continuation, а потерянная email-связь — обратно к вводу e-mail и пароля.
11. После готовности пользователь возвращается точно к сохранённой оплате или продлению.
12. На возвращённой странице оплаты установка приложения и настройка Passkey предлагаются отдельно и не блокируют кнопку оплаты; iOS-инструкция открывается только по явному нажатию.

Если e-mail и Telegram принадлежат разным Remnashop users, e-mail user объединяется в Telegram target. В обычном случае target получает e-mail, пароль и признак подтверждения; source помечается объединённым и блокируется. Токены обеих сторон инвалидируются, поэтому на других устройствах может потребоваться повторный вход.

Если у обеих сторон есть активная подписка либо Remnashop обнаруживает другой небезопасный merge conflict, автоматическое объединение прекращается до изменения владельца и пользователь получает инструкцию обратиться в поддержку.

Backend purchase и extend повторно требуют существующий подтверждённый e-mail до чтения или создания idempotent payment operation. Frontend preflight является только UX-оптимизацией, а не единственной защитой. Если merge находится в pending-состоянии, `getAuthorizedRemnashopTokens` сначала выполняет owner-safe Telegram recovery и лишь после успеха разрешает создание операции.

Docker regression fixture использует один и тот же exact image Remnashop PR #135 для API, worker и scheduler, проверяет revision `0050`, согласованный Telegram bot/OIDC id и соответствие `REMNASHOP_API_KEY` ключу admin API. Перед запуском harness требует свободный порт приложения, контролирует жизненный цикл именно нового Next.js PID и ограниченно повторяет transient compose image build/start не более трёх раз. Это обеспечивает проверку межпроектного merge, но само по себе не закрывает публичную Remnashop auth boundary: это отдельная задача SEC-этапов.

Автоматическое отключение Remnashop payment rollout gate допустимо только в пустом изолированном E2E-контуре после проверки exact revision, одинаковых image id и нулевого числа payment operations. Этот test-only механизм не является инструкцией для production и не должен переноситься в release/deploy flow.

Условия завершения:

- Telegram-only пользователь не может создать purchase/extend operation до подтверждения e-mail;
- новый e-mail требует пароль и код;
- существующий подтверждённый e-mail требует правильный пароль, но не повторный код;
- существующий неподтверждённый e-mail требует пароль и код;
- неправильный пароль не создаёт новую identity и не запускает merge;
- смена Telegram-сессии не позволяет подтвердить pending e-mail от имени другого владельца и требует повторного ввода пароля;
- исходные параметры оплаты или продления сохраняются на всех шагах;
- lifetime-продление с `duration=0` сохраняет исходное значение;
- unsafe redirect заменяется на `/cabinet`;
- `account_sync_pending` не возвращает пользователя к оплате;
- install/Passkey остаются необязательными;
- merge conflict не изменяет ownership автоматически;
- общий nonguided `/link-account` и `/verify-email` сохраняет прежнее поведение.

Статус: реализовано в `CHG-003`—`CHG-013`; полный integration/Docker gate после независимого review завершён в `TST-014`, а последние локальные source/docs corrections и production build повторно проверены в `TST-016`. Дополнительная браузерная проверка маршрута и текста — в `TST-012`. Этап готов к отдельному commit ветки `update-nodejs` и ручной приёмке.

Открытая граница доказательства: PR #135 не возвращает `has_password` и не имеет операции создания первого пароля для Telegram user с уже подтверждённым e-mail и `password_hash = NULL`. Новый сопровождаемый flow создаёт или проверяет пароль, но общий глобальный инвариант для ранее сформированного/direct-verification состояния без изменения Remnashop доказать нельзя. Это зафиксировано в `FIND-015` и вынесено в Q-010; до решения нельзя заявлять, что любой исторический подтверждённый Telegram e-mail уже гарантирует автономный email-login.

### Этап 0. Зафиксировать решения и рабочую ветку

1. Ответить на Q-001, Q-003, Q-008, Q-009 и Q-010.
2. Назначить owner реализации и релиза.
3. Назначить владельцев изменений в обоих репозиториях и согласовать порядок совместимого rollout.
4. Создать отдельные ветки Clean Pay и Remnashop.
5. Сохранить исходные npm/pip audit artifacts, commit SHA и версии Docker/Node/npm/Python/uv без секретов.
6. Зафиксировать rollback image/tag текущих production-версий.

Результат: однозначные границы задачи и воспроизводимый baseline.

### Этап 1. Закрыть обход BFF и password-reset brute force

1. По фактической production-конфигурации установить, доступен ли `/api/v1/public/auth/*` Remnashop из Интернета и есть ли внешние клиенты кроме Clean Pay.
2. Перевести `REMNASHOP_API_BASE_URL` Clean Pay на private/internal service address, если проекты находятся в общей инфраструктуре.
3. Добавить отдельный `REMNASHOP_AUTH_SERVICE_KEY` (название рабочее) для BFF auth-маршрутов Remnashop:
   - не переиспользовать admin `APP_API_KEY`;
   - не передавать credential браузеру;
   - хранить и ротировать как production secret;
   - проверять до выполнения auth use case.
4. Если private network невозможна, использовать mTLS или service credential на внешнем ingress; network ACL является дополнительной защитой.
5. Оставить публичными только те webhook/callback endpoints, которым действительно нужен внешний источник.
6. Перенести изменения PR #136 на актуальную ветку PR #135/целевую auth-ветку Remnashop.
7. Унифицировать внешние `password/confirm-reset` status/body для invalid, not-requested и expired состояний; подробную причину оставлять только в безопасной telemetry без PII.
8. Добавить тест, доказывающий, что анонимный запрос без service identity не достигает email auth/password reset.

Условие завершения: browser/внешний клиент не может обойти Clean Pay и напрямую вызвать Remnashop email auth; reset confirm ограничен и конкурентно безопасен.

### Этап 2. Dependency remediation

#### Clean Pay

1. Обновить и выровнять:
   - `next` и `eslint-config-next` до `16.2.12`;
   - `@prisma/adapter-pg`, `@prisma/client` и `prisma` до `7.9.0`.
2. Добавить временные exact overrides из подтверждённого dependency-spike.
3. Пересоздать lock-файл штатным npm.
4. Выполнить чистый `npm ci`.
5. Проверить фактическое дерево через `npm ls` и `npm explain`.
6. Запустить оба отчёта:

```text
npm audit --omit=dev
npm audit
```

7. Для каждого override записать:
   - какой advisory он закрывает;
   - кто владелец;
   - почему upstream range пока недостаточен;
   - дата повторной проверки;
   - условие удаления override.
8. Не применять `npm audit fix --force`.

Специальные проверки:

- Next proxy/auth routing и CSRF;
- image optimization и native loading `sharp` на целевой Node/Debian image;
- CSS/PostCSS production build;
- Prisma generate, migrate deploy, client queries и concurrency suite;
- Prisma CLI startup path с `@hono/node-server 2.x`;
- отсутствие дублирующихся версий у overridden packages.

#### Remnashop

1. Перенести dependency candidate в отдельную ветку от точного целевого auth commit.
2. Обновить `aiogram` до совместимой ветки, допускающей исправленный `aiohttp`.
3. Исправить `<47` constraint `cryptography` в `remnapy`, проверить его исходники/тесты и закрепить проверенный release или commit.
4. Пересобрать `uv.lock` без произвольных несвязанных обновлений.
5. Выполнить frozen export и сохранить полный `pip-audit` artifact.
6. Проверить `uv sync --frozen`, Ruff, mypy, полный pytest, migrations и production image.
7. Проверить Telegram bot/webhook, email auth, password reset, admin merge, Remnawave API и криптографические операции.
8. Если временно используется `[tool.uv].override-dependencies`, назначить owner, expiry и условие удаления.

Условие завершения: оба production registry-аудита равны `0`, VCS-зависимость `remnapy` проверена отдельно, clean install/build и regression suites воспроизводимы.

### Этап 3. Устранить account enumeration

1. Изменить frontend flow в `src/frontend/components/auth-forms.tsx`.
2. Удалить зависимость UI от `exists` и `hasPasskey`.
3. Сделать Passkey login доступным независимо от account lookup.
4. Удалить `/api/bff/auth/identify` либо перевести его на generic stateless-контракт.
5. Удалить lookup пользователя из публичного identify flow.
6. Сохранить один «Продолжить» flow без предварительного выбора по локальной БД.
7. На этапе A унифицировать ошибки Clean Pay и убедиться, что прямой Remnashop auth закрыт.
8. На этапе B реализовать generic `email/start`/`email/complete` в Remnashop и соответствующий BFF.
9. Проверить register, login, password reset, email change/link и Passkey endpoints на альтернативные oracle.
10. Обновить route-handler, unit, integration и E2E tests обоих проектов.

Обязательные негативные тесты:

- известный и неизвестный e-mail дают одинаковые status/body/headers;
- публичный flow не вызывает Prisma lookup для определения account state;
- Passkey login остаётся доступным;
- до доказательства владения e-mail register/login/recovery не раскрывают account state через текст, status или заголовки;
- сравнение времени выполняется статистически с разумным допуском, без хрупкой проверки одного запроса.

Условие завершения: внешний клиент не может определить наличие аккаунта или Passkey через поддерживаемые auth API.

### Этап 4. Anti-abuse без client IP и fail-closed

1. Не добавлять client IP или forwarded headers в security keys.
2. Сделать Turnstile обязательным в production для анонимных auth/recovery операций:
   - не передавать `remoteip`;
   - задавать отдельный widget `action` для каждого flow;
   - проверять `success`, ожидаемый `hostname` и точное совпадение `action`;
   - исключить повторное использование token.
3. Ввести независимые Redis buckets:
   - `auth:<action>:email:<digest>`;
   - `auth:<action>:capacity`;
   - `auth:<action>:session:<digest>` для уже аутентифицированных действий.
4. Не сохранять исходные e-mail/identity в Redis key; использовать HMAC и отдельные domain labels.
5. Проверять target и capacity buckets атомарным Lua script.
6. Считать неудачные target-попытки; после порога не делать жёсткий долгий lockout, а требовать proof-of-possession через email code, Passkey или Telegram с generic public response.
7. Ввести bounded concurrency/semaphore для password hashing, provider calls и challenge creation; при переполнении быстро отклонять новую работу.
8. Для Passkey:
   - Turnstile либо короткоживущий single-purpose grant после Turnstile перед выдачей options;
   - общий budget создания challenge;
   - лимит незавершённых challenge на browser flow;
   - короткий TTL и гарантированная очистка.
9. При timeout, connection/protocol error или malformed Redis response:
   - прекратить обработку;
   - не обращаться к PostgreSQL и внешним auth providers;
   - для login/register/passkey вернуть `503 UPSTREAM_UNAVAILABLE`;
   - для enumeration-sensitive recovery start можно вернуть обычный generic `202`, но не отправлять письмо и не создавать side effect;
   - отдать безопасный `Retry-After`;
   - записать структурированный event без PII.
10. Применить модель минимум к:
   - email login;
   - email register;
   - Passkey options/verification;
   - Telegram auth initiation/callback, где применимо;
   - recovery endpoint.
11. Удалить/переписать unit-тест, который сейчас требует fail-open; добавить тесты fail-closed.
12. Настроить метрики:
   - rate-limited по action/bucket type;
   - Redis unavailable;
   - auth `503`;
   - capacity/concurrency rejection;
   - Turnstile failure по action;
   - успешные повторы после временной ошибки.

Стартовые численные лимиты не фиксируются произвольно в документе. Сначала снимается распределение легитимной нагрузки, затем выполняется нагрузочный тест и canary. Общий capacity threshold должен быть существенно выше штатного пика, иначе он сам станет рычагом глобального DoS.

Условие завершения: сбой Redis не превращает публичный auth endpoint в неограниченный oracle или brute-force surface.

Не использовать как замену этой модели:

- анонимный device cookie — атакующий очищает/ротирует его;
- только per-email bucket — атакующий распределяет запросы по множеству адресов;
- только global bucket — атакующий блокирует auth всем;
- proof-of-work как основной механизм — плохой UX, батарея и accessibility; допустим только как дополнительный аварийный слой.

### Этап 5. Уточнить и реализовать Passkey contract

1. Немедленно исправить тексты UI/документацию: Passkey восстанавливает локальную Clean Pay session.
2. Если upstream token bundle отсутствует/истёк, запрашивать явный step-up через e-mail или Telegram до Remnashop-зависимой операции.
3. Не выдавать signed impersonation token от Clean Pay без отдельного threat model и ротации trust keys.
4. Для автономного долгосрочного Passkey перенести регистрацию/verification WebAuthn в Remnashop либо реализовать согласованный upstream WebAuthn exchange, после которого Remnashop выдаёт свой обычный JWT.
5. Продумать миграцию существующих credentials и rollback, не ослабляя credential ownership checks.

Условие завершения: UI и API одинаково трактуют локальную и upstream-аутентификацию; истёкшие Remnashop tokens дают предсказуемый step-up, а не скрытый отказ.

### Этап 6. Production container hardening

Сейчас `deploy/prod/Dockerfile:63` копирует в runtime весь `node_modules`, а `deploy/prod/start.sh:7` запускает Prisma CLI migrations из app container.

Рекомендуемое целевое состояние:

1. отдельный одноразовый migration job/image;
2. application image без Prisma CLI/dev tooling;
3. Next standalone output или доказанно pruned runtime dependencies;
4. SBOM и vulnerability scan именно финального image;
5. запрет старта новой app revision до успешного migration job;
6. отдельный rollback runbook для app и миграций.

Этот этап уменьшает attack surface и расхождение между lock-file audit и реальным содержимым image. По рекомендации он идёт после срочного dependency/auth fix.

### Этап 7. Полная проверка и выпуск

На чистом checkout/runner:

```text
npm ci
npm audit --omit=dev
npm run lint
npm run typecheck
npm run test:unit
npm run test:route-handlers
npm run build
```

На одноразовой PostgreSQL/Redis:

```text
npm run test:integration
npm run test:postgres-concurrency
```

В Docker:

```text
npm run test:e2e
```

Дополнительно:

- применить все миграции к пустой БД;
- повторно выполнить `migrate deploy` на уже актуальной БД;
- проверить health/readiness и Redis failure injection;
- проверить `sharp` на фактической production architecture;
- проверить, что client IP/forwarded headers не влияют на anti-abuse решение;
- проверить service-auth boundary Remnashop и отсутствие публичного обхода BFF;
- выполнить password-reset brute-force/concurrency negative tests из PR #136;
- проверить Turnstile `action`, hostname, replay и outage;
- проверить одинаковый auth response для known/unknown e-mail;
- снять SBOM/scan финальных images обоих проектов;
- провести canary и наблюдать auth `4xx/5xx`, Redis latency/errors и login conversion.

## 7. Последствия и способы снижения риска

| Изменение | Возможное последствие | Снижение риска |
|---|---|---|
| Next `16.2.9 → 16.2.12` | Изменение proxy/middleware поведения | Route tests, CSRF/auth E2E, canary |
| `postcss` override | Изменение CSS output | Production build и визуальный smoke ключевых страниц |
| `sharp 0.35.x` | Native ABI/loading или image optimization regression | Проверка внутри финального Debian/Node 24 image |
| `@hono/node-server 2.x` | Несовместимость с внутренними Prisma CLI путями | `prisma generate`, `migrate deploy`, startup и integration |
| Prisma `7.8 → 7.9` | Изменение client/engine/CLI | Выровнять все Prisma packages, чистая generate/migrate, DB suites |
| Большой lock diff | Неочевидное транзитивное изменение | Review `npm ls`, lock diff, запрет посторонних обновлений |
| Удаление adaptive identify | UI больше не знает account state до auth | Единая кнопка «Продолжить» и независимо доступный usernameless Passkey |
| Generic email start/complete | Дополнительное подтверждение e-mail и межпроектное изменение API | Поэтапный rollout BFF + Remnashop, короткий TTL, resend UX и telemetry |
| Fail-closed Redis | Auth временно недоступен при Redis outage | HA Redis, readiness, быстрый `503`, Retry-After, UI retry |
| Отказ от client-IP limit | Ботнет может распределять запросы по адресам/устройствам | Turnstile action binding, target + capacity buckets, concurrency cap, закрытый Remnashop auth |
| Target bucket | Атакующий может временно затруднить password login выбранному e-mail | Считать failures, после порога переводить на proof-of-possession вместо долгого полного lockout; оставить Passkey/Telegram |
| Общий capacity bucket | При слишком низком пороге возможен глобальный auth DoS | Высокий порог относительно p99, observe-only rollout, bounded concurrency и alerting |
| Обязательный Turnstile | Зависимость auth от внешнего challenge provider | Timeout/fail-closed, synthetic monitoring, понятный retry; recovery start маскирует outage без side effect |
| Закрытие Remnashop public auth | Возможная поломка неизвестного внешнего клиента | Инвентаризация access logs/клиентов, staged deny, service credential и rollback ingress rule |
| PR #136 | Redis становится частью password-reset availability | Fail-closed confirm, generic no-side-effect request response, HA Redis и alerting |
| `aiogram`/`aiohttp` upgrade | Изменение Telegram networking/webhook поведения | Bot/webhook integration и soak test |
| `cryptography`/`remnapy` constraint fix | Возможная несовместимость криптографии/API Remnawave client | Patch/test `remnapy`, pinned revision, crypto and API integration tests |
| Локальный Passkey + upstream step-up | Дополнительный prompt после истечения Remnashop tokens | Явное сообщение, заранее обновлять token bundle, E2E истёкшей/отсутствующей upstream-сессии |
| Разделение migration job | Более сложный deploy orchestration | Явный release gate и runbook |

### Ожидаемая недоступность и миграции

- Изменения auth-контракта Clean Pay и Remnashop должны выходить обратно совместимыми revision либо через feature flag.
- Для срочных этапов 1–4 миграция схемы PostgreSQL не ожидается; долгосрочный перенос WebAuthn в Remnashop может потребовать отдельную схему и rollout.
- Redis counters эфемерны и истекут по TTL.
- При корректном rolling/canary deploy плановая недоступность не требуется.
- При недоступном Redis login/register/passkey будут намеренно возвращать `503`, а recovery start — generic success без side effect; платежные операции не должны затрагиваться этим изменением.
- Закрытие публичного Remnashop auth выполняется только после подтверждения, что разрешённые service clients используют новый credential.

## 8. Критерии приёмки

Релиз разрешён только если:

- [ ] Q-001, Q-003, Q-008, Q-009 и Q-010 имеют утверждённые ответы и строки `DEC-*` в журнале.
- [ ] Решение снять Q-004 и не использовать client IP зафиксировано в журнале.
- [ ] `npm audit --omit=dev` возвращает `0` production vulnerabilities.
- [ ] Frozen production export Remnashop проходит registry `pip-audit` с `0` известных advisory.
- [ ] VCS `remnapy` constraint исправлен и revision проверен отдельно.
- [ ] Все overrides документированы, имеют owner и срок пересмотра.
- [ ] Чистый `npm ci` успешен.
- [ ] `uv sync --frozen` успешен.
- [ ] Lint/typecheck/static checks обоих проектов успешны.
- [ ] Unit, route-handler, integration и full-stack E2E обоих проектов не имеют падений и неожиданных skip.
- [ ] Production builds и финальные Docker images успешны.
- [ ] Миграции обоих проектов успешны на пустой и актуальной БД.
- [ ] Known/unknown e-mail неразличимы по поддерживаемому контракту.
- [ ] Redis failure injection на login/register/passkey возвращает ограниченный по времени `503`.
- [ ] При Redis failure отсутствуют последующие Prisma/provider calls.
- [ ] Recovery start при Redis failure возвращает generic-ответ без письма/side effect.
- [ ] Исчерпание target failure budget переводит владельца на proof-of-possession, а не создаёт бессрочный account lockout.
- [ ] Изменение client IP/forwarded headers не меняет anti-abuse identity или решение.
- [ ] Turnstile проверяет `action`, hostname, replay и работает без `remoteip`.
- [ ] Прямой внешний запрос к Remnashop email auth без service credential отклоняется до use case.
- [ ] Password reset выдерживает перебор и конкурентные confirm согласно PR #136.
- [ ] Passkey, Telegram OIDC, recovery и email auth проходят regression.
- [ ] Passkey с отсутствующим/истёкшим upstream token bundle приводит к документированному step-up.
- [ ] Платежи, idempotency и concurrent operations проходят regression.
- [ ] Canary не показывает аномального роста auth failures/latency.
- [ ] Rollback images и инструкции обоих проектов проверены до production rollout.

## 9. Rollback

### До релиза

- хранить предыдущие images обоих проектов по immutable digest;
- сохранить старые `package.json`/`package-lock.json` и `pyproject.toml`/`uv.lock` в git;
- не включать необязательные schema migrations в этот change set;
- зафиксировать все изменяемые feature flags и proxy rules.

### Условия автоматического отката

- рост auth `5xx` выше утверждённого порога;
- ошибки загрузки `sharp` или image optimization;
- ошибки Prisma generate/migrate/runtime;
- ошибки Remnashop startup/migrations, Telegram webhook или Remnawave API;
- нарушение session/CSRF/proxy routing;
- недоступность auth для разрешённого service client после закрытия ingress;
- рост payment/recovery regressions;
- невозможность login/passkey для контрольных synthetic users.

### Действия

1. Остановить rollout.
2. Вернуть совместимую пару предыдущих Clean Pay/Remnashop images по digest и, если нужно, предыдущую ingress allow-rule.
3. Не откатывать данные вручную: в срочном change set schema migration не предусмотрена; для отдельного WebAuthn rollout использовать его собственный migration/rollback runbook.
4. Проверить health, auth synthetic checks и платежный smoke.
5. Добавить строку `INC-*` и затем `ROLL-*` в журнал.

## 10. Отдельные последующие задачи

Эти пункты не блокируют немедленное устранение подтверждённых проблем, но должны получить issue/owner:

- устранить зависимость integration tests от статического уникального `remnashopUserId`;
- разделить migration и application images;
- добавить автоматический SBOM/image scan;
- добавить scheduled проверку, можно ли удалить overrides после обновлений upstream;
- проверить test harness предупреждение аудита при Passkey counter conflict вне request context;
- добавить автоматический аудит registry и VCS dependencies Remnashop;
- документировать README/API deployment boundary: какие Remnashop endpoints публичны, а какие доступны только service clients.
- заменить межпроектный path-based контракт удаления одного устройства на opaque body/token: произвольные HWID `.` и `..` нормализуются URL-стеком как dot-segments и не могут быть надёжно удалены текущим маршрутом; до совместимого изменения остаётся операция удаления всех устройств.

## 11. Правила ведения журнала

1. Журнал append-only: новые записи добавляются в конец таблицы.
2. Ошибочная запись не удаляется и не переписывается; добавляется новая запись `COR-*` со ссылкой на исходную. Узкое исключение — запрещённые privacy/security policy данные редактируются на месте без сохранения исходного значения, после чего в конец добавляется `COR-*` с классом удалённых данных и причиной redaction.
3. Решение по вопросу фиксируется как `DEC-*` и ссылается на `Q-*`.
4. Каждая проверка содержит commit SHA, среду и точный итог.
5. Каждое изменение статуса релиза имеет автора.
6. В журнал нельзя помещать секреты, токены, реальные e-mail, Telegram ID или дампы production data.
7. Большие audit/test outputs хранятся как CI artifacts; в журнале остаются digest/link и краткий результат.

Допустимые типы ID:

- `AUD-*` — аудит;
- `FIND-*` — подтверждённое наблюдение;
- `DEC-*` — решение;
- `CHG-*` — изменение;
- `TST-*` — проверка;
- `REL-*` — релиз;
- `INC-*` — инцидент;
- `ROLL-*` — откат;
- `COR-*` — исправление записи.

## 12. Журнал

| Дата (MSK) | ID | Тип | Commit / среда | Действие или решение | Статус | Доказательство / результат | Автор |
|---|---|---|---|---|---|---|---|
| 2026-07-27 | AUD-001 | Аудит | `d2637e1`, local | Повторно выполнен production dependency audit | Завершено | `npm audit --omit=dev`: 10 total, 5 high, 5 moderate | Codex |
| 2026-07-27 | FIND-001 | Наблюдение | `d2637e1`, source/tests | Подтверждён account enumeration через `exists` и `hasPasskey` | Подтверждено | `identify/route.ts:57-58`, frontend branching и E2E assertions | Codex |
| 2026-07-27 | FIND-002 | Наблюдение | `d2637e1`, source/unit | Подтверждён fail-open при ошибке Redis | Подтверждено | Endpoint продолжает DB lookup; unit test ожидает HTTP 200 | Codex |
| 2026-07-27 | TST-001 | Проверка | `d2637e1`, local + Docker | Проверен исходный regression baseline | Завершено | lint/typecheck; unit 475; route 44; integration 58; E2E 104; build и 15 migrations успешны | Codex |
| 2026-07-27 | AUD-002 | Dependency spike | temp lock-only copy | Проверено обновление только Next до 16.2.12 | Завершено | Прямые Next advisory закрываются, всего остаётся 10 production vulnerabilities | Codex |
| 2026-07-27 | AUD-003 | Dependency spike | temp lock-only copy | Проверен полный кандидат версий и overrides из раздела 2.1 | Кандидат | `npm audit --omit=dev`: `found 0 vulnerabilities`; install/build/tests ещё не выполнялись | Codex |
| 2026-07-27 | FIND-003 | Наблюдение | Remnashop PR #135 `b9da68a` + Clean Pay `d2637e1` | Установлена каноническая модель идентичности между проектами | Подтверждено | Remnashop `users.id` → JWT `sub`; Clean Pay unique `WebUser.remnashopUserId`; отдельная identity-сущность не нужна | Codex |
| 2026-07-27 | FIND-004 | Наблюдение | Clean Pay `d2637e1`, source | Установлено, что local `identify` не является канонической идентификацией и может дать false negative | Подтверждено | Lookup выполняется только в Clean Pay; `registerWithEmail` уже делает upstream register-first/login-fallback | Codex |
| 2026-07-27 | FIND-005 | High risk | Remnashop PR #135 `b9da68a`, source | Найдена обходная поверхность BFF и неограниченный password-reset confirm при публичном Remnashop auth | Подтверждено условно topology | В reset confirm нет failed-attempt limiter; общий HTTP limiter не найден. Реальная Internet exposure требует проверки production ingress | Codex |
| 2026-07-27 | FIND-006 | Наблюдение | Clean Pay `d2637e1`, source | Уточнена семантика Passkey | Подтверждено | Passkey создаёт local session; без upstream token/Telegram recovery Remnashop operation заканчивается `EMAIL_REQUIRED` | Codex |
| 2026-07-27 | TST-002 | Проверка | Remnashop PR #135 `b9da68a`, temp exact source | Проверен baseline PR #135 | Завершено | pytest `153/153`, Ruff успешно, выборочный auth/identity mypy успешно | Codex |
| 2026-07-27 | TST-003 | Проверка | PR #135 `b9da68a` + PR #136 `377f981`, temp source | Проверена переносимость password-reset hardening | Завершено | `git apply --check` успешен; объединённый исходный dependency graph: pytest `165/165`, Ruff успешно | Codex |
| 2026-07-27 | AUD-004 | Dependency audit | Remnashop PR #135 exact `uv.lock` | Проверен frozen production registry graph | Завершено | 81 advisory-запись в 10 пакетах; VCS `remnapy` не оценён `pip-audit` | Codex |
| 2026-07-27 | AUD-005 | Dependency spike | Remnashop generic `uv lock --upgrade`, temp | Проверен обычный upgrade | Недостаточно | Осталось 12 advisory-записей в `aiohttp 3.13.5` и `cryptography 46.0.7` | Codex |
| 2026-07-27 | AUD-006 | Dependency spike | Remnashop PR #135 candidate, temp | Проверен совместимый registry dependency candidate | Кандидат | `0` известных registry advisory; pytest `153/153`, Ruff и выборочный mypy успешны; image/migrations ещё не проверены | Codex |
| 2026-07-27 | TST-004 | Проверка | PR #135 + PR #136 + dependency candidate, temp | Проверен совмещённый remediation candidate | Кандидат | `0` известных registry advisory; pytest `165/165`, Ruff успешно; production gates ещё не выполнены | Codex |
| 2026-07-27 | DEC-001 | Решение | Указание пользователя | Q-004 снят с рассмотрения; client IP исключён из rate-limit/security identity | Принято | План заменён на Turnstile action binding, target/action/session buckets, concurrency caps и service boundary | Пользователь |
| 2026-07-27 | FIND-007 | Наблюдение | Remnashop PR #135 + PR #136, source | Подтверждён account/reset-state oracle в confirm-reset response | Подтверждено | Invalid/unknown: generic `400`; known без request: отличный текст `400`; expired: `410`. PR #136 сохраняет различия | Codex |
| 2026-07-27 | FIND-008 | Наблюдение | Clean Pay README + Remnashop PR #135 routing | Подтверждено, что документированный deployment не создаёт service-auth boundary для public auth | Подтверждено для documented topology | README указывает public HTTPS `/api/v1/public`; `public_router`/auth не требуют `APP_API_KEY`. Реальный production ingress ещё не проверен | Codex |
| 2026-07-27 | TST-005 | Проверка | Local Docker engine | Проверена доступная runtime-топология перед завершением аудита | Нет live evidence | `docker ps` не показал запущенных контейнеров; production ingress/DNS этим способом не подтверждены | Codex |
| 2026-07-29 | DEC-002 | Решение | Указание пользователя | A-001—A-004 из рабочего обсуждения признаны излишними и сняты; утверждён формат устройств «тип, ОС, клиент», прочерк при отсутствии данных и отсутствие видимого HWID | Принято | UI-1 поставлен первым независимо проверяемым пунктом; после его коммита работа останавливается для приёмки | Пользователь |
| 2026-07-29 | FIND-009 | Наблюдение | Remnashop PR #135 `b9da68a` + Clean Pay `d2637e1`, source | Проверен фактический контракт устройств | Подтверждено | Remnashop прозрачно отдаёт `hwid`, `platform`, `device_model`, `os_version`, `user_agent`; исправление представления не требует изменения upstream API | Codex |
| 2026-07-29 | CHG-001 | Изменение | `d2637e1` + staged UI-1, local | Реализовано компактное представление устройств и безопасный фильтр клиентской телеметрии | Завершено | Видны тип/ОС/клиент и версии; raw User-Agent/HWID скрыты; HWID сохранён для удаления; отсутствующие поля дают `—`; bidi/format controls удаляются | Codex |
| 2026-07-29 | TST-006 | Проверка | `d2637e1` + staged UI-1; Node 24.18.0, npm 11.16.0, local | Выполнен regression gate первого пункта | Завершено | `npm ci`; focused UI 13/13; unit 488/488; route 44/44; docs privacy/encoding 5/5; lint, typecheck, production build и `git diff --check` успешны; production audit сохраняет baseline 10 (5 high, 5 moderate) | Codex |
| 2026-07-29 | TST-007 | Проверка | Local Docker engine | Проверена возможность ручной runtime-проверки UI-1 | Нет live fixture | Docker engine доступен, но `docker ps` не показал запущенных контейнеров; фактический `CabinetPanel` проверен jsdom-тестом с тремя устройствами и обеими ветками удаления, визуальная приёмка оставлена пользователю | Codex |
| 2026-07-29 | COR-001 | Исправление записи | Ссылка на `DEC-002` | Уточнено значение A-001—A-004 | Исправлено | Это временные метки дополнительных вопросов из обсуждения, а не решения реестра `Q-*`; их снятие не утверждает Q-001/Q-003/Q-008/Q-009 | Codex |
| 2026-07-29 | COR-002 | Исправление записи | Ссылка на `CHG-001`, `TST-006`; commit `f7c6d98` | Уточнены commit и граница сокрытия данных | Исправлено | `CHG-001` вошёл в `f7c6d98`; HWID/raw User-Agent не рендерятся в DOM, но остаются в BFF response, а HWID используется для удаления | Codex |
| 2026-07-29 | TST-008 | Проверка | `f7c6d98`; Node 24.18.0, npm 11.16.0, local | Выполнена post-commit перепроверка UI-1 | Завершено | focused UI 13/13; unit 488/488; route 44/44; docs 5/5; lint/typecheck успешны; build успешен с non-secret CI fixture из builder-окружения `deploy/prod/Dockerfile` и localhost `NEXT_PUBLIC_APP_URL`; production audit 10 (5 high, 5 moderate) | Codex |
| 2026-07-29 | FIND-010 | Наблюдение | `f7c6d98` + Remnashop PR #135 `b9da68a`, source/tests | Повторный review нашёл консервативные ошибки форматтера и accessibility | Подтверждено | Generic iOS ошибочно назывался iPhone; bare Darwin — Mac; iPadOS терялся; sentinel/technical models и `Client version` покрывались не полностью; одинаковые delete labels не различали строки | Codex |
| 2026-07-29 | CHG-002 | Изменение | `f7c6d98` + staged corrections, local | Исправлены результаты повторного review UI-1 | Завершено | Убраны придуманные hardware labels и Darwin inference; сохранён iPadOS; нормализованы sentinels/эмуляторы; очищаются все Unicode `Cf`; добавлен `Client version`; безопасные aria-label различают строки без HWID; форматирование выполняется один раз на строку | Codex |
| 2026-07-29 | FIND-011 | Наблюдение | Clean Pay `f7c6d98` + Remnashop PR #135 `b9da68a`, API contract | Найдено прежнее ограничение path-based удаления произвольного HWID | Подтверждено, не UI-1 | HWID `.`/`..` нормализуется URL-стеком; безопасное исправление требует совместимого body/opaque-token контракта обоих проектов. Обычные HWID и delete-all работают | Codex |
| 2026-07-29 | TST-009 | Проверка | `f7c6d98` + staged `CHG-002`; Node 24.18.0, npm 11.16.0, local | Выполнен regression gate исправлений review | Завершено | focused UI 29/29; unit 504/504; route 44/44; docs 5/5; lint, typecheck, CI-fixture production build и `git diff --check` успешны; production audit без изменений: 10 (5 high, 5 moderate) | Codex |
| 2026-07-29 | COR-003 | Исправление записи | `CHG-002`, `TST-009`; commit `3647f26` | Зафиксирован итоговый commit исправлений UI-1 | Исправлено | `CHG-002` вошёл в `3647f26`; проверенный staged diff соответствует commit | Codex |
| 2026-07-29 | DEC-003 | Решение | Указание пользователя; commits `f7c6d98`, `3647f26` | UI-1 принят переходом к пункту 2; AUTH-UX-1 утверждён следующим независимо проверяемым этапом | Принято | Пользователь поручил выполнить пункт 2 после проверки и исправления UI-1 | Пользователь |
| 2026-07-29 | FIND-012 | Наблюдение | Clean Pay `3647f26` + Remnashop PR #135 `b9da68a`, source/tests | Уточнён обязательный password contract Telegram → e-mail link | Подтверждено | Register требует пароль 8–256; login — текущий пароль 1–256; Telegram auth пароль не создаёт; link использует login-first/register-fallback | Codex |
| 2026-07-29 | FIND-013 | Наблюдение | Clean Pay `3647f26`, source/tests | Исходный flow терял payment continuation и полагался на поздний отказ provider/payment path | Подтверждено | `/payment` → `/link-account` → `/verify-email` завершался переходом в профиль/кабинет без исходных plan/duration/gateway; Telegram exemption не являлся строгим commerce gate | Codex |
| 2026-07-29 | FIND-014 | Наблюдение | Remnashop PR #135 `b9da68a` + Clean Pay merge code/tests | Уточнены последствия объединения e-mail и Telegram identities | Подтверждено | E-mail source объединяется в Telegram target; source блокируется, token versions меняются, `requires_relogin=true`; две активные подписки дают conflict без автоматического merge | Codex |
| 2026-07-29 | FIND-015 | Межпроектное ограничение | Remnashop PR #135 `b9da68a`, source/API contract | Найден достижимый Telegram user с подтверждённым e-mail, но без резервного пароля | Подтверждено | Telegram auth создаёт `password_hash = NULL`; direct request/confirm email пароль не задаёт; `/auth/me` не содержит `has_password`, reset при null не работает. Полный self-service требует Q-010 | Codex |
| 2026-07-29 | CHG-003 | Изменение | `3647f26` + staged AUTH-UX-1, local | Реализован сопровождаемый Telegram → e-mail/password → verification → исходное действие flow | Завершено | Safe continuation, frontend preflight, строгие purchase/extend guards, ветви existing/new e-mail, sync-pending readiness/retry, terminal conflict handling и необязательные install/Passkey | Codex |
| 2026-07-29 | FIND-016 | Межпроектная конфигурация | Docker E2E, Clean Pay + Remnashop PR #135 | Clean Pay не получал согласованный `REMNASHOP_API_KEY`, поэтому подтверждение кода завершалось, но admin merge не мог выполниться | Подтверждено | Remnashop email confirm возвращал `200`, однако запрос `/admin/users/merge` не отправлялся, а pending-состояние не сходилось | Codex |
| 2026-07-29 | FIND-017 | Release-конфигурация | `.devcontainer/docker-compose.yml`, production validator | Telegram OIDC mock использовал несогласованный ненумерический client id и не проверял production-инвариант bot token | Подтверждено | Production требует числовой `TELEGRAM_OIDC_CLIENT_ID`, совпадающий с bot id из `TELEGRAM_BOT_TOKEN`; прежний стенд этого не воспроизводил | Codex |
| 2026-07-29 | FIND-018 | Test infrastructure | Remnashop revision `0050`, Docker E2E | Fresh Remnashop сохраняет активный payment rollout gate, а прежний harness не доказывал безопасность его test-only отключения | Подтверждено | Не проверялись exact migration revision, одинаковые images API/worker/scheduler и отсутствие payment operations | Codex |
| 2026-07-29 | CHG-004 | Изменение | staged AUTH-UX-1 Docker fixture | Согласованы межпроектный admin key и Telegram bot/OIDC identity тестового стенда | Завершено | Clean Pay получает matching `REMNASHOP_API_KEY`; client id совпадает с bot id. Изменение не закрывает публичную Remnashop auth boundary | Codex |
| 2026-07-29 | CHG-005 | Изменение | staged AUTH-UX-1 E2E harness | Добавлена fail-closed подготовка изолированного payment rollout gate | Завершено | Требуются revision `0050`, одинаковый image id трёх Remnashop-процессов, ноль операций и транзакционное отключение с post-check; production не затрагивается | Codex |
| 2026-07-29 | TST-010 | Проверка | `3647f26` + staged AUTH-UX-1; clean Docker E2E | Первый полный прогон выявил преждевременный recovery до подтверждения e-mail | Не пройдено | `103/104`: pending profile `/api/bff/auth/me` вернул `409 ACCOUNT_MERGE_REQUIRED`, причина `verified_email_mismatch`; результат не скрыт последующим успешным прогоном | Codex |
| 2026-07-29 | FIND-019 | Дефект реализации | staged AUTH-UX-1, `linkRemnashopAccount` | Сохранение нового неподтверждённого e-mail с `authPending=true` позволяло чтению профиля начать recovery/merge до ввода кода | Исправлено | Password-backed pending proof отделён от recovery state: до подтверждения кода сохраняется `authPending=false`, после кода pending включается только при необходимости сходимости | Codex |
| 2026-07-29 | CHG-006 | Исправление | staged AUTH-UX-1, source/tests | Устранён ранний merge неподтверждённого e-mail и добавлена защита от регрессии | Завершено | Pending token, ожидаемый owner и password proof сохраняются атомарно; unit и full-stack assertions подтверждают отсутствие `accountSyncPending` до кода | Codex |
| 2026-07-29 | FIND-020 | Upstream-наблюдение | Remnashop PR #135 `b9da68a`, Docker E2E | Удаление отдельного HWID без подписки падает upstream с необработанным `ValueError` и HTTP 500 | Подтверждено, не AUTH-UX-1 | Clean Pay ограниченно нормализует только этот device-delete failure в `409 DEVICE_DELETE_UNAVAILABLE`; соответствующий E2E проходит, assertion не ослаблен | Codex |
| 2026-07-29 | TST-011 | Проверка | `3647f26` + staged AUTH-UX-1; Node 24.18.0, npm 11.16.0, local + clean Docker | Выполнен полный regression gate второго пункта после исправления `FIND-019` | Завершено | lint и typecheck; unit `551/551`; route `46/46`; real PostgreSQL integration `60/60` и 15 migrations; clean Docker E2E `104/104`; Windows CI-fixture и Linux-container production builds успешны; production audit без изменений: 10 (5 high, 5 moderate) | Codex |
| 2026-07-29 | TST-012 | Проверка | Local Docker + in-app browser, Linux production bundle | Проверены видимая маршрутизация и объяснение сопровождаемого flow | Завершено в заявленном scope | Неавторизованная оплата сохранила exact `redirect_to`; mock Telegram OIDC вернул пользователя к тем же `plan`/`duration`/`gateway`; guided page показала «Сохраните доступ к аккаунту» и объяснение возврата к прерванному действию. Полный business flow доказан `TST-011` | Codex |
| 2026-07-29 | FIND-021 | Дефект реализации | staged AUTH-UX-1, Telegram session turnover review | После повторного Telegram-входа pending password proof мог потерять владельца, а попытка подтверждения — использовать access token новой сессии | Исправлено | До обращения к Remnashop проверяются token owner и pending e-mail; при несовпадении пользователь возвращается к password step с тем же continuation | Codex |
| 2026-07-29 | CHG-007 | Исправление | staged AUTH-UX-1, source/tests | Pending e-mail verification привязана к Remnashop owner и целевому адресу | Завершено | Добавлены pre/post-profile guards, owner proof для Telegram change-email и безопасный `step=password`; query-параметр не может убрать подтверждение нового пароля | Codex |
| 2026-07-29 | FIND-022 | Дефект test infrastructure | `scripts/e2e-devcontainer.sh`, manual server collision | Старый Next.js process на порту приложения мог пережить cleanup, а readiness — ошибочно принять его за новый тестируемый server | Исправлено | Воспроизведён `EADDRINUSE`; прежний harness проверял URL, но не владение process | Codex |
| 2026-07-29 | CHG-008 | Исправление | staged E2E harness, source test | E2E запуск стал fail-closed относительно порта и точного Next.js PID | Завершено | Перед стартом проверяется освобождение порта; readiness прекращается, если созданный PID завершился, и не может пройти на старом server | Codex |
| 2026-07-29 | FIND-023 | Дефект реализации | staged guided setup, focused review | Новый пароль имел слишком мягкий browser minimum, а публичный password step мог скрыть обязательное подтверждение нового пароля | Исправлено | Новый пароль требует 8 символов и повтор; текущий пароль сохраняет совместимый минимум 1; server-side контракт остаётся определяющим | Codex |
| 2026-07-29 | FIND-024 | Дефект реализации | staged continuation/verification review | Missing/unsafe verification redirect выключал guided режим; lifetime `duration=0` терялся; client gateway limit расходился с backend | Исправлено | Guided fallback остаётся `/cabinet`; duration `0` и gateway до 100 символов проходят безопасную нормализацию и покрыты unit tests | Codex |
| 2026-07-29 | CHG-009 | Исправление | staged AUTH-UX-1, source/tests | Исправлены validation и continuation edge cases | Завершено | Password UX, guided fallback, lifetime duration и gateway limits приведены к backend contract; добавлены регрессионные проверки | Codex |
| 2026-07-29 | TST-013 | Проверка | final clean Docker E2E attempt, Docker Desktop | Первый финальный повтор остановился до запуска тестов на transient недоступности `ghcr.io` | Не пройдено, внешняя причина | Docker Desktop не смог получить build image из registry; функциональные тесты не начинались, результат сохранён в журнале | Codex |
| 2026-07-29 | FIND-025 | Дефект test infrastructure | `scripts/e2e-devcontainer.mjs`, `TST-013` | Compose image build/start не имел ограниченного повтора при transient registry failure | Исправлено | Добавлен общий максимум три попытки с синхронной задержкой 2/4 секунды; постоянная ошибка по-прежнему завершает gate неуспешно | Codex |
| 2026-07-29 | CHG-010 | Исправление | staged E2E runner, source test | Добавлен bounded retry только для compose image build/start | Завершено | Retry не распространяется на тестовые assertions и не может скрыть функциональную ошибку | Codex |
| 2026-07-29 | TST-014 | Итоговая проверка | `3647f26` + final staged AUTH-UX-1; Node 24.18.0, npm 11.16.0, local + clean Docker | Выполнен полный regression gate после всех review-исправлений; заменяет TST-011 как финальное доказательство кандидата | Завершено | focused review `93/93`; lint/typecheck; unit `559/559`; route `46/46`; real PostgreSQL integration `60/60` и 15 migrations; clean Docker E2E `104/104` на Remnashop PR #135 `b9da68a`; production build успешен; audit без изменений: 10 (5 high, 5 moderate, 0 critical) | Codex |
| 2026-07-29 | FIND-026 | Дефект реализации | staged extension continuation, final review | `gateway_type` разрешён backend как exact непустая строка до 100 символов, но extension continuation удалял краевые пробелы | Исправлено | Редкое разрешённое offer value могло после setup не совпасть с выбранной ценой и сброситься на первый gateway | Codex |
| 2026-07-29 | CHG-011 | Исправление | staged extension continuation, source/test | Удалена изменяющая значение нормализация gateway | Завершено | `duration` и `gateway_type` сохраняются exact через вложенный URL; отдельный component test покрывает gateway с краевыми пробелами | Codex |
| 2026-07-29 | TST-015 | Проверка | staged AUTH-UX-1, full unit | Повтор unit suite после `CHG-011` остановился на docs privacy gate | Не пройдено | Новый component test прошёл; общий результат `559 passed, 1 failed`: в TST-014 по ошибке была записана полная внешняя revision | Codex |
| 2026-07-29 | FIND-027 | Дефект документации | `TST-015`, `docs-privacy.test.ts` | Итоговая запись нарушала правило запрета полных revision/checksum в документации | Исправлено | Полная внешняя revision заменена на уже используемую короткую `b9da68a`; runtime/config не затронуты | Codex |
| 2026-07-29 | CHG-012 | Исправление | staged audit journal | Документация приведена к privacy policy проекта | Завершено | Смысл доказательства PR #135 сохранён без deployment-specific identifier | Codex |
| 2026-07-29 | COR-004 | Исправление записи | `TST-014`, `FIND-027` | Уточнено представление revision в TST-014 | Исправлено | Полный SHA удалён из документа по обязательной privacy policy и заменён короткой проверяемой revision | Codex |
| 2026-07-29 | CHG-013 | Исправление документации | final docs review, staged audit plan | Устранены несогласованности реестра решений и append-only/privacy правил | Завершено | Q-010 добавлен в Этап 0 и общий checklist; для обязательной privacy/security redaction описано узкое исключение с обязательной `COR-*` записью без сохранения запрещённого значения | Codex |
| 2026-07-29 | TST-016 | Итоговая проверка | `3647f26` + final AUTH-UX-1 candidate; Node 24.18.0, npm 11.16.0, local | Повторно проверены последние source/docs corrections после TST-014 | Завершено | lint/typecheck; unit `560/560`, включая exact gateway continuation и docs privacy; route `46/46`; production build: compile, TypeScript и `50/50` pages; `git diff --check`, shell syntax и Node syntax успешны. Real PostgreSQL `60/60`, 15 migrations и clean Docker E2E `104/104` остаются зафиксированы в TST-014; после них backend/integration contract не менялся | Codex |

### Шаблон новой записи

```text
| YYYY-MM-DD | TYPE-NNN | Тип | <commit, среда> | <что сделано/решено> | <статус> | <команда, artifact или краткий результат> | <автор> |
```
