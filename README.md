# Clean Pay

Clean Pay — веб-кабинет для оплаты и управления подписками Remnashop/Remnawave.
Пользователь может войти по e-mail, Telegram или Passkey, купить и продлить
подписку, управлять устройствами, посмотреть историю платежей и обратиться в
поддержку через авторизованный виджет Chatwoot.

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
| Website Token и HMAC Token Chatwoot | Необязательно; настройки Website Inbox и Identity Validation |
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
3. **Установка.** Мастер подготавливает образы, применяет
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

## Отдельный запуск этапов

Если автоматический мастер не нужен, этапы можно выполнить отдельно:

```bash
./deploy.sh configure  # интерактивно заполнить .env
./deploy.sh compose    # проверить .env, Compose и сеть
./deploy.sh install    # подготовить, запустить и проверить сервисы
```

Для полностью ручной настройки используйте `./deploy.sh init`, затем откройте
`deploy/prod/.env` в своём редакторе.

Команда `./deploy.sh up` сохранена как совместимый псевдоним `install`.

Формат `.env` простой: одна строка `NAME=value`, комментарии только на
отдельных строках. Не используйте `${NAME}`, inline-комментарии, дублирующиеся
имена и многострочные значения. Полный перечень настроек находится в
[`deploy/prod/.env.example`](deploy/prod/.env.example).

### Сборка на сервере или готовые образы

По умолчанию `CLEAN_PAY_DEPLOY_SOURCE=build`: сервер собирает оба Docker target
из текущего checkout — `runner` для приложения и `migration` для
`prisma migrate deploy`. `CLEAN_PAY_IMAGE` и `CLEAN_PAY_MIGRATION_IMAGE` должны
быть разными явными тегами без digest. Для трассируемой локальной сборки также
задайте одинаковые для обоих target `CLEAN_PAY_RELEASE` и
`CLEAN_PAY_REVISION`; значения `local` допустимы только для режима `build`.

Чтобы сервер только скачивал заранее проверенный release, укажите в `.env`:

```dotenv
CLEAN_PAY_DEPLOY_SOURCE=pull
CLEAN_PAY_IMAGE=ghcr.io/owner/clean-pay-app@sha256:<64-hex-digest>
CLEAN_PAY_MIGRATION_IMAGE=ghcr.io/owner/clean-pay-migration@sha256:<64-hex-digest>
CLEAN_PAY_RELEASE=<release из GitHub Actions summary>
CLEAN_PAY_REVISION=<полный 40-символьный Git SHA из того же summary>
```

Замените оба digest фактическими значениями двух target одного проверенного
commit. В режиме `pull` теги (`latest`, `v1` и подобные), пустые значения,
совпадающие digest даже в разных repositories и ссылки без `@sha256:`
отклоняются до обращения к Docker.
После `docker login` для закрытого registry команда `./deploy.sh install`
выполняет `pull` и запускает Compose с `--no-build`; установщик не принимает и
не сохраняет registry credentials.

Перед миграцией общий fail-closed preflight проверяет роли образов, совпадение
release/revision, а также baked URL, название и логотип приложения с
авторитетным `.env`. Затем валидатор из app image запускается с `--network none`
без PostgreSQL, Redis и других Compose-зависимостей. Для режима `pull` образы с
метаданными `local`/`unknown` не принимаются.

Workflow **Publish paired Clean Pay images** запускается вручную в GitHub
Actions. Он принимает release и публичные build-time настройки, собирает оба
target строго из одного `github.sha`, публикует их в GHCR и выводит готовую пару
digest-pinned ссылок в job summary. Для публикации используется только штатный
`GITHUB_TOKEN` с ограничением `packages: write`.

Точная модель доверия к образам, порядок миграции и восстановление после её
ошибки описаны в
[`docs/deployment-safety.md`](docs/deployment-safety.md).

Штатный `install` использует короткое maintenance window и не является
zero-downtime командой. Для текущей одно-репличной production-топологии с Caddy
используйте отдельный guarded canary flow из
[`deploy/prod/zero-downtime-production-runbook.md`](deploy/prod/zero-downtime-production-runbook.md):
он оставляет старый app запущенным до полной readiness canary, запрещает pending
миграции и требует явных атомарных переключений reverse proxy.

## Поддержка через Chatwoot

