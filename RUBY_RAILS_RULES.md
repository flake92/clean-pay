# Clean Pay: правила реализации Ruby on Rails монолита

## 1. Назначение документа

Этот файл — обязательный архитектурный контракт реализации. Любой код, конфигурация, миграция, тест и эксплуатационный файл Clean Pay должны:

1. реализовывать наблюдаемое поведение из `software-spec/`;
2. следовать этому документу;
3. иметь отдельную строку в `TECHNICAL_IMPLEMENTATION_PLAN.md`;
4. получить доказанные статусы «ИМПЛЕМЕНТИРОВАНО», «СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ» и «РАБОТАЕТ».

Старое приложение удалено намеренно. Его исходники и история не являются источником решений, не восстанавливаются и не проверяются. Источники истины: `software-spec/`, сохранённые файлы `public/`, `docker-compose.yml`, `infra/test/` и явно принятые новые решения.

## 2. Приоритет источников

При конфликте применяется следующий порядок:

1. точная карточка `software-spec/02-interfaces/http/operations/HTTP-*.md`;
2. принятое ADR из `software-spec/10-decisions/accepted/`;
3. точный внешний контракт из `software-spec/04-integrations/`;
4. доменные инварианты, данные и конкурентность из `software-spec/03-domain/`, `06-data/`, `07-operations/`;
5. PAGE-карточка и растровый эталон из `software-spec/05-frontend/`;
6. модульные и общесистемные описания;
7. этот документ — только для внутренней формы реализации, но не для изменения внешнего контракта.

Неясность не разрешается догадкой. Она оформляется ADR до реализации затронутого пункта.

## 3. Базовый стек

Базовая версия на дату создания документа, 2026-07-23:

- Ruby `4.0.6`, последняя стабильная ветка Ruby 4.0;
- Ruby on Rails `8.1.3`, поддерживаемая стабильная ветка Rails 8.1;
- PostgreSQL `17`;
- Redis `7`;
- сервер приложения Puma;
- HTML-first frontend: Action View + Turbo + Stimulus;
- assets: Propshaft и Importmap, без Node-сборки приложения;
- тестовый framework: встроенный Minitest, Rails integration tests и Rails system tests.

