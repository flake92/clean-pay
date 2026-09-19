# Clean Pay

Clean Pay — веб-кабинет для оплаты и управления подписками Remnashop/Remnawave.
Пользователь может войти по e-mail, Telegram или Passkey, купить и продлить
подписку, управлять устройствами и посмотреть историю платежей. Если настроена
необязательная интеграция поддержки, авторизованному пользователю также
доступен чат.

Production-окружение запускается в Docker Compose вместе с собственными
PostgreSQL и Redis. Установщик выполняет проверки локального Remnashop,
применяет миграции отдельным одноразовым контейнером и запускает приложение,
worker сверки платежей и worker очистки данных.

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

## Что потребуется

- Linux-сервер с Docker Engine и Docker Compose v2;
- Node.js точной версии из [`.node-version`](.node-version) (сейчас `24.18.0`),
  `git`, `openssl` и `curl`;
- не менее 8 ГиБ свободного места в файловой системе checkout перед сборкой;
- `vm.overcommit_memory=1` на хосте выбранного Docker daemon;
- работающий Remnashop на том же Docker daemon и доступный Remnawave;
- домен с настроенным HTTPS reverse proxy;
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

Штатный `deploy.sh` проверяет локальные контейнеры Remnashop до изменения Clean
Pay. API, worker и scheduler Remnashop должны быть запущены из одного
immutable image; PostgreSQL-контейнер должен быть доступен тому же Docker
daemon. Путь `REMNASHOP_ENV_FILE` должен быть абсолютным, сам файл — обычным
файлом с правами `0400` или `0600`, а ожидаемые UID/GID задаются через
`REMNASHOP_ENV_EXPECTED_UID` и `REMNASHOP_ENV_EXPECTED_GID`.

## Установка: один мастер, три этапа

Выберите полный 40-символьный SHA проверенного релиза. Production не должен
устанавливаться прямо из меняющейся вершины ветки:

```bash
RELEASE_SHA='REPLACE_WITH_REVIEWED_40_HEX_SHA'
sudo mkdir -p /opt/clean-pay
sudo chown "$USER":"$USER" /opt/clean-pay
git clone https://github.com/flake92/clean-pay.git /opt/clean-pay
cd /opt/clean-pay
git fetch --depth=1 origin "$RELEASE_SHA"
git checkout --detach "$RELEASE_SHA"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git status --porcelain --untracked-files=all)"
test "$(node --version)" = "v$(cat .node-version)"
./deploy.sh setup
```

