# Clean Pay

Clean Pay — веб-кабинет для оплаты и управления подписками
Remnashop/Remnawave. Пользователь может войти по e-mail, Telegram или Passkey,
купить и продлить подписку, управлять устройствами и посмотреть историю
платежей. Авторизованным пользователям также доступен чат поддержки, если
владелец сервиса включил интеграцию Chatwoot.

Production-запуск использует Docker Compose, собственные PostgreSQL и Redis.
Установщик проверяет окружение и Remnashop, применяет миграции отдельным
одноразовым контейнером и только после этого запускает приложение и workers.

## Интерфейс

<p align="center">
  <a href="docs/screenshots/dashboard.png">
    <img src="docs/screenshots/dashboard.png" alt="Личный кабинет Clean Pay" width="100%">
  </a>
</p>
<p align="center">
  <sub>Личный кабинет: подписка, устройства, трафик и платежи.</sub>
</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/screenshots/login.png">
        <img src="docs/screenshots/login.png" alt="Вход в Clean Pay по e-mail или через Telegram">
      </a>
    </td>
    <td width="50%" valign="top">
      <a href="docs/screenshots/authentication-methods.png">
        <img src="docs/screenshots/authentication-methods.png" alt="Настройка способов входа в Clean Pay">
      </a>
    </td>
  </tr>
  <tr>
    <td align="center"><sub>Вход по e-mail или через Telegram.</sub></td>
    <td align="center"><sub>E-mail, Telegram и быстрый вход.</sub></td>
  </tr>
</table>

## Установка: один мастер, три этапа

### 1. Подготовьте сервер и интеграции

Нужны:

- Linux-сервер с Docker Engine, Docker Compose v2, `git`, `curl` и `openssl`;
- не менее 8 ГиБ свободного места и `vm.overcommit_memory=1` на хосте Docker;
- Remnashop на том же Docker daemon и доступный Remnawave;
- домен Clean Pay, DNS и HTTPS reverse proxy;
- токены Remnashop, Remnawave и Telegram, а также ключи Cloudflare Turnstile.

Node.js на сервере необязателен: при его отсутствии установщик использует
изолированный tooling-контейнер. Если Node.js уже установлен, его версия должна
совпадать с [`.node-version`](.node-version).

Для новой установки сначала обновите Remnashop минимум до Alembic revision
`0059`. Его API, worker и scheduler должны работать из одного image. Clean Pay
не запускает миграции чужого проекта — он только проверяет image, схему и
API-контракт перед собственным запуском.

Пример минимального Caddyfile:

```caddyfile
pay.example.com {
    reverse_proxy 127.0.0.1:4000
}
```

До запуска Clean Pay reverse proxy может временно отвечать `502`; сертификат,
маршрут и внешний HTTPS должны быть готовы до подтверждения соответствующего
вопроса мастера.

### 2. Получите проверенную версию

Production запускается из зафиксированного тега, а не из меняющейся вершины
ветки.

```bash
RELEASE_REF='refs/tags/v0.2.0'
sudo mkdir -p /opt/clean-pay
sudo chown "$USER":"$USER" /opt/clean-pay
git clone https://github.com/flake92/clean-pay.git /opt/clean-pay
cd /opt/clean-pay
git fetch --depth=1 origin "$RELEASE_REF"
RELEASE_SHA=$(git rev-parse FETCH_HEAD)
test -n "$RELEASE_SHA"
git checkout --detach "$RELEASE_SHA"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git status --porcelain --untracked-files=all)"
printf 'Deploying commit %s\n' "$RELEASE_SHA"
```

Сохраните выведенный SHA в журнале выпуска.

### 3. Запустите мастер

```bash
./deploy.sh setup
```

Мастер проводит через три внутренних этапа:

1. создаёт защищённый `deploy/prod/.env`, спрашивает обязательные адреса и
   токены и генерирует внутренние секреты;
2. проверяет готовый `deploy/prod/docker-compose.yml` и Docker-сеть;
3. собирает и проверяет образы, применяет миграции и запускает сервисы.

Писать YAML вручную не требуется. На первом запуске мастер намеренно сделает
паузу после настройки:

1. в приватном редакторе скопируйте значение `REMNASHOP_AUTH_SERVICE_KEY` из
   `deploy/prod/.env` в `APP_AUTH_SERVICE_KEY` файла `.env` Remnashop;
