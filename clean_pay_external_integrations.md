# Интеграции Clean Pay с внешними сервисами

## 1. Remnashop Public API

**Основная внешняя интеграция проекта.**

Clean Pay не работает напрямую с базой данных Remnashop, а обращается к Remnashop по HTTP API.

### Env

```env
REMNASHOP_API_BASE_URL="https://bot2.clear-vpn.org/api/v1/public"
```

### Где в коде

```text
src/lib/remnashop/client.ts
src/app/api/bff/**/*
docs/remnashop-api.md
```

### Используемые методы Remnashop

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
GET  /auth/me
POST /auth/change-password

POST /auth/email/change
POST /auth/email/request-verification
POST /auth/email/confirm

GET  /plans/public

GET  /subscription/offers
GET  /subscription/current
POST /subscription/purchase
POST /subscription/extend
POST /subscription/reissue
POST /subscription/promocode
GET  /subscription/devices
DELETE /subscription/devices
DELETE /subscription/devices/{hwid}
```

### За что отвечает

```text
регистрация
логин
профиль пользователя
смена пароля
смена и подтверждение e-mail
тарифы
подписки
создание платежей
продление
промокоды
устройства
перевыпуск ссылки подписки
```

---

## 2. Платёжные сервисы

Прямой интеграции с платёжными провайдерами в коде не найдено.

Не найдены прямые интеграции с:

```text
ЮKassa
Robokassa
CloudPayments
Stripe
Tinkoff
PayPal
```

Платёж создаётся через Remnashop:

```text
POST /subscription/purchase
POST /subscription/extend
```

Remnashop возвращает:

```ts
payment_id
payment_url
gateway_type
status
final_amount
currency
```

После этого frontend перенаправляет пользователя на `payment_url`.

### Где в коде

```text
src/app/api/bff/subscription/purchase/route.ts
src/app/api/bff/subscription/extend/route.ts
src/components/payment-confirmation.tsx
src/lib/payment-records.ts
```

### Вывод

Clean Pay сам не принимает webhook-и и не общается с платёжным провайдером напрямую. Платёжная логика вынесена в Remnashop.

---

## 3. Telegram OIDC

Используется вход и привязка Telegram через OIDC authorization code flow + PKCE.

### Env

```env
TELEGRAM_OIDC_ISSUER="https://oauth.telegram.org"
TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT="https://oauth.telegram.org/auth"
TELEGRAM_OIDC_TOKEN_ENDPOINT="https://oauth.telegram.org/token"
TELEGRAM_OIDC_JWKS_URI="https://oauth.telegram.org/.well-known/jwks.json"
TELEGRAM_OIDC_CLIENT_ID="..."
TELEGRAM_OIDC_CLIENT_SECRET="..."
```

### Callback

```text
https://oplata.clear-vpn.org/auth/telegram/callback
```

### Где в коде

```text
src/lib/telegram-oidc.ts
src/app/auth/telegram/start/route.ts
src/app/auth/telegram/callback/route.ts
docs/telegram-oidc.md
```

### Что делает

```text
редиректит пользователя на Telegram OAuth
обменивает code на id_token
проверяет id_token через JWKS
достаёт telegram_id / username / name / picture
создаёт или привязывает локального WebUser
```

---

## 4. Cloudflare Turnstile

Используется как captcha / anti-bot защита.

### Frontend script

```text
https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit
```

### Backend verify endpoint

```text
https://challenges.cloudflare.com/turnstile/v0/siteverify
```

### Env

```env
TURNSTILE_ENABLED="true"
NEXT_PUBLIC_TURNSTILE_SITE_KEY="..."
TURNSTILE_SECRET_KEY="..."
TURNSTILE_VERIFY_URL="https://challenges.cloudflare.com/turnstile/v0/siteverify"
```

### Где в коде

```text
src/components/turnstile-widget.tsx
src/lib/turnstile.ts
```

### Где применяется

```text
логин
регистрация
запрос e-mail кода
подтверждение e-mail кода
Telegram login/link start
```

### Дополнительно

Код читает Cloudflare-заголовок:

```text
cf-connecting-ip
```

Интеграции с Cloudflare API / DNS API / SSL API в коде не найдено.

---

## 5. SMTP

SMTP-настройки есть в env и readiness-check, но прямой отправки писем в коде не найдено.

### Env

```env
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
```

### Где в коде

```text
src/lib/env.ts
src/lib/health-checks.ts
docs/environment.md
prod_faq.md
```

### Фактически в коде

```text
есть TCP-проверка доступности SMTP host/port
нет nodemailer
нет SMTP DATA/send mail реализации
```

### Вывод

E-mail код отправляет Remnashop. Clean Pay только проксирует запрос:

```text
POST /auth/email/request-verification
```

SMTP в Clean Pay сейчас выглядит как настроенная зависимость / проверка готовности, но не как полноценная реализация отправки писем внутри проекта.

---

## 6. PostgreSQL

Используется как локальная база данных Clean Pay.

### Env

```env
DATABASE_URL
POSTGRES_PASSWORD
POSTGRES_DB
```

### Где в коде

```text
prisma/schema.prisma
src/lib/prisma.ts
src/lib/health-checks.ts
docker-compose.prod.yml
docker-compose.prod.external-redis.yml
```

### Что хранит

```text
локальные web-пользователи
web-сессии
Telegram auth state
audit log
payment records
интеграционные статусы
```

### Важно

Это не база данных Remnashop.

Remnashop остаётся источником истины для:

```text
тарифов
подписок
платежей
устройств
VPN-доступа
```

---

## 7. Redis

Используется для rate-limit и cooldown.

### Env

```env
REDIS_URL="redis://redis:6379/0"
```

Также поддерживается:

```text
rediss://
```

### Где в коде

```text
src/lib/redis.ts
src/lib/rate-limit.ts
src/lib/health-checks.ts
docker-compose.prod.yml
docker-compose.prod.external-redis.yml
```

### Что делает

```text
лимиты на логин
лимиты на регистрацию
лимиты на Telegram login/link
лимиты на e-mail verification
лимиты на покупку/продление
cooldown на повторную отправку e-mail кода
```

### Особенность

Redis-клиент написан вручную через `net/tls`. Отдельной npm-библиотеки Redis не найдено.

---

## 8. Support links

Это не API-интеграция, а внешние ссылки в интерфейсе поддержки.

### Env

```env
SUPPORT_ENABLED
SUPPORT_EMAIL
SUPPORT_TELEGRAM_USERNAME
SUPPORT_FAQ_URL
```

### Где в коде

```text
src/app/api/bff/support/route.ts
src/components/support-panel.tsx
src/components/cabinet-panel.tsx
```

### Что генерируется

```text
mailto:<SUPPORT_EMAIL>
https://t.me/<SUPPORT_TELEGRAM_USERNAME>
<SUPPORT_FAQ_URL>
```

---

## 9. Caddy / внешний домен / TLS

Инфраструктурная интеграция, не бизнес-API.

### Домен по умолчанию

```text
oplata.clear-vpn.org
```

### Где

```text
Caddyfile
docker-compose.prod.yml
docker-compose.prod.external-redis.yml
```

### Что делает

```text
принимает 80/443
проксирует на web:3000
добавляет security headers
```

Caddy в обычном режиме сам занимается TLS-сертификатами через ACME.

Явной Cloudflare API-интеграции для выпуска сертификатов в проекте не найдено.

---

## 10. Dev-only интеграции

Для разработки остаётся локальный Mailpit SMTP dev-сервер. BFF-зависимости Remnashop и Cloudflare Turnstile должны быть настроены через env и использовать реальные внешние endpoints.

---

# Что не найдено

В коде не найдены прямые интеграции с:

```text
Telegram Bot API
Cloudflare DNS/API
Cloudflare SSL API
YooKassa
Robokassa
CloudPayments
Stripe
Tinkoff acquiring
PayPal
SMS-шлюзами
S3/MinIO
GitHub API
Google API
Webhook endpoint для платежей
прямой отправкой SMTP-писем
```

---

# Краткий итог

Фактический список внешних интеграций проекта:

```text
1. Remnashop Public API
2. Telegram OIDC
3. Cloudflare Turnstile
4. SMTP — настроен и проверяется, но отправка писем в коде не реализована напрямую
5. PostgreSQL
6. Redis
7. Support links: mailto / t.me / FAQ URL
8. Caddy / внешний домен / TLS
9. Dev-only: Mailpit
```

Главная бизнес-интеграция — **Remnashop Public API**.

Через Remnashop идут:

```text
пользователи
подписки
тарифы
устройства
платежи
e-mail verification
```
