# Clean Pay

Clean Pay — веб-кабинет оплаты и управления подписками Remnashop/Remnawave. Production-развёртывание находится в `deploy/prod/`: оно поднимает приложение, отдельные PostgreSQL и Redis и подключает приложение к внешней Docker-сети Remnawave. Базы данных наружу не публикуются; приложение по умолчанию слушает только `127.0.0.1:4000`.

Лицензия: `AGPL-3.0-only`.

## Требования

- Linux-хост с Docker Engine и Docker Compose v2;
- доступ к уже работающим Remnashop и Remnawave;
- внешняя Docker-сеть (по умолчанию `remnawave-network`), если reverse proxy или соседние сервисы должны обращаться к `clean-pay`;
- домен, DNS и HTTPS reverse proxy;
- `git` и `openssl` для первичной подготовки конфигурации.

## Быстрая установка

Весь production-деплой выполняется Docker Compose; Node.js на сервере не нужен.

```bash
sudo mkdir -p /opt/clean-pay
sudo chown "$USER":"$USER" /opt/clean-pay
git clone https://github.com/flake92/clean-pay.git /opt/clean-pay
cd /opt/clean-pay
./deploy.sh init
```

Команда создаст `deploy/prod/.env`, выставит права `600` и автоматически сгенерирует пароль PostgreSQL и внутренние секреты. Откройте конфигурацию:

```bash
nano deploy/prod/.env
```

Замените оставшиеся `change-me` и `example.com`, как минимум:

```dotenv
APP_URL=https://pay.example.com
NEXT_PUBLIC_APP_URL=https://pay.example.com

REMNASHOP_API_BASE_URL=https://shop.example.com/api/v1/public
REMNASHOP_ADMIN_API_BASE_URL=https://shop.example.com/api/v1/admin
REMNASHOP_API_KEY=<APP_API_KEY из Remnashop>
REMNAWAVE_API_BASE_URL=https://panel.example.com
REMNAWAVE_TOKEN=<API-токен Remnawave>

TELEGRAM_OIDC_CLIENT_ID=<ID Telegram-бота>
TELEGRAM_OIDC_CLIENT_SECRET=<OIDC client secret>
TELEGRAM_BOT_TOKEN=<токен того же бота>
```

Для публичного HTTPS установите `COOKIE_SECURE=true`. `TELEGRAM_OIDC_CLIENT_SECRET` и `TELEGRAM_BOT_TOKEN` — разные значения; числовая часть токена до `:` должна совпадать с `TELEGRAM_OIDC_CLIENT_ID`.

### Как заполнять `.env`

Используйте созданный командой `./deploy.sh init` файл `deploy/prod/.env`. Не копируйте пример повторно после генерации: иначе будут потеряны автоматически созданные пароли и секреты.

Правила формата:

- одна переменная `NAME=value` на строку;
- комментарии допускаются только отдельной строкой, начинающейся с `#`;
- не добавляйте комментарий после значения, подстановки `${NAME}`, многострочные значения и повторяющиеся имена;
- URL указываются без завершающего `/`, кроме случаев, когда он является частью указанного API path;
- значения `WEB_JWT_SECRET`, `WEB_REFRESH_SECRET`, `AUDIT_IP_HASH_SECRET`, `RATE_LIMIT_IDENTITY_SECRET`, `READINESS_INTERNAL_SECRET` и пароль PostgreSQL уже создаются командой `init` — их нужно сохранить;
- все `change-me` и домены `example.com` перед запуском должны быть заменены.

#### Docker и сеть

| Переменная | Обязательность | Назначение и допустимое значение |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | Нет | Имя Compose-проекта. По умолчанию `clean-pay-prod`. Меняйте только до первого запуска. |
| `CLEAN_PAY_IMAGE` | Нет | Имя локально собираемого образа, по умолчанию `clean-pay-prod-app:local`. |
| `CLEAN_PAY_BIND` | Нет | Адрес публикации приложения. В production разрешены только `127.0.0.1` и `::1`. |
| `CLEAN_PAY_PORT` | Нет | Локальный порт приложения, `1–65535`; по умолчанию `4000`. |
| `CLEAN_PAY_EDGE_NETWORK` | Нет | Docker-сеть reverse proxy/Remnawave. `deploy.sh` создаст её при отсутствии; по умолчанию `remnawave-network`. |

#### PostgreSQL и Redis