В интерактивном терминале запуск `deploy.sh` без аргументов равнозначен
`./deploy.sh setup`. Мастер выполняет три этапа:

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
сохраняет существующие секреты и Docker volumes, но `install` не является
резервной копией или zero-downtime rollout: приложение и workers временно
останавливаются, а при ошибке миграции остаются остановленными. Для обновления
заранее подготовьте и проверьте резервную копию базы и конфигурации.

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
sh deploy/prod/prepare-remnashop-rollout.sh deploy/prod/.env check
./deploy.sh install    # подготовить, запустить и проверить сервисы
```

Команда `check` в третьей строке только проверяет защищённый env-файл,
контейнеры, единый image, схему и API-контракт Remnashop; она не меняет данные.
`./deploy.sh install` повторяет эту проверку перед остановкой runtime.

Для полностью ручной настройки используйте `./deploy.sh init`, затем откройте
`deploy/prod/.env` в своём редакторе.

Команда `./deploy.sh up` сохранена как совместимый псевдоним `install`.

Формат `.env` простой: одна строка `NAME=value`, комментарии только на
отдельных строках. Не используйте `${NAME}`, inline-комментарии, дублирующиеся
имена и многострочные значения. Полный перечень настроек находится в
[`deploy/prod/.env.example`](deploy/prod/.env.example).

`deploy/prod/.env` — единственный authoritative файл конфигурации и должен
оставаться доступным только владельцу с правами `0600`. Файлы `.env.app`,
`.env.migration`, `.env.provision`, `.env.postgres`, `.env.reconciliation` и
`.env.retention` генерируются установщиком для отдельных ролей: не редактируйте
их вручную и не используйте вместо основного `.env`.

### Сборка на сервере или готовые образы

По умолчанию `CLEAN_PAY_DEPLOY_SOURCE=build`: сервер собирает оба Docker target
из текущего checkout — `runner` для приложения и `migration` для
`prisma migrate deploy`. `CLEAN_PAY_IMAGE` и `CLEAN_PAY_MIGRATION_IMAGE` должны
быть разными явными тегами без digest. Для трассируемой локальной сборки задайте
общие для обоих target `CLEAN_PAY_RELEASE` и `CLEAN_PAY_REVISION`; значения
`local` допустимы только для режима `build`.

Перед maintenance window можно выполнить `./deploy.sh build`: команда
подготавливает и проверяет оба образа, но не останавливает контейнеры и не
запускает миграцию. `./deploy.sh migrate`, напротив, останавливает приложение и
workers, применяет миграции и намеренно оставляет runtime остановленным до
последующего `./deploy.sh install`. Если перед локальной сборкой свободно менее
8 ГиБ, установщик очищает только неиспользуемый build cache и dangling images,
а затем всё равно завершится ошибкой, если места недостаточно.

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
Actions в два этапа. `stage` собирает оба target строго из одного `github.sha`,
сканирует и smoke-тестирует каждый platform manifest, но не создаёт release
tags. После review четырёх exact digest scopes отдельный `promote` run повторно
проверяет те же staged indexes и только затем выводит готовую digest-pinned
пару. Порядок approval и запрет наследования исключений новым digest описаны в
[`docs/container-vulnerability-release-gate.md`](docs/container-vulnerability-release-gate.md).
Для публикации используется только штатный `GITHUB_TOKEN` с ограничением
`packages: write`.

Точная модель доверия к образам, порядок миграции и восстановление после её
ошибки описаны в
[`docs/deployment-safety.md`](docs/deployment-safety.md).

Штатный `install` использует короткое maintenance window и не является
zero-downtime командой. Отдельный guarded canary flow, описанный в
[`deploy/prod/zero-downtime-production-runbook.md`](deploy/prod/zero-downtime-production-runbook.md),
можно использовать только после независимого прохождения всех его topology
guards: Compose-managed Caddy, точные private/external сети и bind mount,
обязательные маршруты и отсутствие pending migrations. Если хотя бы одно
условие не выполнено, используйте обычный maintenance `./deploy.sh install` и
не называйте выпуск zero-downtime.

## Поддержка через Chatwoot

Интеграция необязательна и по умолчанию отключена. Она использует стандартный
Chatwoot Website Widget без дополнительных npm-пакетов, миграций, webhooks или
изменений самого Chatwoot. Собственная кнопка поддержки Clean Pay появляется
только после авторизации и безопасного подтверждения текущего контакта.
Штатный плавающий launcher Chatwoot всегда скрыт; диалог открывается только по
явному нажатию кнопки Clean Pay. На страницах входа и у гостя виджет скрыт.

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

Надпись `Работает на Chatwoot` внутри окна диалога отрисовывает сам Chatwoot в
cross-origin iframe. Clean Pay не может безопасно изменить этот DOM. Если
надпись не должна быть видна клиенту, включите поддерживаемый white-label в
самом экземпляре Chatwoot либо используйте его согласованную branded-сборку;
изменение конфигурации внешнего Chatwoot не выполняется установщиком Clean Pay.

### Данные и безопасность

Clean Pay передаёт агенту неизменяемый внутренний ID, имя, подтверждённый
e-mail, Telegram ID, Telegram username, тариф, состояние и срок подписки, а
также безопасную сводку пяти последних синхронизированных платежей.
HMAC-SHA256 вычисляется на сервере:
браузер получает только готовую подпись идентификатора, но никогда не получает
`CHATWOOT_HMAC_TOKEN`. Неподтверждённый e-mail намеренно не отправляется,
поскольку Chatwoot может объединять контакты по адресу почты.

Кнопка Clean Pay привязана к отдельному domain-separated HMAC-SHA256
fingerprint текущих origin, inbox и пользователя. Он не является Chatwoot
credential. Точные support attributes остаются только в памяти, а persistent
browser storage содержит лишь SHA-256-дайджесты без PII, conversation token и
`identifier_hash`.

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

Контекст загружается в фоне и кешируется в браузере и на сервере на одну
минуту, поэтому сбой источника подписки или истории платежей не задерживает
интерфейс и не отключает базовый чат. Браузерный кеш хранит не более 16
идентификаторов, удаляет истёкшие записи и очищается при выходе. Server Action
перед каждым чтением серверного кеша заново проверяет текущую сессию. На один
процесс кеш ограничен 256 пользователями, восемью одновременными загрузками и
120 новыми загрузками в минуту; одинаковые запросы одного пользователя
объединяются. VPN URL,
платёжные URL, сырые ответы провайдеров и секреты в Chatwoot не передаются.

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
Clean Pay должна исчезнуть на странице входа, штатный launcher Chatwoot не
должен появляться ни до, ни после открытия диалога, а второй пользователь
должен получить отдельный контакт и историю. Подробная настройка и полный
чек-лист находятся в
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
./deploy.sh restart    # применить новый role-env, пересоздать runtime и проверить readiness
./deploy.sh install    # подготовка образов и обновление после резервной копии
./deploy.sh down       # остановка без удаления данных
```

