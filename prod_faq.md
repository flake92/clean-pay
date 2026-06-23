# Clean Pay Production FAQ

## Что именно запускается в production

Production-запуск проекта рассчитан на Docker Compose и standalone-сборку Next.js.

В production поднимаются сервисы:

- `web` - Next.js frontend + BFF, собранный как `output: "standalone"`.
- `postgres` - база web-кабинета для Prisma, audit, платежных записей и служебных данных.
- `redis` - хранилище rate-limit и краткоживущих ограничений. Можно использовать встроенный Redis или внешний Redis.
- `caddy` - reverse proxy на `80/443` с автоматическим TLS.
- внешние интеграции: Remnashop API, SMTP, Telegram OIDC, Cloudflare Turnstile.

Важно: внутри production Docker контейнер `web` слушает порт `3000`. Наружу приложение открывает Caddy через `80/443`. Локальные dev/launch порты `4000/4001` к production Docker не относятся.

## Быстрый production-запуск со встроенным Redis

1. На сервере установи Docker и Docker Compose plugin.

2. Склонируй проект и перейди в папку:

```bash
git clone <repo-url> clean-pay
cd clean-pay
```

3. Создай production env:

```bash
cp .env.production.example .env
```

4. Заполни `.env` реальными значениями. Минимально обязательно:

```env
APP_DOMAIN=oplata.clear-vpn.org
APP_URL=https://oplata.clear-vpn.org
NEXT_PUBLIC_APP_URL=https://oplata.clear-vpn.org

POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=clean_pay

REMNASHOP_API_BASE_URL=https://bot2.clear-vpn.org/api/v1/public
WEB_JWT_SECRET=<long-random-secret>
WEB_REFRESH_SECRET=<long-random-secret>
AUDIT_IP_HASH_SECRET=<long-random-secret>

SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_USER=<smtp-user>
SMTP_PASSWORD=<smtp-password>
SMTP_FROM=CleanVPN <no-reply@example.com>

TELEGRAM_OIDC_ISSUER=https://oauth.telegram.org
TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT=https://oauth.telegram.org/auth
TELEGRAM_OIDC_TOKEN_ENDPOINT=https://oauth.telegram.org/token
TELEGRAM_OIDC_JWKS_URI=https://oauth.telegram.org/.well-known/jwks.json
TELEGRAM_OIDC_CLIENT_ID=<telegram-client-id>
TELEGRAM_OIDC_CLIENT_SECRET=<telegram-client-secret>

TURNSTILE_ENABLED=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<cloudflare-turnstile-site-key>
TURNSTILE_SECRET_KEY=<cloudflare-turnstile-secret-key>
TURNSTILE_VERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify
```

5. Запусти production stack:

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

6. Примени Prisma migrations:

```bash
docker compose --env-file .env -f docker-compose.prod.yml exec web npx prisma migrate deploy
```

7. Проверь статус:

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
curl -I https://oplata.clear-vpn.org/api/health
curl -s https://oplata.clear-vpn.org/api/health/readiness
```

## Запуск с внешним Redis

Используй этот вариант, если Redis уже есть отдельно: managed Redis, отдельный сервер или общий инфраструктурный Redis.

1. В `.env` обязательно укажи:

```env
REDIS_URL=redis://redis.example.internal:6379/0
```

2. Запусти compose без встроенного Redis:

```bash
docker compose --env-file .env -f docker-compose.prod.external-redis.yml up -d --build
```

3. Миграции:

```bash
docker compose --env-file .env -f docker-compose.prod.external-redis.yml exec web npx prisma migrate deploy
```

## Как работает standalone Next.js

В `next.config.ts` включено:

```ts
output: "standalone"
```

Поэтому production-сервер нельзя запускать через `next start`. Правильный запуск внутри Dockerfile:

```bash
node server.js
```

А локально после `npm run build`:

```bash
PORT=4000 HOSTNAME=0.0.0.0 node .next/standalone/server.js
```

Для mock-сборки локально:

```bash
CLEAN_PAY_MOCK_MODE=1 next build
CLEAN_PAY_MOCK_MODE=1 PORT=4001 HOSTNAME=0.0.0.0 node .next-mock/standalone/server.js
```

В production mock-режим не включать.

## Внешний Caddy или reverse proxy из другого compose

Если Caddy уже запущен в другом проекте, как на тестовом стенде Remnawave, не используй `127.0.0.1` из Caddy-контейнера для доступа к Clean Pay. Внутри контейнера `127.0.0.1` указывает на сам контейнер Caddy.

Правильная схема:

```bash
docker network connect clean-pay_default caddy
docker restart caddy
```

А в Caddyfile внешнего проекта upstream должен идти в контейнер Clean Pay по docker-сети:

```caddyfile
oplata.clear-vpn.org {
    encode gzip zstd
    reverse_proxy clean-pay-web-1:3000
}
```

Если используется другое имя compose project, сеть будет называться иначе. Проверь ее командой:

```bash
docker network ls
docker inspect clean-pay-web-1 --format '{{json .NetworkSettings.Networks}}'
```

Симптом неправильной настройки: `https://oplata.clear-vpn.org` отдает `502`, а в логах Caddy есть `dial tcp 127.0.0.1:4010: connect: connection refused`.