| Переменная | Обязательность | Назначение и допустимое значение |
| --- | --- | --- |
| `POSTGRES_DB` | Да | Имя базы, по умолчанию `clean_pay`. После первого запуска не менять. |
| `POSTGRES_USER` | Да | Пользователь БД, по умолчанию `clean_pay`. После первого запуска не менять. |
| `POSTGRES_PASSWORD` | Да, генерируется | Пароль не короче 24 символов. Создаётся `./deploy.sh init`. |
| `DATABASE_URL` | Да, генерируется | Строка подключения к встроенной БД. Пароль, пользователь и база должны совпадать с тремя переменными выше. |
| `REDIS_URL` | Да | Для встроенного Redis оставьте `redis://redis:6379/0`. Redis наружу не публикуется. |
| `RUN_MIGRATIONS` | Нет | По умолчанию `true`: при старте выполняется безопасный `prisma migrate deploy`. Устанавливать `false` следует только при управляемом ручном rollout. В шаблон не добавлена намеренно. |

#### Публичный адрес и интерфейс

| Переменная | Обязательность | Назначение и допустимое значение |
| --- | --- | --- |
| `APP_URL` | Да | Публичный HTTPS origin кабинета, например `https://pay.example.com`, без path и завершающего `/`. |
| `NEXT_PUBLIC_APP_URL` | Да | Тот же адрес, что и `APP_URL`. Значение встраивается при сборке образа. |
| `NEXT_PUBLIC_BRAND_NAME` | Нет | Название сервиса, не более 80 символов. По умолчанию `Clean Pay`. |
| `NEXT_PUBLIC_BRAND_LOGO_URL` | Нет | Путь к логотипу внутри сайта, начинающийся с `/`; по умолчанию `/clean-pay-logo.png`. |
| `LOG_LEVEL` | Нет | `debug`, `info`, `warn` или `error`; для production рекомендуется `info`. |

#### Remnashop и Remnawave

| Переменная | Обязательность | Где получить / что указать |
| --- | --- | --- |
| `REMNASHOP_API_BASE_URL` | Да | URL публичного API Remnashop, обязательно заканчивается на `/api/v1/public`. |
| `REMNASHOP_ADMIN_API_BASE_URL` | Нет | Необязательный override admin API. Если значение пустое, URL безопасно выводится из `REMNASHOP_API_BASE_URL` заменой окончания `/api/v1/public` на `/api/v1/admin`; явное значение обязано иметь тот же origin и API prefix. |
| `REMNASHOP_API_KEY` | Да | Значение `APP_API_KEY` из `.env` Remnashop, минимум 24 символа. |
| `REMNAWAVE_API_BASE_URL` | Да | Публичный HTTPS origin панели, например `https://panel.example.com`. |
| `REMNAWAVE_TOKEN` | Да | API-токен панели Remnawave, минимум 24 символа. |

#### Авторизация и cookies

| Переменная | Обязательность | Назначение и допустимое значение |
| --- | --- | --- |
| `WEB_JWT_SECRET` | Да, генерируется | Секрет access-сессий, минимум 32 символа. |
| `WEB_REFRESH_SECRET` | Да, генерируется | Отдельный секрет refresh-сессий, минимум 32 символа. |
| `AUDIT_IP_HASH_SECRET` | Да, генерируется | Отдельный секрет хеширования IP, минимум 32 символа. |
| `RATE_LIMIT_IDENTITY_SECRET` | Да, генерируется | HMAC-секрет для обезличивания e-mail и Telegram ID в Redis rate-limit keys, минимум 32 символа. |
| `READINESS_INTERNAL_SECRET` | Да, генерируется | Секрет внутреннего detailed readiness endpoint, минимум 32 символа. |
| `COOKIE_SECURE` | Да | В production должно быть `true`. |
| `COOKIE_SAMESITE` | Нет | `lax`, `strict` или `none`; рекомендуется `lax`. Для `none` также обязателен `COOKIE_SECURE=true`. |

Сгенерированные секреты должны быть разными. Не публикуйте `.env` и не передавайте его в поддержку целиком.

#### Telegram OIDC

| Переменная | Обязательность | Где получить / что указать |
| --- | --- | --- |
| `TELEGRAM_OIDC_CLIENT_ID` | Да | Числовой ID Telegram-бота. Это часть bot token до `:`. |
| `TELEGRAM_OIDC_CLIENT_SECRET` | Да | OIDC client secret Telegram, минимум 24 символа; это не bot token. |
| `TELEGRAM_BOT_TOKEN` | Да | Полный токен BotFather вида `1234567890:...`; ID должен совпадать с `TELEGRAM_OIDC_CLIENT_ID`. |

