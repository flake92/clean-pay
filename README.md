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
- значения `WEB_JWT_SECRET`, `WEB_REFRESH_SECRET`, `AUDIT_IP_HASH_SECRET` и пароль PostgreSQL уже создаются командой `init` — их нужно сохранить;
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
| `REMNASHOP_ADMIN_API_BASE_URL` | При включённой сверке платежей | Тот же origin и API prefix, окончание `/api/v1/admin`. |
| `REMNASHOP_API_KEY` | Да | Значение `APP_API_KEY` из `.env` Remnashop, минимум 24 символа. |
| `REMNAWAVE_API_BASE_URL` | Да | Публичный HTTPS origin панели, например `https://panel.example.com`. |
| `REMNAWAVE_TOKEN` | Да | API-токен панели Remnawave, минимум 24 символа. |

#### Авторизация и cookies

| Переменная | Обязательность | Назначение и допустимое значение |
| --- | --- | --- |
| `WEB_JWT_SECRET` | Да, генерируется | Секрет access-сессий, минимум 32 символа. |
| `WEB_REFRESH_SECRET` | Да, генерируется | Отдельный секрет refresh-сессий, минимум 32 символа. |
| `AUDIT_IP_HASH_SECRET` | Да, генерируется | Отдельный секрет хеширования IP, минимум 32 символа. |
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

Сверка результатов платежей по умолчанию выключена. После установки совместимой версии Remnashop задайте `PAYMENT_RECONCILIATION_ENABLED=true`, заполните `REMNASHOP_ADMIN_API_BASE_URL` и сгенерируйте уникальный `PAYMENT_RECONCILIATION_SECRET` длиной не менее 32 символов. `deploy.sh` автоматически включит нужный Compose profile. Если сверка выключена, admin URL и secret не требуются.

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

## Remnashop

### Обязательная совместимая версия

На 19 июля 2026 года все изменения Remnashop, необходимые Clean Pay, собраны в
одном upstream PR:

| PR | Статус | Что добавляет | Значение для Clean Pay |
| --- | --- | --- | --- |
| [`#135`](https://github.com/snoups/remnashop/pull/135) | Открыт, target `dev`, head `745d629` | Public/admin API, идемпотентные purchase/extend, durable recovery, сверку неоднозначных платежей, безопасное объединение пользователей, миграции `0046–0050` и изолированные dev/test-настройки loopback/Telegram API. | Единственный обязательный PR для полного платёжного recovery contract, `PAYMENT_RECONCILIATION_ENABLED=true` и полного сценария объединения e-mail/Telegram. Требует согласованного maintenance rollout всех HTTP/Taskiq/scheduler ролей. |
| [`#136`](https://github.com/snoups/remnashop/pull/136) | Закрыт без merge | Независимый hardening password reset. | Отложен и не входит в #135 или текущий production rollout. |
| [`#137`](https://github.com/snoups/remnashop/pull/137) | Закрыт без merge | Loopback-only HTTP для `WEB_CABINET_URL`. | Проверенное изменение восстановлено в единственном PR #135 коммитом `c42dc88`; отдельный PR больше не нужен. |
| [`#138`](https://github.com/snoups/remnashop/pull/138) | Закрыт без merge | Необязательный `BOT_API_BASE_URL`. | Проверенное изменение восстановлено в единственном PR #135 коммитом `745d629`; отдельный PR больше не нужен. |

Password-reset/WebApp функциональность из закрытого
[`#129`](https://github.com/snoups/remnashop/pull/129) уже присутствует в ветке
Remnashop `dev`. Дополнительный hardening из #136 закрыт без merge и отложен
как отдельная задача. PR #137 и #138 также закрыты без merge: соответствующие
проверенные изменения теперь входят только в #135. Проверенный commit #135 не
включает hardening из #136.

Исторический stacked PR
[`flake92/remnashop#2`](https://github.com/flake92/remnashop/pull/2) сохранён
только для трассировки более ранней ветки.

Пока PR #135 не принят и не вошёл в официальный образ, тестовый стенд
Remnashop нужно собирать из ветки
`flake92/remnashop:codex/clean-pay-integration-upstream-dev` и фиксировать на
проверенном commit `745d629`. Это временный вариант для интеграционного
стенда, а не рекомендация использовать непроверенный moving branch в
production. Обычный `ghcr.io/snoups/remnashop:latest`/v0.8.2
не содержит полного recovery contract v1 и endpoint
`POST /api/v1/admin/users/merge`, поэтому с ним нельзя включать
`PAYMENT_RECONCILIATION_ENABLED` и не работает полный сценарий привязки e-mail
к Telegram аккаунту. После включения #135 в официальный release следует
перейти на этот release и закрепить конкретный versioned image вместо тега
`latest`.

Devcontainer уже следует этому правилу: Compose использует immutable Git
commit `745d6292cc962322980071ae0174d0aae5d0baa8` как remote build context и
собирает штатный Dockerfile самого Remnashop. Локальных подмен файлов
Remnashop в Clean Pay нет. Смену commit допускается делать только на другой
проверенный commit PR #135 либо на официальный release, в который вошли
необходимые изменения. Отложенный hardening из закрытого #136 в этот commit
не входит.

Проверенный production snapshot от 19 июля 2026 года использует Clean Pay
`c676c207718a655e387fe5eefcf16dcd6d6b1fac` и производный Remnashop image с
payment-recovery commit `6b64a87395cbd4a6581e029d2647fbb21f39082e`.
`PAYMENT_RECONCILIATION_ENABLED=true`, app/retention/reconciliation worker
проходят healthcheck, а `NEXT_PUBLIC_BRAND_LOGO_URL` установлен в существующий
asset `/clean-pay-logo.png`. После maintenance rollout обязательно очистите
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

В production `WEB_CABINET_URL` должен использовать публичный HTTPS URL.
HTTP-вариант из #137 предназначен только для явных loopback host
(`localhost`, `127.0.0.0/8` или `::1`) при локальной разработке.

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

После подтверждённого объединения e-mail и выбранный Telegram ID обязаны
указывать на один итоговый Remnashop user UUID. Clean Pay повторно проверяет
обе identity и текущую подписку до фиксации локального merge; поэтому бот и
web-кабинет получают одного владельца, одинаковую подписку и одинаковый
статус. Если у обеих исходных учётных записей есть текущая подписка, merge не
выполняется и пользователь направляется в поддержку.

Применяйте изменение без удаления данных:

```bash
cd /opt/remnashop
docker compose up -d --no-deps --force-recreate remnashop remnashop-taskiq-worker remnashop-taskiq-scheduler
```

## Reverse proxy

Если proxy работает на хосте, направьте его на `127.0.0.1:4000`. Если он подключён к `CLEAN_PAY_EDGE_NETWORK`, используйте Docker alias `clean-pay:4000`.

Пример Caddy:

```caddyfile
pay.example.com {
    encode gzip zstd
    reverse_proxy 127.0.0.1:4000
}
```

При внешнем TCP/SNI proxy добавьте домен и в его таблицу маршрутизации: одной DNS-записи и конфигурации Caddy/Nginx недостаточно. Режим PROXY protocol на обеих сторонах должен совпадать.

## Настройки интерфейса

`NEXT_PUBLIC_BRAND_NAME` и `NEXT_PUBLIC_BRAND_LOGO_URL` в `deploy/prod/.env` задаются на этапе сборки. По умолчанию используется `/clean-pay-logo.png`. Чтобы переопределить его, положите файл в `public/`, укажите путь от корня сайта и выполните `./deploy.sh up` для пересборки.

Turnstile включается параметром `TURNSTILE_ENABLED=true`; при этом обязательны `TURNSTILE_SITE_KEY` и `TURNSTILE_SECRET_KEY`. Контакты поддержки включаются через `SUPPORT_ENABLED=true`.

## Обновление и резервная копия

Перед обновлением сохраните окружение и базу:

```bash
cd /opt/clean-pay
cp -p deploy/prod/.env "deploy/prod/.env.backup-$(date +%Y%m%d-%H%M%S)"
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml exec -T postgres pg_dump -U clean_pay -Fc clean_pay > clean-pay.dump
```

Затем обновите исходники и пересоберите:

```bash
git pull --ff-only
./deploy.sh up
```

## Диагностика

```bash
./deploy.sh ps
./deploy.sh logs
curl -f http://127.0.0.1:4000/api/health/liveness
curl -f http://127.0.0.1:4000/api/health/readiness
```

- `502`: приложение не запущено или proxy направлен не на тот upstream.
- Ошибка защищённых операций Remnashop: сверить `REMNASHOP_API_KEY` и `APP_API_KEY`.
- Ошибки Remnawave: проверить URL, токен и доступность сети.
- Telegram/OIDC: проверить публичный домен, callback `APP_URL/auth/telegram/callback`, client ID и secret.
- E-mail: проверить SMTP host/port, TLS/SSL и учётные данные в `/opt/remnashop/.env`, затем перезапустить HTTP/Taskiq/scheduler роли Remnashop одной версией образа.
