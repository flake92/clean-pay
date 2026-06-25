# Задача для LLM: привести dev-стенд и интеграционные тесты Clean Pay к настоящему full-stack уровню

## Главная цель

Нужно доработать проект так, чтобы локальный devcontainer-стенд был проверяемым, воспроизводимым и самодостаточным, а интеграционные тесты стали настоящими интеграционными/full-stack тестами.

Важно: **не адаптировать приложение под тесты**.  
Если тест выявляет проблему, нужно исправлять реальную ошибку конфигурации, интеграции, маршрута, окружения, контракта или обработки ответа. Нельзя делать искусственные bypass-ветки в приложении только ради зелёных тестов.

## Контекст

Проект Clean Pay — это web-кабинет на Next.js, который работает как отдельное приложение/BFF и интегрируется с Remnashop через публичный API.

Локальный devcontainer должен поднимать весь необходимый стенд:

- приложение Clean Pay;
- PostgreSQL для Clean Pay;
- Redis для Clean Pay;
- Remnashop;
- PostgreSQL для Remnashop;
- cache/Redis/Valkey для Remnashop;
- mock Remnawave;
- mock Telegram Bot API;
- mock Telegram OIDC/Login;
- SMTP/Mailpit;
- reverse proxy Caddy, если он используется в локальной схеме.

Сейчас часть сценариев запускается, но реальные проверки слабые. Есть ошибки интеграции, например:

```text
Email delivery is not configured
```

при вызове:

```text
/api/bff/auth/email/request-verification
```

Clean Pay в этом случае корректно проксирует ошибку upstream, но сам dev-стенд не гарантирует, что Remnashop реально настроен на отправку писем через Mailpit.

## Важное ограничение

Нельзя менять бизнес-логику приложения ради тестов.

Запрещено:

- добавлять test-only bypass в production-код;
- отключать настоящие проверки авторизации только ради тестов;
- мокать Remnashop внутри приложения, если задача — проверить реальную интеграцию;
- подменять реальные endpoint handlers заглушками;
- менять контракты API только ради удобства теста;
- скрывать 5xx ошибки в тестах;
- переписывать application code под сценарий теста.

Разрешено:

- дорабатывать `.devcontainer`;
- дорабатывать локальный Docker Compose;
- добавлять dev-only mock-сервисы;
- добавлять тестовые скрипты;
- добавлять отдельные e2e/full-stack тесты;
- исправлять реальные баги приложения, если тесты их обнаружили;
- исправлять неправильную обработку ошибок, если она действительно неверная;
- исправлять конфигурацию env;
- исправлять несовпадения контрактов между Clean Pay и Remnashop;
- улучшать readiness/health проверки;
- улучшать документацию по запуску стенда.

## Что нужно проверить в текущем проекте

Сначала нужно провести аудит текущих тестов.

Проверить:

- `package.json`;
- `vitest.config.*`;
- `tests/unit`;
- `tests/integration`;
- `tests/e2e`, если есть;
- `.devcontainer`;
- `.vscode/tasks.json`;
- `.vscode/launch.json`;
- любые старые integration/dev compose файлы, если остались.

Нужно определить:

1. Какие тесты реально unit.
2. Какие тесты называются integration, но на самом деле всё мокают.
3. Какие тесты поднимают настоящие контейнеры.
4. Какие тесты ходят в реальный HTTP-сервер Next.js.
5. Какие тесты ходят в реальный Remnashop.
6. Какие тесты проверяют PostgreSQL.
7. Какие тесты проверяют Redis.
8. Какие тесты проверяют SMTP/Mailpit.
9. Какие тесты проверяют Telegram OIDC flow.
10. Какие тесты проверяют Remnawave mock.
11. Какие endpoint-ы вообще не покрыты.

Если текущие `tests/integration` используют `vi.mock(...)` для Remnashop, Prisma, Redis, health checks или rate limit, то такие тесты не считать настоящими интеграционными. Их можно оставить как route-handler/component integration, но нужно переименовать или явно отделить от full-stack тестов.

## Требуемая новая структура тестов

Нужно разделить тесты по уровням.

Рекомендуемая структура:

```text
tests/
  unit/
    ...
  integration/
    route-handlers/
      ...
    services/
      ...
  e2e/
    full-stack/
      ...
scripts/
  e2e-devcontainer.sh
  wait-for-http.sh
  wait-for-compose.sh
```

Где:

- `unit` — быстрые тесты без контейнеров;
- `integration/route-handlers` — тесты route handlers с осознанными mock-ами;
- `integration/services` — тесты отдельных сервисов с реальной БД/Redis, если нужно;
- `e2e/full-stack` — настоящие full-stack проверки через HTTP и поднятый Docker Compose.

## Что значит настоящий full-stack тест

Настоящий full-stack тест должен:

1. Поднять весь devcontainer compose stack.
2. Дождаться готовности всех сервисов.
3. Запустить миграции Clean Pay.
4. Запустить Next.js сервер на `0.0.0.0:4000`.
5. Ходить в приложение по HTTP, например `http://127.0.0.1:4000`.
6. Не импортировать напрямую route handlers.
7. Не мокать Remnashop внутри Clean Pay.
8. Не мокать Prisma внутри Clean Pay.
9. Не мокать Redis внутри Clean Pay.
10. Проверять реальные ответы Clean Pay BFF.
11. Проверять, что Clean Pay реально достучался до Remnashop.
12. Проверять, что Remnashop реально достучался до своих зависимостей.
13. Проверять, что email verification реально приводит к письму в Mailpit.
14. Проверять, что Telegram login реально проходит через локальный OIDC mock.
15. Проверять, что endpoint-ы не возвращают неожиданные 5xx.
16. Падать на реальных интеграционных проблемах, а не скрывать их.

## Devcontainer: требования

Devcontainer должен быть единственным локальным dev-стендом для проекта.

Нужно проверить и при необходимости доработать:

```text
.devcontainer/devcontainer.json
.devcontainer/docker-compose.yml
.devcontainer/Dockerfile
.devcontainer/Caddyfile
.devcontainer/remnashop-dev.Dockerfile
.devcontainer/remnawave-mock/*
.devcontainer/telegram-mock/*
.devcontainer/telegram-oidc-mock/*
```

Требования:

- Clean Pay должен запускаться на `4000` внутри контейнера.
- На хост должен пробрасываться `4000:4000`.
- Prisma Studio должен запускаться на `5555`.
- На хост должен пробрасываться `5555:5555`.
- Mailpit UI должен быть доступен на `http://localhost:8025`.
- Mailpit SMTP должен быть доступен внутри compose-сети как `smtp:1025`.
- Telegram OIDC mock должен быть доступен браузеру как `http://localhost:8090`.
- Telegram OIDC mock должен быть доступен контейнерам как `http://telegram-oidc-mock:8090`.
- Remnashop должен использовать dev-only env, не реальные домены и не реальные секреты.
- Все домены в devcontainer должны быть обезличены или локальные.
- Не должно быть реальных production secrets.
- `node_modules` volume должен быть доступен пользователю `node`.
- Не должно требоваться ручное `chmod`/`chown` по проекту на хосте.
- Devcontainer должен быть воспроизводимым на другой машине.

## Отдельное требование по production impact

Все изменения для локального стенда должны быть изолированы.

Разрешённые файлы для dev-стенда:

```text
.devcontainer/**
.vscode/launch.json
.vscode/tasks.json
scripts/**
tests/**
package.json
```

Изменения в `src/**` разрешены только если найден реальный баг приложения.  
Перед таким изменением нужно объяснить:

- какой endpoint ломается;
- какой реальный контракт нарушен;
- почему это не test-only изменение;
- почему это должно работать и в production;
- какой тест теперь подтверждает исправление.

## Проверка email verification

Нужно отдельно довести сценарий подтверждения email до рабочего состояния в devcontainer.

Проверить цепочку:

```text
Clean Pay UI/BFF
  -> /api/bff/auth/email/request-verification
    -> Remnashop /auth/email/request-verification
      -> Remnashop email delivery
        -> smtp:1025
          -> Mailpit
```

Тест должен доказать, что:

1. endpoint Clean Pay отвечает не 5xx;
2. Remnashop не возвращает `Email delivery is not configured`;
3. письмо реально появляется в Mailpit;
4. письмо отправлено на нужный test email;
5. из письма можно извлечь verification code, если это требуется следующим сценарием;
6. подтверждение кода проходит через реальный endpoint, если контракт Remnashop это поддерживает.

Если email delivery не работает, нельзя просто ослабить тест. Нужно найти:

- какие env реально ожидает Remnashop;
- видит ли Remnashop эти env;
- доступен ли `smtp:1025` из контейнера Remnashop;
- не хранит ли Remnashop email-настройку в БД;
- не нужен ли отдельный dev-init для Remnashop;
- не стартует ли worker/scheduler без нужных env;
- не кешируется ли disabled-состояние в Redis/Valkey.

