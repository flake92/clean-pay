# Clean Pay

Clean Pay — самостоятельный веб-кабинет оплаты и управления подписками Remnashop/Remnawave. Он хранит собственные сессии в PostgreSQL и Redis, получает пользователей, тарифы и платежи из Remnashop, а ссылку подключения — из Remnawave.

Лицензия: `AGPL-3.0-only`. Для установки нужны Linux, Docker Engine с Compose v2, домен с HTTPS, установленный Remnashop с включённым Web API и API-токен Remnawave. PostgreSQL и Redis наружу не публикуются; приложение по умолчанию доступно только на `127.0.0.1:4000`.

Все необходимые для установки файлы находятся в корне проекта:

- `.env.example` — полный пример настроек;
- `docker-compose.yml` — Clean Pay, PostgreSQL и Redis;
- `docker-compose.remnashop.yml` — подключение к общей сети Remnashop;
- `Dockerfile` — production-сборка;
- `start.sh` — проверка настроек, сборка, запуск и диагностика.

## 1. Установка

```bash
sudo curl -fsSL https://get.docker.com | sh
sudo mkdir -p /opt/clean-pay
sudo git clone https://github.com/flake92/clean-pay.git /opt/clean-pay
cd /opt/clean-pay
cp .env.example .env
```

Сгенерируйте пароль PostgreSQL и одинаково запишите его в `POSTGRES_PASSWORD` и `DATABASE_URL`:

```bash
password=$(openssl rand -hex 24)
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$password/" .env
sed -i "s|change-me-postgres-password|$password|" .env
```

Откройте `.env` и заполните как минимум:

```dotenv
APP_URL=https://pay.example.com
NEXT_PUBLIC_APP_URL=https://pay.example.com

REMNASHOP_API_BASE_URL=https://shop.example.com/api/v1/public
REMNASHOP_API_KEY=<APP_API_KEY из Remnashop>
REMNAWAVE_API_BASE_URL=https://panel.example.com
REMNAWAVE_TOKEN=<API-токен Remnawave>

TELEGRAM_OIDC_CLIENT_ID=<числовой ID Telegram-бота>
TELEGRAM_OIDC_CLIENT_SECRET=<OIDC client secret Telegram>
TELEGRAM_BOT_TOKEN=<токен того же бота>

COOKIE_SECURE=true
```

`TELEGRAM_OIDC_CLIENT_SECRET` и `TELEGRAM_BOT_TOKEN` — разные значения. Число до `:` в токене бота должно совпадать с `TELEGRAM_OIDC_CLIENT_ID`.

`start.sh` автоматически заменит демонстрационные значения `WEB_JWT_SECRET`, `WEB_REFRESH_SECRET` и `AUDIT_IP_HASH_SECRET` криптографически стойкими секретами. Остальные значения `change-me` необходимо заменить вручную.

## 2. Выбор схемы размещения

### Вариант A: Clean Pay отдельно от Remnashop

Укажите публичные HTTPS API:

```dotenv
REMNASHOP_API_BASE_URL=https://shop.example.com/api/v1/public
REMNAWAVE_API_BASE_URL=https://panel.example.com
```

Запуск:

```bash
sh start.sh
sh start.sh verify
```

### Вариант B: Clean Pay рядом с Remnashop

При стандартной совместной установке Remnashop и Remnawave используют сеть `remnawave-network`. Укажите внутренние адреса:

```dotenv
REMNASHOP_DOCKER_NETWORK=remnawave-network
REMNASHOP_API_BASE_URL=http://remnashop:5000/api/v1/public
REMNAWAVE_API_BASE_URL=http://remnawave:3000
```

Запуск:

```bash
CLEAN_PAY_MODE=remnashop sh start.sh
CLEAN_PAY_MODE=remnashop sh start.sh verify
```

В этом режиме приложение получает сетевой alias `clean-pay`. Для последующих команд `status`, `logs`, `restart` и `stop` передавайте тот же `CLEAN_PAY_MODE=remnashop`.

## 3. Настройка Remnashop

Добавьте в существующий `/opt/remnashop/.env`:

```dotenv
WEB_ENABLED=true
WEB_CABINET_URL=https://pay.example.com/auth/telegram/webapp
APP_API_KEY=<openssl rand -hex 32>
APP_JWT_SECRET=<openssl rand -hex 32>
```

Значение `APP_API_KEY` должно совпадать с `REMNASHOP_API_KEY` в `.env` Clean Pay.

Указывайте полный маршрут `/auth/telegram/webapp`. `BOT_MINI_APP` и `WEB_CABINET_URL` — разные настройки: первая управляет отдельной кнопкой подключения/подписки, а вторая формирует кнопку «Личный кабинет» в боте Remnashop. Нельзя подставлять URL mini-app подключения в `WEB_CABINET_URL` — такой адрес приведёт к `404`.

Для регистрации и входа по e-mail также настройте SMTP:

```dotenv
EMAIL_ENABLED=true
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USE_TLS=true
EMAIL_USE_SSL=false
EMAIL_USERNAME=mail@example.com
EMAIL_PASSWORD=<пароль SMTP>
EMAIL_FROM_EMAIL=mail@example.com
EMAIL_FROM_NAME=Clean Pay
```