Официальные Telegram endpoints уже встроены в приложение. Переменные `TELEGRAM_OIDC_ISSUER`, `TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT`, `TELEGRAM_OIDC_TOKEN_ENDPOINT` и `TELEGRAM_OIDC_JWKS_URI` добавлять не требуется.

#### Сверка платежей

| Переменная | Обязательность | Назначение и допустимое значение |
| --- | --- | --- |
| `PAYMENT_RECONCILIATION_ENABLED` | Нет | `true` включает worker сверки; по умолчанию `false`. |
| `PAYMENT_RECONCILIATION_SECRET` | При значении `true` | Уникальный секрет не короче 32 символов. Можно создать: `openssl rand -hex 32`. |
| `PAYMENT_RECONCILIATION_BATCH_SIZE` | Нет | Размер пачки `1–100`, по умолчанию `10`. |
| `PAYMENT_RECONCILIATION_INTERVAL_SECONDS` | Нет | Интервал `5–3600` секунд, по умолчанию `30`. |
| `PAYMENT_RECONCILIATION_INTERNAL_URL` | При значении `true` | Оставьте `http://app:4000/api/internal/payments/reconcile`. Это внутренний Docker URL. |

#### Turnstile и поддержка

| Переменная | Обязательность | Назначение и допустимое значение |
| --- | --- | --- |
| `TURNSTILE_ENABLED` | Нет | `true` включает Cloudflare Turnstile; по умолчанию `false`. |
| `TURNSTILE_SITE_KEY` | При значении `true` | Production site key Cloudflare. Тестовые ключи в production отклоняются. |
| `TURNSTILE_SECRET_KEY` | При значении `true` | Production secret key Cloudflare, минимум 24 символа. |
| `TURNSTILE_VERIFY_URL` | Нет | Оставьте официальный `https://challenges.cloudflare.com/turnstile/v0/siteverify`. |
| `SUPPORT_ENABLED` | Нет | `true` показывает контакты поддержки. |
| `SUPPORT_EMAIL` | Нет | Корректный e-mail поддержки. |
| `SUPPORT_TELEGRAM_USERNAME` | Нет | Username с `@` или без него, например `cleanpay_support`. |
| `SUPPORT_FAQ_URL` | Нет | Публичный HTTPS URL страницы помощи. |

#### Хранение данных и readiness

| Переменная | Обязательность | Диапазон / назначение |
| --- | --- | --- |
| `AUTH_STATE_RETENTION_DAYS` | Нет | `1–30`, по умолчанию `7`. |
| `SESSION_RETENTION_DAYS` | Нет | `30–365`, по умолчанию `90`. |
| `AUDIT_INFO_RETENTION_DAYS` | Нет | `30–730`, по умолчанию `180`. |
| `AUDIT_SECURITY_RETENTION_DAYS` | Нет | `90–2555`, по умолчанию `365`; не меньше `AUDIT_INFO_RETENTION_DAYS`. |
| `RATE_LIMIT_RETENTION_DAYS` | Нет | `1–180`, по умолчанию `30`. |
| `DATA_RETENTION_INTERVAL_SECONDS` | Нет | Интервал очистки `300–86400`, по умолчанию `21600` (6 часов). |
| `CLEAN_PAY_READINESS_MAILPIT_URL` | Нет | HTTP(S) origin дополнительного почтового health-сервиса, например `http://mailpit:8025`, без path. Для обычного production оставьте пустым. |
| `CLEAN_PAY_READINESS_REMNAWAVE_URL` | Нет | HTTPS origin дополнительной проверки Remnawave, без path. Должен совпадать с origin `REMNAWAVE_API_BASE_URL`; обычно оставьте пустым. |

Публичный `/api/health/readiness` возвращает только агрегированный cached status, `checkedAt` и признак `stale`; dependency details наружу не публикуются. Docker healthcheck вызывает `/api/internal/health/readiness` с `READINESS_INTERNAL_SECRET`, публикуя агрегат в общий Redis cache каждые 15 секунд. Это сохраняет контракт между разными Next.js route-модулями и репликами.

Пустое необязательное значение оформляется как `NAME=`. Удалять строки из шаблона без необходимости не рекомендуется: заполненный файл проще сравнивать с новой версией `.env.example` при обновлении.