## Проверка Telegram login

Нужно проверить цепочку:

```text
Clean Pay
  -> /auth/telegram/start
    -> локальный Telegram OIDC mock
      -> /auth/telegram/callback
        -> Clean Pay auth/session
          -> Remnashop user/link flow, если он предусмотрен
```

Требования:

- В devcontainer не ходить в настоящий `https://oauth.telegram.org`.
- Не использовать реальные Telegram credentials.
- Использовать локальный `telegram-oidc-mock`.
- Mock должен отдавать валидный `id_token` и JWKS.
- Clean Pay должен пройти callback без `bot_id required`.
- После успешного входа `/api/bff/auth/me` должен возвращать авторизованного пользователя или ожидаемый доменный статус.
- Если Remnashop требует email или Telegram id, тест должен проверять именно реальный expected flow, а не bypass.

## Какие endpoint-ы нужно покрыть

Нужно составить актуальный список endpoint-ов из проекта автоматически или вручную по файловой структуре `src/app/api` и auth routes.

Минимально покрыть:

### Health

```text
GET /api/health
GET /api/health/readiness
GET /api/health/liveness
```

Если каких-то endpoint-ов нет, не создавать искусственно. Зафиксировать фактический список.

### Auth / local session

```text
GET /api/me
POST /api/logout
```

### BFF auth

```text
GET /api/bff/auth/me
POST /api/bff/auth/identify
POST /api/bff/auth/logout
POST /api/bff/auth/email/request-verification
POST /api/bff/auth/email/confirm
POST /api/bff/auth/email/change
POST /api/bff/auth/change-password
```

### Telegram auth

```text
GET /auth/telegram/start
GET /auth/telegram/callback
```

### Passkey/WebAuthn

```text
POST /api/bff/auth/passkey/register/options
POST /api/bff/auth/passkey/register/verify
POST /api/bff/auth/passkey/login/options
POST /api/bff/auth/passkey/login/verify
GET /api/bff/auth/passkey/credentials
DELETE /api/bff/auth/passkey/credentials/:id
```

Для WebAuthn не обязательно полностью эмулировать браузерный authenticator на первом этапе. Но нужно проверить, что endpoint-ы:

- доступны;
- валидируют вход;
- не дают неожиданный 5xx;
- корректно отвечают без сессии;
- корректно отвечают с сессией, если сценарий возможен.

### Plans

```text
GET /api/bff/plans/public
```

### Subscription

```text
GET /api/bff/subscription/current
GET /api/bff/subscription/offers
GET /api/bff/subscription/devices
DELETE /api/bff/subscription/devices
DELETE /api/bff/subscription/devices/:hwid
POST /api/bff/subscription/promocode
POST /api/bff/subscription/reissue
POST /api/bff/subscription/purchase
POST /api/bff/subscription/extend
```

### Payments

```text
GET /api/bff/payments/history
GET /api/bff/payments/status
```

### Support

```text
GET /api/bff/support
```

Если в проекте есть другие endpoint-ы, добавить их в матрицу покрытия.

## Требования к тестам endpoint-ов

Для каждого endpoint-а нужно определить:

- метод;
- URL;
- нужен ли пользователь;
- нужен ли verified email;
- нужен ли Telegram login;
- нужен ли активный subscription;
- ожидаемый статус без сессии;
- ожидаемый статус с сессией;
- ожидаемую форму ответа;
- upstream-зависимости;
- может ли endpoint в dev-стенде вернуть доменную ошибку;
- какие 5xx считаются багом.

Нельзя считать тест пройденным только потому, что endpoint вернул `401`.  
Если endpoint защищённый, `401/403` без сессии может быть нормой. Но после успешной авторизации он должен проходить дальше и возвращать ожидаемый доменный результат, а не неожиданный 5xx.

## Что делать с endpoint-ами, которым нужны реальные payment flows

Для покупок/продлений/платежей нельзя дергать реальные платежные системы.

Нужно:

- использовать Remnashop dev/mock payment provider, если он есть;
- либо настроить локальный fake provider на уровне devcontainer;
- либо проверять controlled domain error, если payment gateway в dev-стенде отсутствует.

Важно: если endpoint в dev-стенде должен быть работоспособен, нужно настроить mock.  
Если по архитектуре он не может быть полностью пройден локально, это должно быть явно описано и протестировано как ожидаемое ограничение, а не случайный 500.

## Требования к readiness

Readiness endpoint должен реально отражать состояние стенда.