Интеграция необязательна и по умолчанию отключена. Она использует стандартный
Chatwoot Website Widget без дополнительных npm-пакетов, миграций, webhooks или
изменений самого Chatwoot. Кнопка чата появляется только после авторизации в
Clean Pay; на страницах входа и у гостя виджет скрыт.

### Настройка Chatwoot

1. В Chatwoot создайте или откройте **Settings → Inboxes → Website**.
2. Добавьте публичный домен Clean Pay в **Allowed Domains**, например
   `pay.example.com`.
3. Включите **Identity Validation** и скопируйте **Website Token** и
   **HMAC Token**.
4. В **Settings → Custom Attributes → Contact** создайте текстовые атрибуты:

   - `clean_pay_user_id`, `telegram_id`, `telegram_username`;
   - `subscription_context_status`, `subscription_plan`,
     `subscription_status`, `subscription_expires_at`,
     `subscription_is_trial`;
   - `payment_context_status`, `last_payment_status`, `last_payment_at`,
     `last_payment_amount`, `last_payment_gateway`, `last_payment_plan`,
     `recent_payments`.

   Chatwoot принимает их и без предварительного создания, но объявленные
   атрибуты удобнее видеть, фильтровать и использовать в автоматизациях.
5. В **Settings → Labels** создайте labels `payment_problem` и
   `subscription_expired`. Clean Pay автоматически добавляет либо снимает их у
   диалога по актуальному контексту.

Затем заполните все три переменные в `deploy/prod/.env`:

```dotenv
CHATWOOT_BASE_URL=https://chat.example.com
CHATWOOT_WEBSITE_TOKEN=<website-token>
CHATWOOT_HMAC_TOKEN=<identity-validation-hmac-token>
```

`CHATWOOT_BASE_URL` должен быть HTTPS origin без пути, query string и fragment.
Все три переменные задаются вместе; если оставить их пустыми, интеграция
останется отключённой. `CHATWOOT_HMAC_TOKEN` — серверный секрет: не добавляйте
к нему префикс `NEXT_PUBLIC_`, не публикуйте его и не используйте как другой
секрет Clean Pay.

Интерактивный мастер не запрашивает необязательные параметры Chatwoot. После
`./deploy.sh configure` выберите открытие расширенных настроек либо отредактируйте
`deploy/prod/.env` вручную, затем примените конфигурацию:

```bash
./deploy.sh install
```

Production-валидатор проверит комплектность, HTTPS origin, формат токенов и
отсутствие повторного использования HMAC-секрета. Clean Pay автоматически
добавит origin Chatwoot в CSP; отдельно ослаблять security headers не нужно.

### Данные и безопасность

Clean Pay передаёт агенту неизменяемый внутренний ID, имя, подтверждённый
e-mail, Telegram ID, Telegram username, тариф, состояние и срок подписки, а
также безопасную сводку пяти последних синхронизированных платежей.
HMAC-SHA256 вычисляется на сервере:
браузер получает только готовую подпись идентификатора, но никогда не получает
`CHATWOOT_HMAC_TOKEN`. Неподтверждённый e-mail намеренно не отправляется,
поскольку Chatwoot может объединять контакты по адресу почты.

Label `subscription_expired` включается, если текущая подписка имеет статус
`EXPIRED` либо её дата окончания уже прошла. Label `payment_problem`
включается, если последний платёж завершился ошибкой/отменой, имеет неизвестный
статус либо остаётся `PENDING` не менее 30 минут. Успешный следующий платёж
снимает прежний label. Если источник временно недоступен, Clean Pay показывает
`*_context_status=unavailable`, но не снимает label на основании неполных
данных. Некорректная дата подписки помечается
`subscription_context_status=invalid` и также не изменяет
`subscription_expired`. Для платежей проверяется время успешной синхронизации:
снимок старше 15 минут получает `payment_context_status=stale` и не изменяет
`payment_problem`.

Контекст загружается в фоне и кешируется в браузере на одну минуту, поэтому
сбой Remnashop или истории платежей не задерживает интерфейс и не отключает
базовый чат. VPN URL, платёжные URL, сырые ответы провайдеров и секреты в
Chatwoot не передаются.

При открытии чата Clean Pay повторно проверяет кеш и загружает свежий контекст,
если прошла минута. Идентификатор, HMAC и все custom attributes отправляются
одной подписанной командой `setUser`. Labels повторно применяются после первого
сообщения, когда новый диалог уже создан в Chatwoot.