Запустите приложение:

```bash
./deploy.sh up
```

Команда создаёт отсутствующую Docker-сеть, собирает образы, запускает сервисы, ждёт успешных healthcheck и выводит логи. `Ctrl+C` закрывает только просмотр логов — контейнеры продолжают работать.

## Управление production-стендом

```bash
./deploy.sh logs
./deploy.sh ps
./deploy.sh restart
./deploy.sh down
```

Сверка результатов платежей по умолчанию выключена. Совместимая версия Remnashop —
необходимое, но не достаточное условие для её включения. Оставляйте
`PAYMENT_RECONCILIATION_ENABLED=false`, пока не проверены admin API, уникальный
`PAYMENT_RECONCILIATION_SECRET` длиной не менее 32 символов и fault-injection
сценарии на disposable provider stub. После этого `deploy.sh` автоматически
включит нужный Compose profile. Admin URL выводится из публичного Remnashop URL
и не зависит от включения reconciliation; это необходимо также для безопасного
объединения e-mail/Telegram аккаунтов. Явный
`REMNASHOP_ADMIN_API_BASE_URL` нужен только как проверяемый override того же
origin и API prefix.

`retention-worker` включён всегда и выполняет очистку каждые 6 часов. Сроки хранения настраиваются переменными `*_RETENTION_DAYS`; платёжные записи этим процессом не удаляются.

Команда `up` не удаляет существующие volumes. Не используйте `docker compose down -v`, `docker volume prune` или `docker system prune --volumes`, если данные стенда нужно сохранить.

Перед обновлением существующей непустой БД выполните backup, maintenance-stop и
проверки из [production migration runbook](docs/production-migration-runbook.md).
Для production используется только `prisma migrate deploy`; `migrate dev` и
`db push` на production-БД запрещены.

После настройки proxy проверьте публичные health endpoints:

```bash
curl -f https://pay.example.com/api/health/liveness
curl -f https://pay.example.com/api/health/readiness
```

Внутреннюю подробную проверку выполняйте внутри контейнера, не выводя secret в консоль:

```bash
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml exec -T app \
  node -e "fetch('http://127.0.0.1:4000/api/internal/health/readiness',{headers:{'x-clean-pay-readiness-secret':process.env.READINESS_INTERNAL_SECRET}}).then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})"
```

## Проверенный тестовый rollout 21 июля 2026 года

Ниже зафиксировано фактическое состояние интеграционного стенда после
выполнения code-review отчёта. Это снимок тестового развёртывания, а не описание
любого production-окружения.

| Область | Проверенное состояние |
| --- | --- |
| Исходный код | Commit `b2832f4e1f95612af4369ab2b72c8da11824d77b` совпадал с `origin/new-dev` на момент rollout. На сервер доставлен проверенный `git archive`; `/opt/clean-pay` не является Git checkout. |
| Образ Clean Pay | Tag `clean-pay-prod-app:b2832f4e1f95`, Docker image ID `sha256:6f5979e160f73b4f5bca0973a929bcc028c01f76bce8284eb6f2fc9343bc44d7`. App и retention worker используют этот образ. |
| Топология | Compose project `clean-pay-prod-restore`; публикация только на `127.0.0.1:4000`; сеть `remnawave-network`; alias `clean-pay`. PostgreSQL и Redis наружу не опубликованы. |
| База и сервисы | Все 15 Prisma migrations применены, незавершённых migrations нет. App, PostgreSQL, Redis и retention worker healthy; public и internal readiness успешны. |
| Публичный адрес | `https://oplata.clear-vpn.org`: liveness и readiness возвращают `200`, корень перенаправляет на login, конечная login-страница возвращает `200`. Сертификат Let’s Encrypt и hostname проверены; присутствуют HSTS `max-age=31536000` и enforcing CSP. |
| Reverse proxy | Caddy проксирует на `clean-pay:4000`; временный maintenance снят, штатная конфигурация восстановлена. Глобальный `fallback_policy reject` не менялся. Для server-to-server Remnawave используется внутренний alias `panel2.clear-vpn.org`, сохраняющий настроенный HTTPS origin без public hairpin. |
| Remnashop | Commit `b9da68a651e9ab0b7ed52d030e13754311614759`; tag `clean-pay-remnashop:b9da68a651e9`; Docker image ID `sha256:304191d9e27eee1a92a3ae7ffe3bb23586f4adbb80808d2759ee4bf9ec2926c6`. HTTP, Taskiq worker и scheduler используют один образ; Alembic head — `0050`. |
| Контракт Remnashop | Rehearsal и live migration успешны; capability contract v1, неверный API key и безопасный admin merge dry-run проверены. Dry-run не изменил пользователей. SMTP прошёл TLS/auth без отправки письма. |
| Защита данных | Remnashop DB/Redis не пересоздавались. Preflight/cutover dump и архив assets проверены и сохранены в `/opt/deployment-backups/clean-pay-first-20260721T183616Z` с режимом каталога `0700`. Rollout gate очищен в `false`; `PAYMENT_RECONCILIATION_ENABLED=false` оставлен намеренно. |