## DNS, Cloudflare и TLS

Рекомендуемый путь:

1. DNS `APP_DOMAIN`, например `oplata.clear-vpn.org`, должен указывать на production-сервер.
2. На сервере должны быть открыты входящие порты `80` и `443`.
3. Caddy сам получает и обновляет TLS-сертификаты.
4. В Cloudflare SSL/TLS ставь `Full (strict)`.

Если Cloudflare proxy включен и Caddy не может получить сертификат через HTTP/HTTPS challenge, нужно отдельно настраивать DNS challenge для Caddy. В текущем `Caddyfile` DNS challenge не настроен.

## Интеграция с Remnashop

Clean Pay не является источником истины для тарифов и подписок. Источник истины - Remnashop.

В `.env` нужен:

```env
REMNASHOP_API_BASE_URL=https://bot2.clear-vpn.org/api/v1/public
```

Что проверить после подключения:

- `/api/bff/plans/public` возвращает публичные планы.
- `/api/bff/subscription/offers` возвращает offers для авторизованного пользователя.
- покупка подписки создаёт платеж/переход в нужный gateway.
- после успешной оплаты статус подтягивается из Remnashop.
- текущая подписка, VPN-ссылка, устройства и продление работают через BFF.

Если Remnashop недоступен, readiness должен показать проблему в `/api/health/readiness`.

## Интеграция с Telegram OIDC

Нужны переменные:

```env
TELEGRAM_OIDC_ISSUER=https://oauth.telegram.org
TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT=https://oauth.telegram.org/auth
TELEGRAM_OIDC_TOKEN_ENDPOINT=https://oauth.telegram.org/token
TELEGRAM_OIDC_JWKS_URI=https://oauth.telegram.org/.well-known/jwks.json
TELEGRAM_OIDC_CLIENT_ID=<telegram-client-id>
TELEGRAM_OIDC_CLIENT_SECRET=<telegram-client-secret>
```

На стороне Telegram/OIDC redirect URL должен вести на production domain. Обычно это callback вида:

```text
https://oplata.clear-vpn.org/auth/telegram/callback
```

Проверка:

```bash
curl -I https://oplata.clear-vpn.org/auth/telegram/start
```

В браузере должен начаться корректный Telegram auth flow.

## Интеграция с Cloudflare Turnstile

Turnstile защищает чувствительные auth-действия: регистрацию, вход, подтверждение e-mail/TG ID и связанные auth-процессы.

В Cloudflare Turnstile создай widget для production domain и заполни:

```env
TURNSTILE_ENABLED=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site-key>
TURNSTILE_SECRET_KEY=<secret-key>
TURNSTILE_VERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify
```

Не коммить `TURNSTILE_SECRET_KEY`. В git должны быть только placeholders.

Если нужно временно отключить Turnstile для emergency-debug:

```env
TURNSTILE_ENABLED=false
```

В production так оставлять нельзя.

## Интеграция с SMTP

SMTP нужен для e-mail подтверждений и кодов.

Переменные:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=clean-pay@example.com
SMTP_PASSWORD=<smtp-password>
SMTP_FROM=CleanVPN <clean-pay@example.com>
```

Проверка:

```bash
curl -s https://oplata.clear-vpn.org/api/health/readiness
```

Readiness проверяет TCP-connect к SMTP. Если SMTP не принимает соединение, production может работать частично, но e-mail подтверждения будут ломаться.

## Secrets и безопасность

Обязательно сгенерируй длинные случайные значения:

```bash
openssl rand -base64 48
```

Для:

- `WEB_JWT_SECRET`
- `WEB_REFRESH_SECRET`
- `AUDIT_IP_HASH_SECRET`
- `POSTGRES_PASSWORD`

Правила:

- не коммить `.env`;
- не хранить реальные ключи в README/FAQ/plan;
- менять секреты через secret manager или закрытый production `.env`;
- при смене JWT/refresh secrets старые пользовательские сессии станут недействительными.

## Проверка после деплоя

Минимальный smoke:

```bash
curl -I https://oplata.clear-vpn.org/api/health
curl -s https://oplata.clear-vpn.org/api/health/readiness
curl -I https://oplata.clear-vpn.org/login
curl -I https://oplata.clear-vpn.org/themes/lara-light-indigo/theme.css
```

Через контейнер:

```bash
docker compose --env-file .env -f docker-compose.prod.yml exec web node -e 'fetch("http://127.0.0.1:3000/api/health").then(async r => { console.log(r.status, await r.text()) })'
```

Пользовательский acceptance:

1. Открыть `/login`.
2. Зарегистрироваться через e-mail.
3. Получить и подтвердить e-mail код.
4. Войти через e-mail/password.
5. Проверить Telegram login/link flow.
6. Открыть тарифы.
7. Создать оплату.
8. Вернуться с success/fail/pending payment pages.
9. Проверить кабинет, текущую подписку, VPN-ссылку и устройства.
10. Проверить logout и повторный login.

## Логи и диагностика

Смотреть логи всех сервисов:

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f
```

