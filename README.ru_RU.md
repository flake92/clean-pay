# Clean Pay

[English](README.md) | Русский

Clean Pay - веб-кабинет оплаты и управления подпиской CleanVPN. Пользователь входит в кабинет, видит статус подписки, продлевает доступ, управляет профилем и получает ссылку подключения. Данные кабинета хранятся в PostgreSQL и Redis. Тарифы, платежи и аккаунты берутся из Remnashop, ссылка подключения берётся только из Remnawave.

> **Важно:** Clean Pay разворачивается на Linux-сервере и должен стоять за reverse proxy с HTTPS. Настройте внешний reverse proxy на домен кабинета и проксируйте его на `CLEAN_PAY_BIND:CLEAN_PAY_PORT`. По умолчанию это `127.0.0.1:4000`.

## Запуск В 3 Шага

### 1. Склонировать Проект

```bash
git clone <clean-pay-repository-url>
cd clean-pay
```

### 2. Заполнить `.env`

```bash
cp deploy/prod/.env.example deploy/prod/.env
```

Заполните `deploy/prod/.env` реальными значениями из таблицы ниже.

### 3. Запустить

```bash
sh start.sh
```

## Переменные Clean Pay

| Переменная | Обязательна | Пример | Назначение |
| --- | --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | Нет | `clean-pay-prod` | Имя проекта Docker Compose. |
| `CLEAN_PAY_IMAGE` | Нет | `clean-pay-prod-app:local` | Имя Docker image приложения. |
| `CLEAN_PAY_BIND` | Нет | `127.0.0.1` | IP хоста, на котором слушает приложение. Для reverse proxy используйте `127.0.0.1`. |
| `CLEAN_PAY_PORT` | Нет | `4000` | Порт хоста для приложения. |
| `CLEAN_PAY_EDGE_NETWORK` | Нет | `remnawave-network` | Внешняя Docker-сеть. `start.sh` создаёт её, если сети нет. |
| `POSTGRES_DB` | Нет | `clean_pay` | Имя встроенной PostgreSQL базы. |
| `POSTGRES_USER` | Нет | `clean_pay` | Пользователь встроенной PostgreSQL базы. |
| `POSTGRES_PASSWORD` | Да | `change-me-postgres-password` | Пароль встроенной PostgreSQL базы. |
| `DATABASE_URL` | Да | `postgresql://clean_pay:change-me-postgres-password@postgres:5432/clean_pay?schema=public` | Подключение Clean Pay к PostgreSQL. |
| `REDIS_URL` | Да | `redis://redis:6379/0` | Подключение Clean Pay к Redis. |
| `APP_URL` | Да | `https://oplata.example.com` | Публичный серверный URL кабинета. |
| `NEXT_PUBLIC_APP_URL` | Да | `https://oplata.example.com` | Публичный URL кабинета во frontend. Обычно совпадает с `APP_URL`. |
| `NEXT_PUBLIC_BRAND_NAME` | Нет | `Clean Pay` | Название кабинета. После изменения нужна пересборка. |
| `NEXT_PUBLIC_BRAND_LOGO_URL` | Нет | `/clean_vpn_logo.jpg` | Логотип кабинета. После изменения нужна пересборка. |
| `LOG_LEVEL` | Нет | `info` | Уровень логирования: `debug`, `info`, `warn`, `error`. |
| `REMNASHOP_API_BASE_URL` | Да | `https://bot.example.com/api/v1/public` | Public API Remnashop. |
| `REMNAWAVE_API_BASE_URL` | Да | `https://panel.example.com` | URL панели/API Remnawave без `/api`. |
| `REMNAWAVE_TOKEN` | Да | `change-me` | API-токен Remnawave для получения ссылки подключения. |
| `WEB_JWT_SECRET` | Да | генерируется `start.sh` | Секрет web access/session tokens. |
| `WEB_REFRESH_SECRET` | Да | генерируется `start.sh` | Секрет refresh/session tokens. |
| `AUDIT_IP_HASH_SECRET` | Нет | генерируется `start.sh` | Секрет для хеширования IP в audit logs. |
| `COOKIE_SECURE` | Нет | `true` | `true` для HTTPS. |
| `COOKIE_SAMESITE` | Нет | `lax` | SameSite policy: `lax`, `strict`, `none`. |
| `TELEGRAM_OIDC_CLIENT_ID` | Да | `1234567890` | ID Telegram-бота для OAuth. |
| `TELEGRAM_OIDC_CLIENT_SECRET` | Да | `change-me` | Telegram OAuth client secret. |
| `TELEGRAM_BOT_TOKEN` | Нет | `1234567890:change-me` | Токен Telegram-бота для Telegram flows. |
| `TURNSTILE_ENABLED` | Нет | `false` | Включает Cloudflare Turnstile. |
| `TURNSTILE_SITE_KEY` | Если Turnstile включён | `1x00000000000000000000AA` | Public site key Turnstile, который передаётся во frontend. |
| `TURNSTILE_SECRET_KEY` | Если Turnstile включён | `1x0000000000000000000000000000000AA` | Secret key для Cloudflare verification API. |
| `TURNSTILE_VERIFY_URL` | Нет | `https://challenges.cloudflare.com/turnstile/v0/siteverify` | Endpoint проверки Turnstile. |
| `SUPPORT_ENABLED` | Нет | `false` | Включает блок поддержки. |
| `SUPPORT_EMAIL` | Нет | `support@example.com` | Email поддержки. |
| `SUPPORT_TELEGRAM_USERNAME` | Нет | `cleanpay_support` | Telegram username поддержки без `@`. |
| `SUPPORT_FAQ_URL` | Нет | `https://oplata.example.com/support` | URL FAQ/поддержки. |
| `CLEAN_PAY_READINESS_MAILPIT_URL` | Нет | пусто | Опциональная readiness-проверка Mailpit. |
| `CLEAN_PAY_READINESS_REMNAWAVE_URL` | Нет | пусто | Опциональная readiness-проверка Remnawave. |