Известная смежная проблема: публичный TLS handshake
`panel2.clear-vpn.org` завершался до выдачи сертификата как до, так и после
этого rollout. Внутренний Caddy-маршрут панели возвращает `200`, а readiness
Clean Pay к Remnawave успешен; значит это отдельный дефект внешнего SNI/TLS
маршрута, не отказ Clean Pay и не изменение, внесённое rollout.

## Проверенный production rollout 22 июля 2026 года

Ниже зафиксировано фактическое состояние работающего production после
cutover и независимой итоговой проверки. Это аудиторский снимок конкретного
развёртывания, а не универсальная конфигурация для нового сервера.

| Область | Проверенное состояние |
| --- | --- |
| Исходный код | В `/opt/clean-pay` развёрнут Git commit `b2832f4e1f95612af4369ab2b72c8da11824d77b`, tree `4a525178b541662e43920565fca2bf3a24b09497`. Миграции при обычном старте отключены: `RUN_MIGRATIONS=false`. |
| Образ и топология Clean Pay | Tag `clean-pay-prod-app:b2832f4e1f95612af4369ab2b72c8da11824d77b`, image ID `sha256:d00436c55ddc034e8c3626f0784d237083fed59cfa07b08281677d56b256f4c0`. Compose project `clean-pay-prod`; app, retention worker и reconciliation worker используют один образ, имеют `healthy`, `RestartCount=0`. App опубликован только на `127.0.0.1:4000`. |
| База и миграции Clean Pay | PostgreSQL container ID `c2c23bfb8bd8b2088a92481e072543d40dcbfd39a8e451b25bdab138bbf90150` и Redis container ID `198cdee341da9df55db9f611cb4e09afb1f64e7870392685f901d4acf137118a` сохранены без пересоздания. Завершены 15 Prisma migrations; незавершённых и rolled-back migrations — `0`. |
| Сверка платежей | `PAYMENT_RECONCILIATION_ENABLED=true` во всех трёх ролях; отдельный reconciliation worker запущен и healthy. Capability contract Remnashop подтверждает lookup/reconcile и auto-replay только для `YOOKASSA`. |
| Публичный адрес | `https://cleanvpn.edge-connect.uk`: liveness/readiness возвращают `200`, readiness содержит `status=ok` и `stale=false`, корень возвращает `307`, `/clean-pay-logo.png` — `200`; TLS hostname проверен. |
| Reverse proxy | Рабочий Caddyfile на host и в контейнере имеет SHA-256 `af173084e3518d6d501376e9826593706a42601b16a044cd171248fd7595d11f`; временная конфигурация cutover не оставлена. |
| Резервные копии | Набор `/opt/deployment-backups/clean-pay-prod-b2832f4e1f95-20260721T211526Z` прошёл manifest-проверки. SHA-256 cutover PostgreSQL dump: `3235ae6249b6c362ecd594ca20076af61438d298f7da72996e0c11609e315a99`; Redis snapshot: `8d371e8ddbbb78352a731034594e0ea0bde13da3bfefc5406d7425c379f940a9`; свежий pre-patch dump Remnashop: `e44f5578e2d6e39a68b41caf1a24c24b8b49f9556e9f892803cfef12f6cfe92b`. Архивы полностью прочитаны средствами `pg_restore` без восстановления в live-БД. |
| Rollback | Сохранены предыдущий image `clean-pay-prod-app:rollback-pre-b2832f4-20260721T211526Z` (`sha256:f49569eca913080b18285acb4fc13b9a3f905d1a3bac5efa66b394448eb3ad00`) и source tree `/opt/clean-pay.rollback-pre-b2832f4-20260721T211526Z`. |
| Remnashop | Tag `remnashop:clean-pay-prod-c43f9aec-platega-webhook-20260719`, image ID `sha256:bd4df82053aa93bec655225a8816b71f6ed3826f72880efab9b3d032af850440` во всех HTTP/Taskiq-ролях. DB/Redis не перезапускались и не восстанавливались; Alembic — `0050`, runtime rollout gate — `false`. Local/public health и capabilities возвращают `200`. |
| Compatibility-проверки Remnashop | Последовательно выполнены `patch-remnashop-hwid-useruuid.sh`, `patch-remnashop-expiration-meta.sh`, `patch-remnashop-hosts-optional.sh`. Зафиксированы девять изменений `StartedAt` ролей; runtime-валидация покрыла новый `userId`, legacy `userUuid`, optional `xHttpExtraParams` и `user.expiration` metadata. Fatal-паттернов в логах после начала работ не найдено. |
| Итоговая аттестация | После третьего скрипта orchestration wrapper сохранил исходный `FAILED_RECOVERED` из-за не локализованного transient post-gate `rc=1`; все роли уже были running, и recovery не выполнял дополнительных стартов. Отдельный read-only verifier выполнил три стабильных раунда и записал `DESIRED_STATE_VERIFIED_AFTER_FAILED_RECOVERED`. SHA-256 аттестации: `58316609c80b569c802de7eab839ed4c436a7d2bd7442d731a82df17a62b0c5f`; исходные failure/evidence-файлы сохранены. |