`./deploy.sh restart` предназначен в том числе для смены runtime-секретов. Он
проверяет обновлённый authoritative `.env` текущим application image, фиксирует
точный уже запущенный image ID, удаляет только stateless-контейнеры приложения и
workers, пересоздаёт их из новых role-scoped env-файлов и ждёт healthy readiness.
Обычный `docker compose restart` для этого не подходит: он сохраняет старое
окружение контейнера. Смену образа или схему базы применяйте через
`./deploy.sh install`; пароль существующей PostgreSQL-роли требует отдельной
согласованной DB-процедуры, а не только изменения `POSTGRES_PASSWORD` в `.env`.

Не запускайте `docker compose down -v`, `docker volume prune` или
`docker system prune --volumes`, если данные нужно сохранить.

## Обновление

Перед обновлением сохраните базу по процедуре из migration runbook и создайте
зашифрованную резервную копию конфигурации в утверждённом secret manager.
Не копируйте authoritative `.env` в ещё один plaintext-файл. После проверки
backup закрепите точный проверенный commit. Для режима сборки на сервере
обновите только provenance-поля, сохранив остальные production-настройки:

### Прямое обновление `0.1.1` → `0.2.0`

Прямой переход поддерживается. Чистая база релиза `0.1.1` содержит 16 успешно
применённых Prisma-миграций и заканчивается на
`20260810013000_preserve_account_merge_target_telegram`; `0.2.0` содержит 22.
Стенд, на который до релиза уже попали две промежуточные миграции, ожидаемо
покажет переход `18/0 → 22/0`. Оба точных каталога допускаются provisioner-ом;
произвольная или частично применённая схема по-прежнему блокируется.

PostgreSQL обновляется только внутри major-версии 17 (`17.10 → 17.11`). Тот же
volume и существующая locale базы сохраняются: новый volume, `initdb`, смена
locale и dump/restore только ради minor-обновления не нужны. Никогда не
выполняйте `docker compose down -v` и не удаляйте PostgreSQL volume.

Порядок обновления существующей установки:

1. На работающей `0.1.1` сделайте согласованный custom-format backup, проверьте
   его чтение через `pg_restore --list` и сохраните зашифрованную копию
   `deploy/prod/.env` в secret manager. Зафиксируйте контрольные количества
   пользователей, подписок и платежей без выгрузки персональных данных.
2. Переключитесь на проверенный 40-символьный commit `0.2.0`, но не заменяйте
   существующий `.env` файлом `.env.example`. Выполните `./deploy.sh init`.
   Для точного legacy-варианта `0.1.1` команда сохранит `POSTGRES_USER` и
   `POSTGRES_PASSWORD`, заменит старый single-role `DATABASE_URL` и добавит
   отдельные application/migration/retention/hold-роли. Несовпадающий пароль,
   другая база или неоднозначный URL завершат обновление до любых изменений БД.
3. Подготовьте и проверьте образы заранее командой `./deploy.sh build`. Проверка
   Remnashop должна подтвердить требуемую схему/API; не занижайте
   `REMNASHOP_MINIMUM_ALEMBIC_REVISION` ради прохождения preflight.
4. Только после проверенного backup и непосредственно перед maintenance window
   одноразово разрешите принятие заполненной legacy-базы:

   ```bash
   printf '%s' true | node deploy/prod/credential-file-guard.mjs env-set deploy/prod/.env CLEAN_PAY_DATABASE_ADOPT_EXISTING
   printf '%s' true | node deploy/prod/credential-file-guard.mjs env-set deploy/prod/.env CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED
   ./deploy.sh install
   ```

   `install` сначала останавливает application/workers, оставляя volume на
   месте, затем сверяет точный каталог `0.1.1`, создаёт ограниченные роли,
   применяет миграции `16 → 22`, синхронизирует grants и только после этого
   запускает runtime. После успешных `sync` и `verify` оба одноразовых флага
   атомарно возвращаются в `false` до старта приложения.
5. Убедитесь, что `./deploy.sh ps` показывает healthy runtime, а журнал
   migration не содержит failed/rolled-back записей. Для чистой `0.1.1`
   ожидается `22` успешных и `0` незавершённых миграций, PostgreSQL `17.11` и
   прежняя locale. Проверьте вход, профиль, оплату и один reconciliation cycle.

Если обновление остановилось после изменения схемы, не запускайте код `0.1.1`
поверх базы `0.2.0`. Оставьте runtime остановленным, сохраните журналы и либо
устраните точную fail-closed причину, либо восстановите проверенный backup вместе
с соответствующим commit и конфигурацией `0.1.1`.

```bash
cd /opt/clean-pay
release_sha='REPLACE_WITH_REVIEWED_40_HEX_SHA'
release_id='REPLACE_WITH_UNIQUE_RELEASE_ID'
printf '%s' "$release_sha" | grep -Eq '^[0-9a-f]{40}$'
git fetch --depth=1 origin "$release_sha"
git checkout --detach "$release_sha"
test "$(git rev-parse HEAD)" = "$release_sha"
test -z "$(git status --porcelain --untracked-files=all)"
test "$(node --version)" = "v$(cat .node-version)"
printf '%s' build | node deploy/prod/credential-file-guard.mjs env-set deploy/prod/.env CLEAN_PAY_DEPLOY_SOURCE
printf '%s' "clean-pay-prod-app:$release_id" | node deploy/prod/credential-file-guard.mjs env-set deploy/prod/.env CLEAN_PAY_IMAGE
printf '%s' "clean-pay-prod-migration:$release_id" | node deploy/prod/credential-file-guard.mjs env-set deploy/prod/.env CLEAN_PAY_MIGRATION_IMAGE
printf '%s' "$release_id" | node deploy/prod/credential-file-guard.mjs env-set deploy/prod/.env CLEAN_PAY_RELEASE
printf '%s' "$release_sha" | node deploy/prod/credential-file-guard.mjs env-set deploy/prod/.env CLEAN_PAY_REVISION
./deploy.sh build
./deploy.sh install
```

