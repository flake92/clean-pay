# Clean Pay

Clean Pay — веб-кабинет для оплаты и управления подписками Remnashop/Remnawave.
Пользователь может войти по e-mail, Telegram или Passkey, купить и продлить
подписку, управлять устройствами и посмотреть историю платежей.

Приложение запускается в Docker Compose вместе с собственными PostgreSQL и
Redis. Node.js на сервер устанавливать не нужно.

![Личный кабинет Clean Pay](docs/screenshots/dashboard.png)

## Что потребуется

- Linux-сервер с Docker Engine и Docker Compose v2;
- работающие Remnashop и Remnawave;
- домен с настроенным HTTPS reverse proxy;
- `git` и `openssl`;
- значения из таблицы ниже.

| Что подготовить | Где взять |
| --- | --- |
| Публичный адрес Clean Pay | Например, `https://pay.example.com` |
| URL и `APP_API_KEY` Remnashop | Конфигурация Remnashop |
| URL и API-токен Remnawave | Панель Remnawave |
| Bot token и OIDC client secret | Настройки Telegram-бота |
| Site key и secret key Turnstile | Cloudflare Turnstile |
| Docker-сеть reverse proxy | Обычно `remnawave-network` |

## Установка: один мастер, три этапа

```bash
sudo mkdir -p /opt/clean-pay
sudo chown "$USER":"$USER" /opt/clean-pay
git clone https://github.com/flake92/clean-pay.git /opt/clean-pay
cd /opt/clean-pay
./deploy.sh
```

Без аргументов `deploy.sh` запускает понятный интерактивный мастер:

1. **Настройка `.env`.** Мастер задаёт только необходимые вопросы, скрывает
   ввод секретов и автоматически генерирует пароль PostgreSQL и внутренние
   ключи Clean Pay.
2. **Подготовка Docker Compose.** Готовый файл
   `deploy/prod/docker-compose.yml` поставляется с проектом. Мастер проверяет
   его вместе с `.env` и создаёт отсутствующую Docker-сеть. Писать YAML вручную
   не требуется.
3. **Установка.** Мастер проверяет свободное место, собирает образы, применяет
   миграции, запускает сервисы и проверяет контейнеры, внешние зависимости,
   HTTPS и security headers.

В конце мастер покажет адрес приложения и команды диагностики. Повторный запуск
безопасен: существующие секреты сохраняются, Docker volumes не удаляются.

### Важный шаг для Remnashop

При первой настройке Clean Pay автоматически создаёт отдельный
`REMNASHOP_AUTH_SERVICE_KEY`. Скопируйте его значение из
`deploy/prod/.env` в `.env` Remnashop:

```dotenv
WEB_ENABLED=true
WEB_CABINET_URL=https://pay.example.com/auth/telegram/webapp
APP_API_KEY=<то же значение, что REMNASHOP_API_KEY в Clean Pay>
APP_AUTH_SERVICE_KEY=<то же значение, что REMNASHOP_AUTH_SERVICE_KEY в Clean Pay>
```

После изменения перезапустите HTTP-сервис, worker и scheduler Remnashop. Не
публикуйте `APP_AUTH_SERVICE_KEY` и не используйте вместо него admin API key.

### Тестовый стенд

Для тестового стенда создайте отдельный Turnstile widget, привязанный к его
домену. Публичный production-запуск намеренно отклоняет общеизвестные тестовые
ключи Cloudflare, чтобы защиту нельзя было случайно оставить выключенной.

## Отдельный запуск этапов

Если автоматический мастер не нужен, этапы можно выполнить отдельно:

```bash
./deploy.sh configure  # интерактивно заполнить .env
./deploy.sh compose    # проверить .env, Compose и сеть
./deploy.sh install    # собрать, запустить и проверить стенд
```

Для полностью ручной настройки используйте `./deploy.sh init`, затем откройте
`deploy/prod/.env` в своём редакторе.

Команда `./deploy.sh up` сохранена как совместимый псевдоним `install`.

Формат `.env` простой: одна строка `NAME=value`, комментарии только на
отдельных строках. Не используйте `${NAME}`, inline-комментарии, дублирующиеся
имена и многострочные значения. Полный перечень настроек находится в
[`deploy/prod/.env.example`](deploy/prod/.env.example).

## Reverse proxy

