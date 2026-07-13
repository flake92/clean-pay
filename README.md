# Clean Pay

Clean Pay — веб-кабинет оплаты и управления подписками Remnashop/Remnawave. Production-развёртывание находится в `deploy/prod/`: оно поднимает приложение, отдельные PostgreSQL и Redis и подключает приложение к внешней Docker-сети Remnawave. Базы данных наружу не публикуются; приложение по умолчанию слушает только `127.0.0.1:4000`.

Лицензия: `AGPL-3.0-only`.

## Требования

- Linux-хост с Docker Engine и Docker Compose v2;
- доступ к уже работающим Remnashop и Remnawave;
- внешняя Docker-сеть (по умолчанию `remnawave-network`), если reverse proxy или соседние сервисы должны обращаться к `clean-pay`;
- домен, DNS и HTTPS reverse proxy;
- Node.js только для запуска управляющей команды `deploy/prod/prod.mjs` на хосте. Образ приложения собирается в Docker.

## Подготовка

```bash
sudo mkdir -p /opt/clean-pay
sudo chown "$USER":"$USER" /opt/clean-pay
git clone <URL_РЕПОЗИТОРИЯ> /opt/clean-pay
cd /opt/clean-pay
cp deploy/prod/.env.example deploy/prod/.env
```

`deploy/prod/.env` содержит секреты и намеренно не попадает в Git. Замените все `change-me` и заполните как минимум:

```dotenv
APP_URL=https://pay.example.com
NEXT_PUBLIC_APP_URL=https://pay.example.com

REMNASHOP_API_BASE_URL=https://shop.example.com/api/v1/public
REMNASHOP_API_KEY=<APP_API_KEY из Remnashop>
REMNAWAVE_API_BASE_URL=https://panel.example.com
REMNAWAVE_TOKEN=<API-токен Remnawave>

TELEGRAM_OIDC_CLIENT_ID=<ID Telegram-бота>
TELEGRAM_OIDC_CLIENT_SECRET=<OIDC client secret>
TELEGRAM_BOT_TOKEN=<токен того же бота>
```

Сгенерируйте уникальные секреты и пароль PostgreSQL. Пароль должен совпасть в `POSTGRES_PASSWORD` и `DATABASE_URL`:

```bash
password=$(openssl rand -hex 24)
secret1=$(openssl rand -hex 32)
secret2=$(openssl rand -hex 32)
secret3=$(openssl rand -hex 32)
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$password/" deploy/prod/.env
sed -i "s|change-me-postgres-password|$password|" deploy/prod/.env
sed -i "s/^WEB_JWT_SECRET=.*/WEB_JWT_SECRET=$secret1/" deploy/prod/.env
sed -i "s/^WEB_REFRESH_SECRET=.*/WEB_REFRESH_SECRET=$secret2/" deploy/prod/.env
sed -i "s/^AUDIT_IP_HASH_SECRET=.*/AUDIT_IP_HASH_SECRET=$secret3/" deploy/prod/.env
```

Для публичного HTTPS установите `COOKIE_SECURE=true`. `TELEGRAM_OIDC_CLIENT_SECRET` и `TELEGRAM_BOT_TOKEN` — разные значения; числовая часть токена до `:` должна совпадать с `TELEGRAM_OIDC_CLIENT_ID`.

## Запуск тестового или production-стенда

Проверка окружения, создание отсутствующей внешней сети, сборка и запуск:

```bash
node deploy/prod/prod.mjs up
node deploy/prod/prod.mjs verify
node deploy/prod/prod.mjs ps
```

Команда `up` не удаляет существующие volumes. Не используйте `docker compose down -v`, `docker volume prune` или `docker system prune --volumes`, если данные стенда нужно сохранить.

Управление:

```bash
node deploy/prod/prod.mjs build
node deploy/prod/prod.mjs logs
node deploy/prod/prod.mjs down
node deploy/prod/prod.mjs up --debug
```

`verify` ожидает HTTP 200 от `http://127.0.0.1:$CLEAN_PAY_PORT/api/health`. После настройки proxy также проверьте:

```bash
curl -f https://pay.example.com/api/health/liveness
curl -f https://pay.example.com/api/health/readiness
```

## Remnashop

В `/opt/remnashop/.env` включите веб-кабинет и укажите тот же ключ, что в `REMNASHOP_API_KEY` Clean Pay:

```dotenv
WEB_ENABLED=true
WEB_CABINET_URL=https://pay.example.com/auth/telegram/webapp
APP_API_KEY=<то же значение, что REMNASHOP_API_KEY>
APP_JWT_SECRET=<случайный секрет>
```

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

`NEXT_PUBLIC_BRAND_NAME` и `NEXT_PUBLIC_BRAND_LOGO_URL` в `deploy/prod/.env` задаются на этапе сборки. По умолчанию используется `/clean-pay-logo.png`. Чтобы переопределить его, положите файл в `public/`, укажите root-relative путь и выполните `node deploy/prod/prod.mjs up` для пересборки.

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
node deploy/prod/prod.mjs up
node deploy/prod/prod.mjs verify
```

## Диагностика

```bash
node deploy/prod/validate-env.mjs --env-file deploy/prod/.env
node deploy/prod/prod.mjs ps
node deploy/prod/prod.mjs logs
curl -f http://127.0.0.1:4000/api/health/liveness
curl -f http://127.0.0.1:4000/api/health/readiness
```

- `502`: приложение не запущено или proxy направлен не на тот upstream.
- Ошибка защищённых операций Remnashop: сверить `REMNASHOP_API_KEY` и `APP_API_KEY`.
- Ошибки Remnawave: проверить URL, токен и доступность сети.
- Telegram/OIDC: проверить публичный домен, callback `APP_URL/auth/telegram/callback`, client ID и secret.
- E-mail: проверить SMTP host/port, TLS/SSL и учётные данные.