`build` можно выполнить заранее без остановки runtime. `install` запускайте
только в согласованное maintenance window после проверенного backup. Для
`CLEAN_PAY_DEPLOY_SOURCE=pull` используйте digest-pinned пару из раздела выше,
а не команды с локальными тегами. Установщик применяет только
`prisma migrate deploy`, ждёт подробную readiness и внешнюю проверку HSTS/CSP и
не удаляет volumes. Расширенный порядок обновления и восстановления описан в
[`docs/production-migration-runbook.md`](docs/production-migration-runbook.md).

## Совместимость Remnashop

Clean Pay использует generic e-mail auth, service-session, объединение аккаунтов
и восстановление статуса платежей. API, worker и scheduler Remnashop всегда
разворачивайте из одного проверенного immutable commit и одного image. Базовый
контракт Clean Pay требует Alembic revision не ниже значения
`REMNASHOP_MINIMUM_ALEMBIC_REVISION` (`0058` по умолчанию); не смешивайте роли
из разных образов или ревизий.

Remnashop также остаётся единственным владельцем SMTP и очереди напоминаний об
окончании подписки. В нём задаются
`EMAIL_SUBSCRIPTION_EXPIRATION_CABINET_URL`, SMTP-параметры и независимый
fail-closed переключатель
`EMAIL_SUBSCRIPTION_EXPIRATION_REMINDERS_ENABLED`. Clean Pay только показывает
пользователю opt-in/opt-out в профиле.

Для принятой политики default-on нужен Remnashop с миграцией `0059`: она один
раз включает напоминания всем существующим пользователям с подтверждённым
e-mail, а успешное подтверждение e-mail нового пользователя включает их
автоматически. Последующий явный opt-out сохраняется; при смене адреса
настройка сбрасывается до подтверждения нового e-mail. После применения `0059`
и замены API/worker/scheduler на один image задайте
`REMNASHOP_MINIMUM_ALEMBIC_REVISION=0059` в Clean Pay и включите глобальную
доставку в Remnashop:

```dotenv
EMAIL_SUBSCRIPTION_EXPIRATION_REMINDERS_ENABLED=true
```

Напоминания отправляются за 7, 3 и 1 день, не проводят оплату и не включают
автопродление. Порядок безопасного включения описан в
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

Для локального запуска используйте Dev Container. После выполнения его
`postCreateCommand` запустите внутри контейнера:

```bash
npm run prisma:migrate
npm run dev
```

Clean Pay будет доступен на локальном forwarded-порту `4000`, а тестовая почта
Mailpit — на порту `8025`. Контейнер приложения по умолчанию выполняет
`sleep infinity`, поэтому `npm run dev` запускается явно.

Перед push и запуском GitHub CI сначала должны пройти локальные быстрые gates:

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

Отдельно запускаются более тяжёлые проверки с реальными сервисами:

```bash
REAL_DATABASE_URL="$DATABASE_URL" npm run test:services
npm run test:e2e
CLEAN_PAY_BROWSER_BASE_URL='<URL_DISPOSABLE_RUNNER>' npm run test:browser
npm run test:browser:journey -- --project journey-contract
```

Первая команда действительно включает PostgreSQL-тесты, которые без
`REAL_DATABASE_URL` будут пропущены. `test:e2e` поднимает отдельный Docker full
stack. Браузерная characterization ожидает уже запущенный disposable runner по
`CLEAN_PAY_BROWSER_BASE_URL`. Полный production-image journey и его обязательные
provenance-переменные описаны в [`tests/browser/README.md`](tests/browser/README.md).

Для локального full-stack E2E задайте `REMNASHOP_HOST_SOURCE` на чистый checkout
того же проверенного immutable Remnashop commit, который закреплён для релиза.
Минимальную схему задаёт `REMNASHOP_MINIMUM_ALEMBIC_REVISION`; для проверки
default-on напоминаний используйте `0059` и companion source с этой миграцией.

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