Для SMTP over SSL обычно используют порт `465`, `EMAIL_USE_TLS=false` и `EMAIL_USE_SSL=true`. Не включайте TLS и SSL одновременно.

Примените настройки Remnashop без удаления его volumes:

```bash
cd /opt/remnashop
docker compose up -d --no-deps --force-recreate \
  remnashop remnashop-taskiq-worker remnashop-taskiq-scheduler
curl -f http://127.0.0.1:5000/api/v1/public/plans/public
curl -f https://pay.example.com/auth/telegram/webapp
```

Ожидается HTTP `200`. Уже отправленная Telegram-клавиатура хранит старый URL: после изменения пользователь должен снова отправить `/start` или заново открыть главное меню бота. Не используйте `docker compose down -v`.

## 4. Reverse proxy и HTTPS

DNS-запись домена должна указывать на сервер с reverse proxy.

Если перед Caddy/Nginx расположен отдельный TCP/SNI-прокси или балансировщик, добавьте домен Clean Pay и в его таблицу маршрутизации. Одной DNS-записи и блока Caddy недостаточно: внешний прокси должен передавать TCP/443 на сервер Clean Pay, а режим PROXY protocol на обеих сторонах должен совпадать.

Если Caddy установлен непосредственно на хосте или Clean Pay размещён отдельно:

```caddyfile
pay.example.com {
    encode gzip zstd
    reverse_proxy 127.0.0.1:4000
}
```

Если Caddy работает в Docker и подключён к той же `remnawave-network`, используйте alias контейнера:

```caddyfile
pay.example.com {
    encode gzip zstd
    reverse_proxy clean-pay:4000
}
```

Пример для Nginx на хосте внутри HTTPS `server`:

```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Проверка после выпуска сертификата:

```bash
curl -f https://pay.example.com/api/health/liveness
curl -f https://pay.example.com/api/health/readiness
```

## 5. Необязательные настройки

Cloudflare Turnstile:

```dotenv
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=<site-key для домена Clean Pay>
TURNSTILE_SECRET_KEY=<secret-key>
```

Контакты поддержки включаются через `SUPPORT_ENABLED=true` и переменные `SUPPORT_EMAIL`, `SUPPORT_TELEGRAM_USERNAME`, `SUPPORT_FAQ_URL`. Полный список поддерживаемых значений и безопасные примеры находятся в `.env.example`.

## 6. Ребрендинг

1. Поместите логотип в `public/`, например `public/my-logo.svg`.
2. Укажите `NEXT_PUBLIC_BRAND_NAME` и root-relative путь `NEXT_PUBLIC_BRAND_LOGO_URL=/my-logo.svg`.
3. Измените `EMAIL_FROM_NAME` в Remnashop и имя/аватар бота через BotFather.
4. Пересоберите приложение: `sh start.sh restart` либо `CLEAN_PAY_MODE=remnashop sh start.sh restart`.

По умолчанию используются название `Clean Pay` и логотип `/logo.svg`.

## 7. Управление и обновление

Отдельная установка:

```bash
sh start.sh status
sh start.sh logs
sh start.sh restart
sh start.sh stop
```

Установка рядом с Remnashop:

```bash
CLEAN_PAY_MODE=remnashop sh start.sh status
CLEAN_PAY_MODE=remnashop sh start.sh logs
CLEAN_PAY_MODE=remnashop sh start.sh restart
CLEAN_PAY_MODE=remnashop sh start.sh stop
```

Обновление:

```bash
cd /opt/clean-pay
git pull --ff-only
sh start.sh restart
```

Для совместной установки добавьте `CLEAN_PAY_MODE=remnashop` перед последней командой.

## 8. Резервная копия

Перед обновлением скопируйте `.env` и создайте дамп PostgreSQL:

```bash
cp -p .env ".env.backup-$(date +%Y%m%d-%H%M%S)"
docker compose exec -T postgres pg_dump -U clean_pay -Fc clean_pay > clean-pay.dump
docker compose exec -T postgres pg_restore -l < clean-pay.dump >/dev/null
```

Именованные volumes `postgres-data` и `redis-data` сохраняются при обычном `stop`/`restart`. Никогда не запускайте `docker compose down -v`, `docker volume prune` или `docker system prune --volumes`, если данные не должны быть удалены.

## 9. Диагностика

```bash
docker compose --env-file .env config
docker compose ps
docker compose logs --tail=200 app
curl -f http://127.0.0.1:4000/api/health/liveness
curl -f http://127.0.0.1:4000/api/health/readiness
```

- `502`: приложение не запущено либо reverse proxy использует неверный upstream;
- Remnashop `404`: проверьте `WEB_ENABLED=true` и пересоздание контейнера Remnashop;
- ошибки защищённых операций Remnashop: проверьте совпадение `APP_API_KEY` и `REMNASHOP_API_KEY`;
- ошибки Remnawave: проверьте URL, API-токен и Docker-сеть;
- Telegram/OIDC: проверьте домен, callback `APP_URL/auth/telegram/callback`, client ID и client secret;
- e-mail: проверьте SMTP host/port, режим TLS/SSL и учётные данные.