Проверить, что readiness покрывает:

- Clean Pay процесс жив;
- PostgreSQL Clean Pay доступен;
- Redis Clean Pay доступен;
- Remnashop API доступен;
- возможно, Remnashop readiness/health доступен;
- Mailpit доступен, если email features включены;
- Telegram OIDC mock доступен, если Telegram login включён;
- Remnawave mock доступен, если Remnashop зависит от него.

Если readiness сейчас проверяет не всё, предложить корректное улучшение.  
Но не добавлять production-зависимости бездумно: dev-only проверки должны быть управляемы env/config.

## Требования к логам и диагностике

Full-stack тесты должны при падении выводить:

- какой шаг упал;
- HTTP method и URL;
- status;
- response body;
- upstream debug, если есть;
- последние логи `app`;
- последние логи `remnashop`;
- последние логи `remnashop-worker`;
- последние логи `smtp`;
- последние логи `telegram-oidc-mock`.

Нужно сделать так, чтобы при ошибке вроде:

```text
Email delivery is not configured
```

сразу было понятно:

- Clean Pay ли виноват;
- Remnashop ли виноват;
- SMTP ли недоступен;
- env ли не применился;
- БД/кеш ли сохранили неправильное состояние.

## Команды package.json

Добавить или привести к виду:

```json
{
  "test": "vitest run",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:e2e:devcontainer": "bash scripts/e2e-devcontainer.sh",
  "test:e2e": "bash scripts/e2e-devcontainer.sh"
}
```

Если используется другой runner для e2e, выбрать обоснованно.  
Главное: команда должна поднимать стенд и гонять реальные HTTP-проверки.

## Как должен работать e2e script

Скрипт должен:

1. Проверить наличие Docker.
2. Проверить наличие Docker Compose.
3. Поднять dev compose project.
4. Дождаться healthcheck-ов.
5. Выполнить `npm ci`, если нужно.
6. Выполнить `prisma generate`.
7. Выполнить миграции Clean Pay.
8. Запустить Next.js на `0.0.0.0:4000`.
9. Дождаться `/api/health`.
10. Запустить full-stack тесты.
11. При падении вывести диагностику.
12. Не удалять volumes автоматически без явной опции.
13. Иметь опцию clean reset, например:

```bash
RESET_E2E=1 npm run test:e2e:devcontainer
```

При `RESET_E2E=1` можно удалять только dev volumes конкретного compose project, а не глобальные Docker resources.

## Нельзя делать опасные действия

Запрещено:

```bash
docker system prune -a
docker volume prune
rm -rf ..
chmod -R 777 .
chown -R на весь проект
```

Разрешено удалять только явно именованные dev volumes проекта, например:

```text
clean-pay-dev_node-modules
clean-pay-dev_postgres-data
clean-pay-dev_redis-data
clean-pay-dev_remnashop-postgres-data
clean-pay-dev_remnashop-cache-data
```

И только если это явно запрошено через reset-флаг.

## Критерии готовности

Работа считается выполненной, если:

1. Текущие псевдо-интеграционные тесты классифицированы и не выдают себя за full-stack.
2. Добавлен настоящий full-stack/e2e слой.
3. Full-stack тесты поднимают devcontainer compose.
4. Тесты проверяют реальный HTTP Next.js.
5. Тесты проверяют реальный Remnashop API.
6. Тесты проверяют PostgreSQL/Redis.
7. Тесты проверяют Telegram OIDC через локальный mock.
8. Тесты проверяют email verification через Remnashop и Mailpit.
9. Ошибка `Email delivery is not configured` либо исправлена в devcontainer-конфиге, либо тест стабильно воспроизводит её с понятной диагностикой.
10. Production-приложение не адаптировано под тесты.
11. Все реальные bugfix-ы в `src/**`, если они были, обоснованы.
12. `npm run test:e2e:devcontainer` можно запустить на чистой машине с Docker.
13. В README или отдельном dev-документе описано, как запускать стенд и тесты.

## Итоговый ожидаемый результат

Нужно получить не просто зелёные тесты, а проверяемую локальную систему:

```text
docker compose dev stack
  -> real Next.js app
  -> real Clean Pay BFF
  -> real Remnashop dev service
  -> real local databases/caches
  -> local Telegram OIDC mock
  -> local SMTP/Mailpit
  -> endpoint matrix tests
```

Главный принцип:

**Тесты должны проверять реальную систему. Если система падает — исправлять систему или dev-стенд, а не подгонять приложение под тесты.**