Только web:

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f web
```

Только Caddy:

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f caddy
```

Проверить контейнеры:

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
```

Проверить env внутри web без вывода секретов:

```bash
docker compose --env-file .env -f docker-compose.prod.yml exec web node -e 'console.log({ node: process.version, appUrl: process.env.APP_URL, redis: Boolean(process.env.REDIS_URL), turnstile: process.env.TURNSTILE_ENABLED })'
```

## Обновление production

Обычное обновление:

```bash
git pull
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
docker compose --env-file .env -f docker-compose.prod.yml exec web npx prisma migrate deploy
curl -I https://oplata.clear-vpn.org/api/health
curl -s https://oplata.clear-vpn.org/api/health/readiness
```

Для external Redis используй файл:

```bash
docker-compose.prod.external-redis.yml
```

## Backup и rollback

Перед рискованным обновлением сделай backup Postgres volume/database.

Простой SQL dump:

```bash
docker compose --env-file .env -f docker-compose.prod.yml exec postgres pg_dump -U postgres clean_pay > clean_pay_backup.sql
```

Rollback к предыдущему commit:

```bash
git checkout <previous-commit>
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
docker compose --env-file .env -f docker-compose.prod.yml exec web npx prisma migrate deploy
```

Важно: если новая версия уже применила несовместимые DB migrations, rollback кода может потребовать ручного DB rollback из backup.

## Частые ошибки

### `next start does not work with output: standalone`

Причина: пытаешься запустить standalone build через `next start`.

Правильно:

```bash
node .next/standalone/server.js
```

В Docker это уже делается через `CMD ["node", "server.js"]`.

### `EADDRINUSE: address already in use`

Порт уже занят другим процессом.

Проверить внутри контейнера:

```bash
ps aux | grep node
```

Остановить старый compose stack:

```bash
docker compose --env-file .env -f docker-compose.prod.yml down
```

### Caddy не получает сертификат

Проверь:

- DNS указывает на сервер;
- порты `80/443` открыты;
- `APP_DOMAIN` правильный;
- Cloudflare SSL/TLS стоит `Full (strict)`;
- Cloudflare proxy не блокирует ACME challenge.

### `/api/health` работает, а `/api/health/readiness` падает

`/api/health` проверяет базовую живость приложения. `/api/health/readiness` проверяет зависимости: DB, Redis, Remnashop, SMTP. Смотри JSON readiness и логи `web`.

### Не работает e-mail подтверждение

Проверь SMTP env, доступность SMTP host/port с production сервера и корректность `SMTP_FROM`.

### Не работает Telegram login

Проверь redirect URL, client id/secret, `APP_URL`, `NEXT_PUBLIC_APP_URL` и callback domain.

### Turnstile всегда отклоняет запрос

Проверь, что site key и secret key от одного widget, domain добавлен в Turnstile widget, а `TURNSTILE_VERIFY_URL` указывает на Cloudflare.

## Что не использовать в production

Не использовать:

```bash
npm run dev
npm run dev:mock
npm run start:mock
CLEAN_PAY_MOCK_MODE=1
```

`mock` нужен только для preview/frontend проверки без реального Remnashop flow.

## Production checklist

Перед включением трафика:

- DNS настроен.
- `.env` заполнен без placeholders.
- Docker stack поднят.
- Migrations применены.
- `/api/health` возвращает OK.
- `/api/health/readiness` без критичных ошибок.
- Login/register работают.
- Turnstile включен и проходит.
- SMTP отправляет письма.
- Telegram auth flow работает.
- Remnashop plans/offers/payment flow работает.
- Caddy TLS активен.
- Backup Postgres настроен.
- Логи web/caddy смотрятся и не содержат секретов.