При выходе из Clean Pay сессия, cookies и локальное состояние Chatwoot
сбрасываются до завершения локальной сессии. Гостевые страницы повторяют
очистку на случай истечения сессии или незавершённой загрузки SDK, чтобы
следующий пользователь не увидел чужую историю.

После установки войдите, отправьте тестовое сообщение и проверьте контакт в
Chatwoot. Затем выйдите и войдите под другим тестовым пользователем: кнопка
должна исчезнуть на странице входа, а второй пользователь должен получить
отдельный контакт и историю. Подробная настройка и полный чек-лист находятся в
[`docs/chatwoot-support.md`](docs/chatwoot-support.md).

Для первого этапа маршрутизацию и автоматические ответы удобно настроить
штатными Automation Rules Chatwoot по labels `payment_problem` и
`subscription_expired`: событие **Conversation Updated**, условия **Labels
contains** и **Team is not**, действия **Assign team** и при необходимости
**Send message**. Проверка текущей команды предотвращает повторное срабатывание
после назначения и автоматического ответа. Webhooks и доступ Chatwoot к
управляющим операциям Clean Pay для этого не требуются.

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
./deploy.sh install    # подготовка образов и обновление после резервной копии
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
release Remnashop, собирайте API, worker и scheduler из одного checkout на
точном immutable commit PR #135, закреплённом в CI, с полной цепочкой миграций
через `0058`. Не смешивайте роли из разных образов или ревизий.

Remnashop также остаётся единственным владельцем SMTP и очереди напоминаний об
окончании подписки. В нём задаются
`EMAIL_SUBSCRIPTION_EXPIRATION_CABINET_URL`, SMTP-параметры и независимый
fail-closed переключатель
`EMAIL_SUBSCRIPTION_EXPIRATION_REMINDERS_ENABLED`. Clean Pay только показывает
пользователю opt-in/opt-out в профиле; настройка по умолчанию выключена, не
проводит оплату и не включает автопродление. Порядок безопасного включения
описан в
[`docs/production-migration-runbook.md`](docs/production-migration-runbook.md).

Фоновая сверка платежей включается переменной
`PAYMENT_RECONCILIATION_ENABLED=true`. Если установленная версия Remnashop не
поддерживает admin recovery contract, временно отключите её. После успешного
развёртывания установщик безопасно проверяет Remnashop и отключает legacy
payment rollout gate. При несовместимой версии или выполняющихся платёжных
операциях установка остановится без открытия gate.

Переходы на платёжную страницу разрешаются только на точные HTTPS origins из
`PAYMENT_REDIRECT_ORIGINS`. Значения указываются через запятую без пути,
wildcard, query, fragment и URL credentials; при подключении нового шлюза его
реальный production origin нужно подтвердить до включения в список. Если
переменная не задана, используется закрытый production default только для
двух проверенных шлюзов из production-примера; это сохраняет безопасный
zero-downtime rollback на предыдущий образ.

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
| Не появился Chatwoot | Заполнены ли все три `CHATWOOT_*`, разрешён ли домен Clean Pay в Website Inbox, включена ли Identity Validation |
| Chatwoot отклоняет пользователя | Совпадают ли Website/HMAC Token с выбранным Inbox; после смены токенов перезапустите Clean Pay и войдите снова |
| Ошибка CSP у Chatwoot | Указан ли `CHATWOOT_BASE_URL` как HTTPS origin без пути и доступен ли он из браузера |
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

Локальный full-stack E2E контракта `0058` запускайте с
`REMNASHOP_HOST_SOURCE`, указывающим на проверенный checkout PR #135. В CI
workflow checkout'ит тот же точный immutable commit со встроенной реализацией
напоминаний; локальный overlay больше не используется.

CI дополнительно выполняет:

- проверку shell-скриптов и production Compose;
- тесты с реальной PostgreSQL и миграциями;
- полный Docker E2E пользовательского сценария;
- `npm audit`, gitleaks, CodeQL, SBOM и Trivy scan production-образа.

Workflow находится в [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Документация

- [Архитектура](docs/ARCHITECTURE.md)
- [Поддержка через Chatwoot](docs/chatwoot-support.md)
- [Production migration runbook](docs/production-migration-runbook.md)
- [Security audit](docs/production-security-audit.md)
- [Payment recovery design](docs/payment-idempotency-recovery-design.md)

Лицензия: `AGPL-3.0-only`.