## Необходимые Переменные Remnashop

Эти переменные добавляются во внешний Remnashop `.env`, не в Clean Pay.

| Переменная Remnashop | Обязательна | Пример | Назначение |
| --- | --- | --- | --- |
| `WEB_ENABLED` | Да | `true` | Включает public API Remnashop для Clean Pay. |
| `WEB_CABINET_URL` | Да | `https://oplata.example.com/auth/telegram/webapp` | URL кабинета Clean Pay для web/Telegram flows. |
| `APP_API_KEY` | Да | `change-me-long-random-api-key` | Секрет Remnashop web API при `WEB_ENABLED=true`. |
| `APP_JWT_SECRET` | Да | `change-me-long-random-jwt-secret` | JWT secret Remnashop web API при `WEB_ENABLED=true`. |
| `EMAIL_ENABLED` | Да | `true` | Включает отправку кодов подтверждения e-mail. |
| `EMAIL_HOST` | Да | `smtp.example.com` | SMTP host. |
| `EMAIL_PORT` | Да | `587` | SMTP port. |
| `EMAIL_USE_TLS` | Да | `true` | STARTTLS для SMTP. Обычно `true` для порта `587`. |
| `EMAIL_USE_SSL` | Да | `false` | SMTP over SSL. Обычно `true` для порта `465`. |
| `EMAIL_USERNAME` | Да | `code@example.com` | SMTP username. |
| `EMAIL_PASSWORD` | Да | `change-me-smtp-password` | SMTP password. |
| `EMAIL_FROM_EMAIL` | Да | `code@example.com` | From address для писем. |
| `EMAIL_FROM_NAME` | Нет | `Clean Pay` | Имя отправителя. |
| `EMAIL_VERIFICATION_CODE_TTL_MINUTES` | Нет | `15` | Срок жизни кода подтверждения. |

Проверка Remnashop public API:

```bash
curl https://bot.example.com/api/v1/public/plans/public
```

Ожидаемый результат: HTTP `200` и JSON `{"plans":[...]}` или `{"plans":[]}`.