По умолчанию приложение доступно только на `127.0.0.1:4000`. Если reverse proxy
работает на хосте, направьте его туда. Если он подключён к Docker-сети из
`CLEAN_PAY_EDGE_NETWORK`, используйте адрес `clean-pay:4000`.

Минимальный пример Caddy:

```caddyfile
pay.example.com {
    encode gzip zstd
    header Strict-Transport-Security "max-age=31536000; includeSubDomains"
    reverse_proxy 127.0.0.1:4000
}
```

HTTPS-терминатор обязан выставлять HSTS минимум на один год. Остальные security
headers, включая nonce-based CSP, добавляет Clean Pay.

## Управление

```bash
./deploy.sh ps         # состояние контейнеров
./deploy.sh logs       # логи, выход — Ctrl+C
./deploy.sh restart    # перезапуск контейнеров
./deploy.sh install    # пересборка и безопасное обновление
./deploy.sh down       # остановка без удаления данных
```

Не запускайте `docker compose down -v`, `docker volume prune` или
`docker system prune --volumes`, если данные нужно сохранить.

## Обновление

Перед обновлением сохраните конфигурацию и базу:

```bash
cd /opt/clean-pay
cp -p deploy/prod/.env "deploy/prod/.env.backup-$(date +%Y%m%d-%H%M%S)"
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml \
  exec -T postgres sh -ec 'exec pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  > "clean-pay-$(date +%Y%m%d-%H%M%S).dump"
git pull --ff-only
./deploy.sh install
```

Установщик применяет только `prisma migrate deploy`, ждёт healthcheck и не
удаляет volumes. Расширенный порядок обновления и восстановления описан в
[`docs/production-migration-runbook.md`](docs/production-migration-runbook.md).

## Совместимость Remnashop

Clean Pay использует generic e-mail auth, service-session, объединение аккаунтов
и восстановление статуса платежей. Пока эти контракты не вошли в официальный
release Remnashop, используйте проверенную revision `1262f98` ветки
`flake92/remnashop:update-nodejs`.

Фоновая сверка платежей включается переменной
`PAYMENT_RECONCILIATION_ENABLED=true`. Если установленная версия Remnashop не
поддерживает admin recovery contract, временно отключите её. После успешного
развёртывания установщик безопасно проверяет Remnashop и отключает legacy
payment rollout gate. При несовместимой версии или выполняющихся платёжных
операциях установка остановится без открытия gate.

## Проверка и частые ошибки

```bash
./deploy.sh ps
curl -f https://pay.example.com/api/health/liveness
curl -f https://pay.example.com/api/health/readiness
./deploy.sh logs
```

| Симптом | Что проверить |
| --- | --- |
| `502` | Запущен ли `app`, правильный ли upstream у reverse proxy |
| Remnashop `degraded` | URL API, оба service/admin ключа, совместимую revision |
| Remnawave `degraded` | HTTPS URL, API-токен и доступность панели |
| Не работает Telegram | Bot ID, bot token, OIDC secret и callback текущего домена |
| Не приходит e-mail | SMTP в Remnashop и состояние его worker/scheduler |
| Ошибка security headers | HSTS и проксирование реального HTTPS origin |
| Не хватает диска | Освободите место; установщик требует минимум 8 ГБ |

Установщик может очистить только неиспользуемый Docker build cache и висячие
образы. Базы данных и volumes он не удаляет.

## Разработка и CI

Поддерживается Node.js из `.node-version` и только npm с фиксированным
`package-lock.json`.

```bash
npm ci
npm run lint
npm run typecheck
npm run test:architecture
npm run test:route-handlers
npm run test:coverage
npm run test:coverage:frontend
npm run build
```

CI дополнительно выполняет:

- проверку shell-скриптов и production Compose;
- тесты с реальной PostgreSQL и миграциями;
- полный Docker E2E пользовательского сценария;
- `npm audit`, gitleaks, CodeQL, SBOM и Trivy scan production-образа.

Workflow находится в [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Документация

- [Архитектура](docs/ARCHITECTURE.md)
- [Production migration runbook](docs/production-migration-runbook.md)
- [Security audit](docs/production-security-audit.md)
- [Payment recovery design](docs/payment-idempotency-recovery-design.md)

Лицензия: `AGPL-3.0-only`.