2. штатным способом Remnashop перезапустите его API, worker и scheduler из
   одного image;
3. вернитесь в мастер и подтвердите Remnashop и готовность внешнего HTTPS.

Если ответить «нет», ничего не разворачивается: настройки сохраняются, а после
подготовки зависимостей установка продолжается командой:

```bash
./deploy.sh install
```

Успешный `install` сам проверяет внутреннюю readiness, внешний HTTPS, HSTS и
CSP. Дополнительно проверьте вход, создание платежа и выдачу подписки:

```bash
./deploy.sh ps
curl -f https://pay.example.com/api/health/liveness
curl -f https://pay.example.com/api/health/readiness
```

Этапы можно запускать отдельно:

```bash
./deploy.sh configure
./deploy.sh compose
./deploy.sh install
```

Полный список переменных с комментариями находится в
[`deploy/prod/.env.example`](deploy/prod/.env.example). Основной
`deploy/prod/.env` должен оставаться обычным файлом владельца с правами `0600`.
Сгенерированные `.env.app`, `.env.migration`, `.env.provision` и файлы workers
не редактируйте вручную.

## Обновление

Для любого production-обновления действуют три обязательных этапа:

1. зафиксировать текущий commit и image, сделать и проверить резервные копии
   базы и `deploy/prod/.env`;
2. получить точный проверенный commit и выполнить `./deploy.sh build`, пока
   текущая версия ещё обслуживает пользователей;
3. в согласованное maintenance window выполнить `./deploy.sh install`, затем
   проверить status, readiness, вход, платёж и подписку.

`install` сохраняет Docker volumes, но временно останавливает приложение и
workers. Если миграция завершается ошибкой, runtime остаётся остановленным —
это защита от запуска старого кода поверх новой или частично изменённой схемы.
Никогда не используйте `docker compose down -v` при обновлении.

### Обычное обновление `0.2.x`

```bash
cd /opt/clean-pay
RELEASE_REF='refs/tags/v0.2.1'
git fetch --depth=1 origin "$RELEASE_REF"
RELEASE_SHA=$(git rev-parse FETCH_HEAD)
git checkout --detach "$RELEASE_SHA"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git status --porcelain --untracked-files=all)"
./deploy.sh build
./deploy.sh install
./deploy.sh ps
```

Замените пример тега на реально опубликованный и проверенный релиз. Не
переключайте production на неизвестный commit только потому, что он последний.

### Прямое обновление `0.1.1` → `0.2.0`

Этот переход поддерживается отдельно. В `0.1.1` было 16 успешных Prisma
миграций, в `0.2.0` — 22. PostgreSQL обновляется с 17.10 до 17.11 на том же
volume и с сохранением существующей locale; база не пересоздаётся.

До maintenance window:

1. сохраните зашифрованную копию исходного `.env`, точный commit и image
   `0.1.1`;
2. переключите checkout на проверенный commit `0.2.0`, не заменяя существующий
   `deploy/prod/.env` примером;
3. подготовьте конфигурацию с реальными origin и заранее соберите образы:

```bash
./deploy.sh prepare-v0.1.1-upgrade \
  'https://sub.example.com' \
  'https://pay.example.com'
./deploy.sh build
```

Первый аргумент — точные HTTPS origins ссылок подписки Remnawave, второй —
точные HTTPS origins платёжных шлюзов. Можно передать несколько значений через
запятую. Команда сохраняет существующие секреты, создаёт отдельные роли БД и
оставляет очистку платёжных данных выключенной до отдельного решения.

Обновите Remnashop минимум до revision `0059`. Эта миграция исправляет DB-trigger,
чтобы первое успешное подтверждение e-mail могло атомарно сохранить включённые
по умолчанию напоминания. Существующие настройки она не переписывает: явный
opt-out остаётся выключенным, а неподтверждённые адреса не получают напоминания.

Во время maintenance window остановите writers, сделайте schema-scoped backup
PostgreSQL и проверьте его checksum и список объектов по
[`production-migration-runbook.md`](docs/production-migration-runbook.md).
Только после подтверждённой резервной копии атомарно разрешите однократное
принятие существующей базы и запустите обновление:

```bash
./deploy.sh authorize-existing-database --confirm-verified-backup
./deploy.sh install
./deploy.sh ps
```

Установщик сверяет точную исходную схему, создаёт ограниченные роли, доводит
журнал до 22 успешно применённых миграций и автоматически сбрасывает оба
одноразовых флага принятия базы до старта runtime. Частично выставленные флаги
отклоняются.

Мастер обновления записывает `REMNASHOP_MINIMUM_ALEMBIC_REVISION=0059`, а
preflight не позволит запустить Clean Pay с более старой схемой Remnashop.
Revision `0059` не выполняет data backfill и не меняет существующие значения
переключателя. Новое подтверждение e-mail получает default-on, повторный вход
уже подтверждённого пользователя сохраняет его предыдущий выбор.

Детальная процедура backup, миграции, проверки и восстановления:
[`docs/production-migration-runbook.md`](docs/production-migration-runbook.md).

## Поддержка через Chatwoot

Chatwoot необязателен. Чтобы включить чат для авторизованных пользователей,
создайте Website Inbox, разрешите домен Clean Pay, включите Identity Validation
и задайте все три переменные:

```dotenv
CHATWOOT_BASE_URL=https://chat.example.com
CHATWOOT_WEBSITE_TOKEN=<website-token>
CHATWOOT_HMAC_TOKEN=<identity-validation-hmac-token>
```

После изменения выполните `./deploy.sh install`. Если настройки полные, кнопка
показывается авторизованному пользователю сразу: нажатие во время безопасной
проверки контакта запоминается, и чат открывается один раз после её успешного
завершения. Ошибка проверки переводит кнопку в недоступное состояние и не
открывает неподтверждённый диалог. Недоступность Chatwoot не останавливает
кабинет и поэтому не входит в основную readiness-проверку.

Надпись Chatwoot внутри его cross-origin iframe управляется самим Chatwoot.
Для white-label используйте поддерживаемую настройку внешнего сервиса, а не
изменение DOM Clean Pay. Полная настройка, атрибуты и диагностика:
[`docs/chatwoot-support.md`](docs/chatwoot-support.md).

## Управление и диагностика

| Команда | Назначение |
| --- | --- |
| `./deploy.sh ps` | показать состояние контейнеров |
| `./deploy.sh logs` | показать и продолжить вывод логов |
| `./deploy.sh build` | подготовить образы без остановки runtime и миграции БД |
| `./deploy.sh install` | проверить зависимости, мигрировать и запустить |
| `./deploy.sh restart` | безопасно применить изменённые runtime credentials |
| `./deploy.sh down` | остановить контейнеры без удаления данных |

Частые причины остановки установщика:

- **Remnashop не готов:** проверьте путь и права его `.env`, одинаковый image у
  API/worker/scheduler и требуемую Alembic revision;
- **неверный payment origin:** `PAYMENT_REDIRECT_ORIGINS` обязателен и содержит
  только точные публичные HTTPS origins без пути;
- **внешний healthcheck не проходит:** сначала исправьте DNS, сертификат и
  reverse proxy; Clean Pay слушает только loopback-интерфейс на порту `4000`;
- **миграция упала:** не запускайте старую версию поверх изменённой схемы и не
  помечайте миграцию вручную; используйте проверенную процедуру из runbook;
- **после сбоя остался operation lock:** сначала докажите, что другой deploy
  действительно не выполняется, и только затем следуйте инструкции
  восстановления в [`docs/deployment-safety.md`](docs/deployment-safety.md).

## Разработка

Локальные проверки выполняются до запуска CI:

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --maxWorkers=4
npm run build
```

Для production используется только `prisma migrate deploy` внутри отдельного
migration image. Не применяйте к production `prisma migrate dev` или
`prisma db push`.

## Документация

- [Безопасность deployment и образов](docs/deployment-safety.md)
- [Production migration runbook](docs/production-migration-runbook.md)
- [Изоляция ролей и credentials БД](docs/production-role-environments.md)
- [Настройка Chatwoot](docs/chatwoot-support.md)
- [Напоминания об окончании подписки](docs/email-expiration-reminders-design.md)
- [Политика хранения платёжных данных](docs/payment-data-retention.md)
- [Архитектура](docs/ARCHITECTURE.md)

Лицензия: [AGPL-3.0-only](LICENSE).