Официальные точки проверки версии: [Ruby 4.0.6](https://www.ruby-lang.org/en/news/2026/07/14/ruby-4-0-6-released/), [Rails 8.1.3](https://rubyonrails.org/2026/3/24/Rails-Versions-8-0-5-and-8-1-3-have-been-released), [Rails 8.1 release notes](https://guides.rubyonrails.org/8_1_release_notes.html).

Версии фиксируются в `.ruby-version` и `Gemfile.lock`. Обновление версии — отдельное изменение: release notes, полный тестовый цикл и новая фиксация результатов обязательны. Нельзя использовать preview, release candidate, git-ветку гема или плавающую несовместимую major-версию.

## 4. Rails Way — обязательные правила

### 4.1. Сначала framework

Перед написанием собственного механизма проверяются в таком порядке:

1. Rails 8.1 Guides и API;
2. стандартная библиотека Ruby 4.0;
3. поддерживаемый широко используемый gem Ruby/Rails-экосистемы;
4. минимальный собственный код только при отсутствии подходящего механизма или при несовместимости готового механизма с нормативным контрактом.

Каждое исключение из этого порядка поясняется комментарием в строке технического плана или отдельным ADR.

### 4.2. Структура приложения

- Один Rails application, один репозиторий, один Gemfile, один набор миграций и один релиз.
- Четыре логические области: `Identity`, `Subscriptions`, `Payments`, `Platform`. Это Ruby namespaces, а не engines, сервисы или отдельные deployable-приложения.
- PostgreSQL, Redis, Remnashop, Remnawave, Telegram, Turnstile, Mailpit/SMTP, провайдер оплаты и reverse proxy остаются внешними участниками.
- Внутри монолита запрещены сетевые вызовы между логическими областями.
- Rails autoloading Zeitwerk соблюдается буквально: один основной constant на файл, имя constant соответствует пути.
- Новая директория верхнего уровня в `app/` добавляется только тогда, когда стандартные `models`, `controllers`, `views`, `helpers`, `policies`, `javascript` и `assets` действительно не подходят.

### 4.3. Генераторы и schema

- Каркас создаётся официальным `rails new` и Rails generators.
- Модели, миграции, controllers и tests сначала генерируются, затем осознанно редактируются.
- `db/schema.rb` генерируется Rails и не редактируется вручную.
- Все физические гарантии из `software-spec/06-data/` закрепляются PostgreSQL foreign keys, unique indexes, `NOT NULL` и `CHECK`, а не только model validation.
- Для существующей БД сохраняются 15 нормативных переходов. Destructive reset, `db:drop`, `db:schema:load` поверх сохраняемых данных и автоматический rollback с потерей данных запрещены.
- Любая опасная миграция проверяется `strong_migrations`; осознанное исключение описывает блокировку, backfill, rollback приложения и backup.

### 4.4. Models и доменная логика

- Active Record models владеют ассоциациями, validation, normalization, scopes, optimistic/pessimistic locking и небольшими атомарными переходами своего состояния.
- Используются `normalizes`, `enum ... validate: true`, `has_secure_password`, Active Record Encryption, `with_lock`, транзакции и database constraints.
- Active Model используется для входных form/command objects без отдельной таблицы.
- Повторяемые переходы сложных закрытых state machines реализуются через `aasm`, но итоговое состояние также ограничивается БД.
- Callbacks допускаются только для локального детерминированного изменения самой записи. Сеть, аудит, создание платежа, merge и прочие внешние эффекты в callbacks запрещены.
- «Service object для каждого глагола» запрещён. Отдельный operation object вводится только для процесса, который затрагивает несколько агрегатов, транзакцию и/или внешнюю границу.
- Concerns не используются как хранилище несвязанной логики. Concern допустим только при реальном одинаковом поведении нескольких classes.
- Деньги и подтверждённые предложения обрабатываются через `BigDecimal` и явные value objects. `Float`, неявное округление и сравнение форматированных строк запрещены.
- Время хранится в UTC; текущее время в коде получается через `Time.current`, а в тестах — через Rails time helpers.

### 4.5. Controllers и HTTP

- Браузер обращается непосредственно к одному Rails-монолиту. Внутреннего
  JSON BFF, client router и отдельного API-приложения нет.
- `config/routes.rb` использует `resource`, `resources`, доменные namespaces и
  стандартные actions. Технические префиксы `/api/bff` и compatibility aliases
  старого приложения не сохраняются.
- Controller отвечает за transport: распознать вход, вызвать model/operation, отобразить результат. Бизнес-транзакция в controller не пишется.
- Обычный пользовательский вход обрабатывается `form_with`,
  `ActionController::Parameters#expect`/strong parameters и при необходимости
  Active Model form object. Успех завершается Rails redirect или Turbo response,
  ошибка рендерит Rails view с I18n-сообщениями.
- JSON допустим только там, где его требует browser/platform protocol:
  WebAuthn, health/internal machine interfaces и service worker metadata.
- Cookies создаются Rails cookie API. Короткий локальный access-token подписывает
  `ActiveSupport::MessageVerifier`; refresh остаётся случайным одноразово
  ротируемым секретом с HMAC digest в БД.
- Для browser mutations используются штатные Rails CSRF и
  `forgery_protection_origin_check`; Stimulus передаёт Rails CSRF token.
- `request_id`, content type, body limit, security headers, redirect и cache headers проверяются на уровне Rack/Rails, а не копируются по actions.
- N+1 запрещён; associations загружаются через `includes`, `preload` или точный query.

### 4.6. Аутентификация и авторизация

- Пароли принадлежат Remnashop и только транзитно передаются Ruby-клиенту.
  Rails не создаёт `password_digest` и не дублирует внешний источник истины.
- Локальная аутентификация браузера — Active Record sessions, Rails cookies,
  `ActiveSupport::MessageVerifier`, Active Record Encryption и row locks.
- Авторизация — Pundit policies; видимость UI не считается проверкой доступа.
- Текущий request-контекст — `ActiveSupport::CurrentAttributes`, обязательно очищаемый Rails executor.
- WebAuthn — gem `webauthn`; собственная реализация криптографии протокола запрещена.
- Внешний Telegram OIDC проверяется поддерживаемым JWT/JWKS gem; PKCE, state,
  nonce и одноразовость дополнительно фиксируются локальными моделями. JWT не
  используется как формат локальной Rails-сессии.
- Сравнение secret digests выполняется constant-time средствами Rails/Rack/OpenSSL.
- Шифрование Remnashop tokens — Active Record Encryption с раздельными ключами/контекстом. Секреты не попадают в inspect, logs, errors и JSON.

### 4.7. Интеграции

- HTTP-клиенты строятся на Faraday с общими timeouts, instrumentation, redaction и явным mapping ошибок.
- Cookie jar Remnashop реализуется стандартными Faraday/http-cookie adapters, а не ручным разбором `Set-Cookie`.
- Автоматический retry разрешён только для доказанно безопасных idempotent reads. Покупка, продление, merge и прочие возможные внешние эффекты не повторяются middleware вслепую.
- Нельзя держать database transaction во время сетевого запроса. Используются claim/lease/fence и отдельная фиксация результата.
- Redis подключается через Rails cache/redis-client facilities. PostgreSQL остаётся авторитетным источником для rate-limit evidence и долговечных состояний.
- Внешние payloads преобразуются в typed Active Model value objects; raw response не распространяется по controllers/views.

### 4.8. Frontend

- Server-rendered ERB является основой. Turbo отвечает за navigation и частичные обновления, Stimulus — за browser-only behavior.
- React, Vue, SPA state manager, самостоятельный client router и Node application toolchain не добавляются.
- Формы создаются `form_with`, ссылки и кнопки — Rails helpers, тексты — I18n `ru`.
- Повторяемая визуальная структура реализуется partials и helpers. ViewComponent вводится только если partials перестают давать понятный API и это зафиксировано отдельным решением.
- Существующие изображения, тема и Inter fonts сохраняются. Их URL, MIME, checksum и визуальный результат меняются только после сравнения.
- Все 19 routes, desktop/mobile layouts, loading/empty/error/success/disabled/focus states и русские строки являются контрактом.
- WebAuthn, Clipboard, storage, Telegram WebApp, install prompt, service worker и dialog behavior находятся в малых Stimulus controllers.
- Персональные HTML и protocol responses не попадают в общий service-worker cache.
- Accessibility: semantic HTML, labels, keyboard order, visible focus, `aria-live`, dialog focus management и reduced motion проверяются system tests.

### 4.9. Jobs и процессы

- Брокер сообщений не вводится. Solid Queue не используется как скрытая замена явно описанных интервальных процессов.
- Retention и reconciliation запускаются отдельными командами того же Rails release и используют общий domain code.
- Циклы подключают Rails application/executor, обрабатывают `SIGTERM`/`SIGINT`, не накладывают второй batch, используют leases и атомарно обновляют heartbeat.
- Active Job применяется только если появляется действительно асинхронная задача с контрактом очереди; само наличие Rails-компонента не является причиной создать очередь.
- Миграции сериализуются advisory lock и завершаются до допуска web к traffic.

### 4.10. Наблюдаемость и безопасность

- Rails 8.1 Structured Event Reporting (`Rails.event`) и `ActiveSupport::Notifications` используются вместо самодельной шины.
- Production logs — JSON line events со стабильными именами, request/correlation ID и рекурсивной redaction.
- `filter_parameter_logging`, CSP, permissions policy, secure cookies, allowed hosts, force SSL/proxy trust и error pages настраиваются штатными Rails механизмами.
- Долговечный `AuditLog` пишется отдельно от обычного log. Сбой дополнительного аудита не откатывает уже успешный основной результат, если спецификация не требует обратного.
- Brakeman, Bundler Audit, RuboCop Rails Omakase и dependency review являются release gates.
- Секрет или credential в fixture, log, screenshot, exception, source code либо git diff означает немедленный провал полного цикла.

## 5. Разрешённые зависимости

Gem добавляется только с владельцем, назначением и тестом интеграции. Предпочтительный набор:

| Задача | Решение |
|---|---|
| Web server | `puma` |
| PostgreSQL | `pg` |
| Password hashing | `bcrypt` через `has_secure_password` |
| Assets/browser | `propshaft`, `importmap-rails`, `turbo-rails`, `stimulus-rails` |
| JSON views | `jbuilder` |
| Authorization | `pundit` |
| HTTP | `faraday`, `faraday-retry`, cookie-jar adapter + `http-cookie` |
| JWT/OIDC | `jwt`, `openid_connect` |
| WebAuthn | `webauthn` |
| State machines | `aasm` |
| Redis | Rails cache store/`redis-client`, `connection_pool` |
| Safe migrations | `strong_migrations` |
| Style/security | `rubocop-rails-omakase`, `brakeman`, `bundler-audit` |
| Tests | Minitest, Rails integration/system tests, Capybara, Selenium |
| Visual comparison | Ruby image library, выбираемая отдельной строкой плана после проверки эталонов |

Не добавляются без нового ADR: Devise, Doorkeeper, ActiveAdmin, GraphQL, dry-rb application architecture, Trailblazer, Hanami components, Sidekiq, Resque, Kafka/RabbitMQ/NATS, React/Vue, Tailwind build pipeline, application-level npm/yarn/pnpm.

Devise не выбран осознанно: нормативная схема cookies, refresh-family, bootstrap trust, Telegram/WebAuthn merge и точные error envelopes существенно отличаются от его стандартного session flow. При этом низкоуровневые Rails primitives и профильные gems всё равно обязательны; собственная криптография запрещена.

## 6. Код и качество

- Ruby style — RuboCop Rails Omakase; локальные отключения точечные и объяснённые.
- Public API внутреннего class минимален; names отражают домен, а не технический шаблон.
- Метод обычно делает одну операцию; длинная ветвистая orchestration разбивается по доменным шагам, но не на бессодержательные wrappers.
- Используются keyword arguments, immutable constants, pattern matching/data objects Ruby 4 там, где они улучшают ясность.
- `rescue StandardError` без повторного raise/mapping и пустой rescue запрещены.
- SQL вручную допустим для advisory locks, PostgreSQL-specific atomic claim, constraints и доказанного performance path. Он должен быть parameterized и покрыт integration test.
- В production коде запрещены sleep-based coordination, глобальное изменяемое состояние, monkey patches внешних gems и callbacks с сетью.
- Комментарий объясняет «почему» и контракт, а не пересказывает строку Ruby.

## 7. Тестовая политика

Для каждой строки технического плана тест или проверка указывается до перевода статуса в положительный:

- model/value object: unit test;
- controller/route: integration contract test;
- SQL/locking: PostgreSQL concurrency test минимум с двумя соединениями;
- integration client: contract test против сохранённого mock/spec-контейнера;
- view/Stimulus: system test, accessibility state и desktop/mobile screenshot;
- worker: process/integration test, signal, lease, heartbeat и restart;
- deployment: clean build, config validation, migration, readiness, backup/restore.

Mocks внутреннего Ruby class не доказывают HTTP или integration compatibility. Финальная приёмка всегда выполняется black-box против запущенного приложения и реальных PostgreSQL/Redis с сохранёнными внешними контейнерами.

## 8. Протокол статусов и полной перепроверки

Единственное место статусов — `TECHNICAL_IMPLEMENTATION_PLAN.md`.

Положительные значения:

- `ИМПЛЕМЕНТИРОВАНО = ДА` — файл существует, feature завершена, нет placeholder/TODO;
- `СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ = ДА` — выполнен review именно по этому документу;
- `РАБОТАЕТ = ДА (цикл N, доказательство)` — проверка реально выполнена в текущем полном цикле.

Во время разработки используется промежуточное значение
`ПРОВЕРЕНО В БЛОКЕ N: доказательство; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА`.
Оно обязательно после завершения каждого блока, подтверждает локальную проверку
изменения, но не является положительным release-статусом `РАБОТАЕТ = ДА`.

Запрещены пустые cells, подразумеваемые статусы и «готово примерно». Неприменимость должна быть записана как `Н/П: причина` и подтверждена отдельным решением.

Если хотя бы одна проверка, feature или release gate не работает:

1. общий статус немедленно становится `НЕ ГОТОВО`;
2. текущий номер полного цикла признаётся недействительным;
3. все значения `РАБОТАЕТ = ДА` меняются на `ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ`;
4. после исправления запускается новый полный цикл с начала: static → unit → HTTP contract → integration → concurrency → E2E → visual → production/recovery;
5. статус `ГОТОВО` допустим только когда все без исключения строки имеют три доказанных положительных результата в одном и том же цикле.

Частичный rerun полезен при разработке, но не восстанавливает release status.

## 9. Definition of Done

Реализация завершена только одновременно:

- все строки `TECHNICAL_IMPLEMENTATION_PLAN.md` закрыты в одном полном цикле;
- покрыты CAP-01…13, HTTP-001…044, PAGE-001…019, RS-001…030 и остальные именованные внешние операции;
- schema, constraints, indexes и 15 migrations доказаны на PostgreSQL;
- все конкурентные и fault-injection сценарии пройдены;
- 19 desktop и 19 mobile сравнений не имеют необъяснённых отклонений;
- prestage сохраняет integrations, networks и volumes;
- clean build, restart, backup/restore и reconciliation rehearsal пройдены;
- нет нового ADR со статусом pending, относящегося к release;
- общий статус плана — `ГОТОВО`, а номер verification cycle одинаков во всех доказательствах.