Автоматический smoke-test не инициировал реальное списание средств. Проверены
health, capability contract, схема, миграции и работа reconciliation worker;
реальный платёж остаётся отдельной ручной операторской проверкой с заранее
выбранными аккаунтом, суммой и платёжным методом.

## Remnashop

### Обязательная совместимая версия

На 19 июля 2026 года все изменения Remnashop, необходимые Clean Pay, собраны в
одном upstream PR:

| PR | Статус | Что добавляет | Значение для Clean Pay |
| --- | --- | --- | --- |
| [`#135`](https://github.com/snoups/remnashop/pull/135) | Открыт, target `dev`, head `b9da68a` | Public/admin API, идемпотентные purchase/extend, durable recovery, сверку неоднозначных платежей, безопасное объединение пользователей, миграции `0046–0050` и необязательный custom Telegram API для dev/test. | Единственный обязательный PR для полного платёжного recovery contract, `PAYMENT_RECONCILIATION_ENABLED=true` и полного сценария объединения e-mail/Telegram. Требует согласованного maintenance rollout всех HTTP/Taskiq/scheduler ролей. |
| [`#136`](https://github.com/snoups/remnashop/pull/136) | Закрыт без merge | Независимый hardening password reset. | Отложен и не входит в #135 или текущий production rollout. |
| [`#137`](https://github.com/snoups/remnashop/pull/137) | Закрыт без merge | Loopback-only HTTP для `WEB_CABINET_URL`. | Изменение исключено из #135; текущий PR по-прежнему требует HTTPS. |
| [`#138`](https://github.com/snoups/remnashop/pull/138) | Закрыт без merge | Необязательный `BOT_API_BASE_URL`. | Проверенное изменение восстановлено в единственном PR #135 коммитом `b9da68a`; отдельный PR больше не нужен. |

Password-reset/WebApp функциональность из закрытого
[`#129`](https://github.com/snoups/remnashop/pull/129) уже присутствует в ветке
Remnashop `dev`. Дополнительный hardening из #136 закрыт без merge и отложен
как отдельная задача. PR #137 и #138 также закрыты без merge: loopback из #137
исключён, а custom Telegram API из #138 находится только в #135. Проверенный
commit #135 не включает hardening из #136.

Исторический stacked PR
[`flake92/remnashop#2`](https://github.com/flake92/remnashop/pull/2) сохранён
только для трассировки более ранней ветки.

Пока PR #135 не принят и не вошёл в официальный образ, тестовый стенд
Remnashop нужно собирать из ветки
`flake92/remnashop:codex/clean-pay-integration-upstream-dev` и фиксировать на
проверенном commit `b9da68a`. Это временный вариант для интеграционного
стенда, а не рекомендация использовать непроверенный moving branch в
production. Обычный `ghcr.io/snoups/remnashop:latest`/v0.8.2
не содержит полного recovery contract v1 и endpoint
`POST /api/v1/admin/users/merge`, поэтому с ним нельзя включать
`PAYMENT_RECONCILIATION_ENABLED` и не работает полный сценарий привязки e-mail
к Telegram аккаунту. После включения #135 в официальный release следует
перейти на этот release и закрепить конкретный versioned image вместо тега
`latest`.

Devcontainer уже следует этому правилу: Compose использует immutable Git
commit `b9da68a651e9ab0b7ed52d030e13754311614759` как remote build context и
собирает штатный Dockerfile самого Remnashop. Локальных подмен файлов
Remnashop в Clean Pay нет. Смену commit допускается делать только на другой
проверенный commit PR #135 либо на официальный release, в который вошли
необходимые изменения. Отложенный hardening из закрытого #136 в этот commit
не входит.

Предыдущий тестовый rollout от 20 июля 2026 года также использовал совместимый
Remnashop commit `b9da68a651e9ab0b7ed52d030e13754311614759`; актуальный
проверенный снимок от 21 июля приведён выше. Платёжную reconciliation включайте
только после настройки admin API и отдельного fault-injection теста на
disposable provider stub. После каждого maintenance rollout обязательно очистите
`payment_runtime_control.legacy_rollout_gate_active`; оставленное значение
`true` штатно блокирует фактический merge пользователей даже после успешного
dry-run.

В `/opt/remnashop/.env` включите веб-кабинет и укажите тот же ключ, что в `REMNASHOP_API_KEY` Clean Pay:

```dotenv
WEB_ENABLED=true
WEB_CABINET_URL=https://pay.example.com/auth/telegram/webapp
APP_API_KEY=<то же значение, что REMNASHOP_API_KEY>
APP_JWT_SECRET=<случайный секрет>
```

`WEB_CABINET_URL` должен использовать HTTPS URL. Поддержка HTTP loopback из
закрытого без merge PR #137 в текущий PR #135 не входит.

Если используется собственный Telegram Bot API server из #138, дополнительно
задайте в `.env` Remnashop базовый HTTP(S) URL без credentials, query string и
fragment:

```dotenv
BOT_API_BASE_URL=https://telegram-api.example.com
```

При работе через официальный Telegram Bot API эту переменную не добавляйте или
оставьте пустой.

Для входа по e-mail настройте SMTP Remnashop. Пример для STARTTLS:

```dotenv
EMAIL_ENABLED=true
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USE_TLS=true
EMAIL_USE_SSL=false
EMAIL_USERNAME=mail@example.com
EMAIL_PASSWORD=<пароль>
EMAIL_FROM_EMAIL=mail@example.com
EMAIL_FROM_NAME=Clean Pay
```

`REMNASHOP_API_KEY` в `deploy/prod/.env` должен совпадать с `APP_API_KEY` Remnashop. Он обязателен для безопасного объединения e-mail и Telegram аккаунтов.

Если Remnashop и Remnawave находятся в одной Docker-сети, используйте внутренний
Docker alias Remnawave и его container port (обычно `remnawave:3000`). Не
направляйте server-to-server трафик через публичный домен, если внешний proxy не
поддерживает hairpin-маршрут.

После подтверждённого объединения e-mail и выбранный Telegram ID обязаны
указывать на один итоговый Remnashop user UUID. Clean Pay повторно проверяет
обе identity и текущую подписку до фиксации локального merge; поэтому бот и
web-кабинет получают одного владельца, одинаковую подписку и одинаковый
статус. Если у обеих исходных учётных записей есть текущая подписка, merge не
выполняется и пользователь направляется в поддержку.

Перед сменой версии сделайте резервную копию БД Remnashop по его штатному
runbook. Затем остановите только HTTP/worker/scheduler роли, соберите один
закреплённый image, примените Alembic migrations явным конфигом и запустите все
роли из этого же image:

```bash
cd /opt/remnashop
docker compose build remnashop
docker compose stop remnashop remnashop-taskiq-worker remnashop-taskiq-scheduler
docker compose run --rm --no-deps --entrypoint alembic remnashop \
  -c src/infrastructure/database/alembic.ini upgrade head
docker compose up -d --no-deps --force-recreate remnashop remnashop-taskiq-worker remnashop-taskiq-scheduler
docker compose ps
```

Не запускайте `alembic upgrade head` без `-c`: в штатном image конфигурация
находится в `src/infrastructure/database/alembic.ini`. Перед запуском Clean Pay
проверьте, что HTTP, worker и scheduler используют одну и ту же versioned image.

## Reverse proxy

Если proxy работает на хосте, направьте его на `127.0.0.1:4000`. Если он подключён к `CLEAN_PAY_EDGE_NETWORK`, используйте Docker alias `clean-pay:4000`.

Пример Caddy:

```caddyfile
pay.example.com {
    encode gzip zstd
    header Strict-Transport-Security "max-age=31536000; includeSubDomains"
    reverse_proxy 127.0.0.1:4000
}
```

HSTS должен выставляться только реальным HTTPS-терминатором после проверки всех поддоменов; приложение намеренно не добавляет его на внутреннем HTTP hop. Остальные security headers, включая enforcing CSP и `frame-ancestors 'none'`, выставляет Next.js.

При внешнем TCP/SNI proxy добавьте домен и в его таблицу маршрутизации: одной DNS-записи и конфигурации Caddy/Nginx недостаточно. Режим PROXY protocol на обеих сторонах должен совпадать.

## Настройки интерфейса

`NEXT_PUBLIC_BRAND_NAME` и `NEXT_PUBLIC_BRAND_LOGO_URL` в `deploy/prod/.env` задаются на этапе сборки. По умолчанию используется `/clean-pay-logo.png`. Чтобы переопределить его, положите файл в `public/`, укажите путь от корня сайта и выполните `./deploy.sh up` для пересборки.

Turnstile включается параметром `TURNSTILE_ENABLED=true`; при этом обязательны `TURNSTILE_SITE_KEY` и `TURNSTILE_SECRET_KEY`. Контакты поддержки включаются через `SUPPORT_ENABLED=true`.

Refresh tokens ротируются атомарно. Параллельные запросы в течение 10 секунд получают один successor; поздний reuse отзывает только соответствующую session family. Подробности: [refresh-token-rotation-design](docs/refresh-token-rotation-design.md).

При потере browser storage страница статуса восстанавливает последнюю активную payment operation текущего пользователя. Cross-key дедупликация одинаковых payload намеренно не применяется: [payment-idempotency-recovery-design](docs/payment-idempotency-recovery-design.md).

## Обновление и резервная копия

Перед обновлением сохраните окружение и базу:

```bash
cd /opt/clean-pay
cp -p deploy/prod/.env "deploy/prod/.env.backup-$(date +%Y%m%d-%H%M%S)"
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml exec -T postgres \
  sh -ec 'exec pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > clean-pay.dump
```

Если `/opt/clean-pay` создан через `git clone`, затем обновите checkout и
пересоберите:

```bash
git pull --ff-only
./deploy.sh up
```

При artifact-развёртывании, как на тестовом стенде 21 июля, каталога `.git` на
сервере нет и `git pull` неприменим. Доставьте новый архив ровно нужного commit
из доверенного checkout, до распаковки сверьте его SHA-256, сохраните
`deploy/prod/.env` и резервные копии вне заменяемого дерева, затем выполните тот
же проверяемый `./deploy.sh up`. Commit исходников и фактический Docker image ID
фиксируйте в журнале rollout отдельно от последующих documentation-only commit.

## Диагностика

```bash
./deploy.sh ps
./deploy.sh logs
curl -f http://127.0.0.1:4000/api/health/liveness
curl -f http://127.0.0.1:4000/api/health/readiness
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml exec -T app \
  node -e "fetch('http://127.0.0.1:4000/api/internal/health/readiness',{headers:{'x-clean-pay-readiness-secret':process.env.READINESS_INTERNAL_SECRET}}).then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})"
```

- `502`: приложение не запущено или proxy направлен не на тот upstream.
- Разный статус подтверждения e-mail при входе через e-mail и Telegram означает, что методы входа указывают на разные Remnashop user ID. Не исправляйте `WebUser.remnashopUserId` вручную: Clean Pay должен выполнить координированный recovery через admin merge API PR #135, повторно проверить итоговые e-mail/Telegram и только затем сохранить токены. При конфликте двух активных подписок merge останавливается и требует поддержки.
- Ошибка защищённых операций Remnashop: сверить `REMNASHOP_API_KEY` и `APP_API_KEY`.
- Ошибки Remnawave: проверить URL, токен и доступность сети.
- Telegram/OIDC: проверить публичный домен, callback `APP_URL/auth/telegram/callback`, client ID и secret.
- E-mail: проверить SMTP host/port, TLS/SSL и учётные данные в `/opt/remnashop/.env`, затем перезапустить HTTP/Taskiq/scheduler роли Remnashop одной версией образа.
