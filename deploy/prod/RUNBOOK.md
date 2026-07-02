# Clean Pay Prod-Like Runbook

Этот стенд собирает и запускает production-like контейнер Clean Pay.

Состав стенда:

```text
app       Clean Pay production image
postgres  PostgreSQL для Clean Pay
redis     Redis для Clean Pay
```

Публичный вход только один:

```text
http://localhost:4000
```

PostgreSQL и Redis наружу не публикуются.

## Файлы

Локальные файлы с секретами:

```text
deploy/prod/.env
deploy/prod/remnashop.env
```

Они игнорируются Git и не должны попадать в коммиты.

Безопасные примеры без реальных секретов:

```text
deploy/prod/.env.example
deploy/prod/remnashop.env.example
```

## Linux / Devcontainer

Запускать из корня репозитория:

```bash
cd /workspace/clean-pay
```

или на Linux-хосте:

```bash
cd /path/to/clean-pay
```

### Сборка

```bash
make build
```

Альтернатива без `make`:

```bash
node deploy/prod/prod.mjs build
```

### Запуск В Prod-Режиме

```bash
make prod-up
```

Альтернатива без `make`:

```bash
node deploy/prod/prod.mjs up
```

### Запуск В Debug-Режиме

```bash
make prod-up-debug
```

Альтернатива без `make`:

```bash
node deploy/prod/prod.mjs up -debug
```

### Проверка

Prod-режим:

```bash
make prod-verify
```

Debug-режим:

```bash
make prod-verify-debug
```

Альтернатива без `make`:

```bash
node deploy/prod/prod.mjs verify
node deploy/prod/prod.mjs verify -debug
```

Ожидаемый успешный ответ:

```json
{"status":"ok","service":"clean-pay","version":"0.1.0"}
```

### Логи

Prod-режим:

```bash
make prod-logs
```

Debug-режим:

```bash
make prod-logs-debug
```

Альтернатива без `make`:

```bash
node deploy/prod/prod.mjs logs
node deploy/prod/prod.mjs logs -debug
```

### Остановка

```bash
make prod-down
```

Альтернатива без `make`:

```bash
node deploy/prod/prod.mjs down
```

### Полная Smoke-Проверка В Debug-Режиме

```bash
make build
make prod-up-debug
make prod-verify-debug
make prod-logs-debug
make prod-down
```

## Windows CMD Через Docker Compose

Этот режим не требует `node` и `make` на Windows-хосте.

Запускать из корня репозитория:

```cmd
cd C:\code\clean-pay
```

### Сборка

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml build
```

### Запуск В Prod-Режиме

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml up -d
```

### Запуск В Debug-Режиме

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.debug.yml up -d
```

### Проверка

```cmd
curl http://127.0.0.1:4000/api/health
```

Ожидаемый успешный ответ:

```json
{"status":"ok","service":"clean-pay","version":"0.1.0"}
```

### Статус Контейнеров

Prod-режим:

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml ps
```

Debug-режим:

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.debug.yml ps
```

### Логи

Prod-режим:

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml logs -f app
```

Debug-режим:

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.debug.yml logs -f app
```

### Остановка

Prod-режим:

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml down
```

Debug-режим:

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.debug.yml down
```

### Полная Smoke-Проверка В Debug-Режиме

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.debug.yml down
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml build
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.debug.yml up -d
curl http://127.0.0.1:4000/api/health
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.debug.yml logs -f app
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.debug.yml down
```

## Telegram OAuth

Для реального Telegram OAuth в `deploy/prod/.env` должны быть заполнены:

```text
TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT=https://oauth.telegram.org/auth
TELEGRAM_OIDC_CLIENT_ID=<numeric_bot_id>
TELEGRAM_BOT_TOKEN=<numeric_bot_id>:<bot_token_secret>
```

`TELEGRAM_OIDC_CLIENT_ID` должен быть числовым id бота. Обычно это первая часть
`TELEGRAM_BOT_TOKEN` до двоеточия.

Если оставить placeholder вроде `clean-pay-local-prod-like`, Telegram откроет
страницу с ошибкой:

```text
bot_id required
```

Для OIDC-flow в URL должен быть параметр `client_id=<numeric_bot_id>`.
Параметр `bot_id` относится к старому Telegram Login Widget flow и может вернуть:

```text
deprecated
```

После изменения Telegram-переменных нужно пересобрать и пересоздать `app`:

```cmd
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.debug.yml build app
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.debug.yml up -d --force-recreate app
```

## Ошибка Email delivery is not configured

Если при регистрации в логах приложения видно:

```text
POST /auth/email/request-verification -> 503
Email delivery is not configured
```

это означает, что Clean Pay успешно дошел до внешнего Remnashop, но на стороне
Remnashop не настроена отправка email.

Исправлять нужно `.env` реального Remnashop-сервера, например:

```text
/opt/remnashop/.env
```

Минимально должны быть заполнены SMTP/email-переменные. Шаблон есть в:

```text
deploy/prod/remnashop.env.example
```

После изменения `.env` на сервере Remnashop нужно перезапустить его контейнеры:

```bash
cd /opt/remnashop
docker compose up -d --force-recreate remnashop remnashop-taskiq-worker remnashop-taskiq-scheduler
docker compose logs -f remnashop
```
