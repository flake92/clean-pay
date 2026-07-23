# Clean Pay: технический план Ruby on Rails монолита

## 0. Состояние плана

| Поле | Значение |
|---|---|
| Общий статус | `НЕ ГОТОВО` |
| Текущий полный verification cycle | `НЕДЕЙСТВИТЕЛЕН — 2026-07-23 изменена входная архитектура на server-rendered Rails` |
| Источник правил Ruby/Rails | `RUBY_RAILS_RULES.md` |
| Нормативный продуктовый источник | `software-spec/` |
| Старое приложение | `намеренно удалено; не проверяется и не восстанавливается` |
| Полностью положительных строк | `0 — все прежние доказательства сброшены` |
| Строк всего | `593` |
| Строк без финального положительного статуса | `593 из 593` |
| Последний проверенный блок | `7A — промежуточный UI gate: 19 system tests / 82 assertions ранее прошли; после последних UI-правок результат сброшен и обязательный повтор заблокирован лимитом approvals среды` |
| Условие готовности | `три положительных статуса у каждой строки в одном полном цикле` |

Этот файл одновременно является:

- целевым деревом новой реализации;
- атомарным backlog;
- матрицей соответствия Rails-правилам;
- журналом доказательств работоспособности.

Файл или feature нельзя добавлять в реализацию без добавления отдельной строки сюда. Сгенерированный Rails-файл, который не нужен, удаляется; нужный — сначала вносится в реестр. Одна строка описывает одну проверяемую обязанность. Если в одном файле несколько обязанностей, путь повторяется в нескольких строках.

### 0.1. Точка передачи следующей LLM — 2026-07-23

Работа остановлена внутри этапа 7 по просьбе владельца. Этап 8
«контейнеры, deploy и recovery» **не начат**.

Текущее состояние этапа 7:

- все 19 server-rendered Rails-страниц, layouts, partials, CSS и Stimulus behaviors
  реализованы;
- промежуточный `bin/rails test:system` прошёл: `19 runs, 82 assertions,
  0 failures, 0 errors, 0 skips`;
- после этого были внесены responsive navigation, payment-return polling,
  install/offline и PWA/dialog правки, поэтому по правилу сброса прежний результат
  больше не считается доказательством;
- после последних правок прошли Rails-aware ERB compilation (`36` файлов),
  `node --check`, RuboCop (`27` UI-файлов), Zeitwerk и структурная проверка:
  все `330` файлов текущего дерева зарегистрированы, пустых директорий и
  мусорных файлов нет;
- реальный браузерный smoke выполнен на `1440×1000` и `390×844` без
  горизонтального переполнения; mobile navigation проверена на open/Escape;
- обязательный повтор `mise exec -- bin/rails test:system` не состоялся:
  среда отклонила доступ к Docker test PostgreSQL из-за исчерпанного лимита
  approvals. Обходить это ограничение запрещено;
- ещё не реализованы `SYS-021…SYS-025`: четыре сквозных journey-test и
  автоматический visual comparison gate; `public/favicon.ico` также отсутствует.

Следующая LLM должна продолжить **с этапа 7**, а не с контейнеризации:

1. реализовать `SYS-021…SYS-025` и `ASSET-026`, не создавая свалку файлов;
2. первым доступным запуском повторить `mise exec -- bin/rails test:system`;
3. после любого исправления снова повторить весь UI gate: system tests, ERB,
   JavaScript syntax, RuboCop, Zeitwerk, desktop/mobile browser и структуру;
4. только после зелёного gate пометить этап 7 завершённым и перейти к этапу 8
   «контейнеры, deploy и recovery»;
5. не восстанавливать удалённое старое приложение, не сбрасывать Docker volumes,
   не устанавливать PostgreSQL локально, не выполнять `git add`/commit.

## 1. Значения статусов

| Колонка | Допустимые значения |
|---|---|
| ИМПЛЕМЕНТИРОВАНО | `НЕТ`; `В РАБОТЕ`; `ДА`; `Н/П: причина` |
| СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | `Н/П — нет реализации`; `НЕТ: причина`; `ДА: review/commit`; `ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ` |
| РАБОТАЕТ | `Н/П — нет реализации`; `НЕТ: ошибка`; `ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: причина`; `ПРОВЕРЕНО В БЛОКЕ N: доказательство; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА`; `ДА: полный цикл N, доказательство` |

В таблицах ниже начальное состояние заполнено явно. `Н/П — нет реализации` не является положительным результатом.
Проверка блока обязательна сразу после его реализации. Она сокращает обратную
связь, но не заменяет полный cycle и не учитывается как release-положительная строка.

### Правило сброса

Если не работает хотя бы одна строка:

1. записать ошибку в её колонке «РАБОТАЕТ»;
2. поставить общий статус `НЕ ГОТОВО`;
3. признать текущий полный cycle недействительным;
4. заменить все прежние `РАБОТАЕТ = ДА` на `ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ`;
5. после исправления увеличить номер цикла и повторить **все** уровни проверки для **всех** строк.

## 2. Этапы реализации

| Этап | Результат | Входной gate | Выходной gate |
|---:|---|---|---|
| 1 | Rails skeleton и базовые зависимости | этот план принят | **СБРОШЕН:** повторить boot, lint, security и tests после re-baseline |
| 2 | конфигурация и итоговая PostgreSQL schema | этап 1 | **СБРОШЕН:** повторить migrations, schema, config/security, Redis и bin/ci |
| 3 | identity/session/WebAuthn/Telegram | этап 2 | HTTP-001…020, 041…043 и concurrency |
| 4 | subscriptions и внешние каталоги | этап 3 | HTTP-021…023, 026…030 и degradation |
| 5 | payments и recovery | этап 4 | HTTP-024/025/031/032/038 и fault injection |
| 6 | platform/health/workers/PWA | этап 5 | HTTP-033…037/044, BG-001…004 |
| 7 | 19 server-rendered UI routes | этап 6 | system, accessibility и visual checks |
| 8 | контейнеры, deploy и recovery | этап 7 | clean prestage, backup/restore/restart |
| 9 | полный cycle | этап 8 | все строки зелёные в одном cycle |

## 3. Корень проекта и dependency manifest

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| ROOT-001 | `.ruby-version` | точный Ruby `4.0.6` | Ruby releases; правила §3 | ДА | ДА: точная стабильная версия | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-001A | `mise.toml` | воспроизводимая локальная активация Ruby `4.0.6` | правила §3 | ДА | ДА: один источник версии | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-002 | `Gemfile` | Rails `8.1.3`, pg, Puma и Rails defaults | правила §3, §5 | ДА | ДА: Rails defaults без лишнего framework | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-003 | `Gemfile` | Pundit, Faraday, JWT/OIDC, WebAuthn, AASM, Redis | правила §5; `04-integrations/` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-004 | `Gemfile` | test/style/security gems без application Node toolchain | правила §5, §7 | ДА | ДА: Rails/Minitest/Omakase security stack | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-005 | `Gemfile.lock` | полностью зафиксированный dependency graph | правила §3 | ДА | ДА: lockfile и Linux platforms | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-006 | `Rakefile` | стандартная загрузка Rails tasks без бизнес-логики | Rails skeleton | ДА | ДА: Rails generator entrypoint | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-007 | `config.ru` | стандартный Rack entrypoint Rails application | Rails skeleton | ДА | ДА: стандартный Rack entrypoint | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-007A | `LICENSE` | AGPL-3.0 repository license preserved verbatim | repository policy; source-tree manifest | ДА | ДА: нейтральный корневой файл сохранён без прикладного кода | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: финальный physical evidence gate |
| ROOT-008 | `.rubocop.yml` | RuboCop Rails Omakase, только объяснённые overrides | правила §6 | ДА | ДА: Omakase без overrides | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-009 | `.gitignore` | Rails secrets, logs, tmp, coverage, screenshots; assets/spec не скрываются | security; visual contract | ДА | ДА: секреты и runtime artifacts исключены | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-010 | `.gitattributes` | text/binary и стабильные line endings для Ruby/assets | repository hygiene | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-011 | `.dockerignore` | исключить secrets/cache/test output, включить runtime assets | `07-operations/runtime-and-deployment.md` | ДА | ДА: секреты и build artifacts исключены | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-012 | `README.md` | Ruby quick start, источники истины, безопасная работа с volumes | system/operations | ДА | ДА: Rails commands и границы preserved DB явны | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-013 | `RUBY_RAILS_RULES.md` | актуализируемый архитектурный контракт | этот файл | ДА | ДА: документ правил | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-014 | `TECHNICAL_IMPLEMENTATION_PLAN.md` | полный file/feature ledger и status protocol | запрос пользователя | ДА | ДА: документ правил | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-015 | `software-spec/README.md` | актуальное состояние после удаления и навигация к Rails-планам | repository state | ДА | ДА: удалённый код не используется как источник | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-016 | `software-spec/RUBY_MONOLITH_CLEANUP_PLAN.md` | завершённая cleanup-запись без разрешения новых удалений | repository state | ДА | ДА: граница монолита сохранена | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-017 | `software-spec/09-traceability/deletion-readiness-report.md` | историческое доказательство и текущий статус завершения удаления | traceability | ДА | ДА: история отделена от текущего состояния | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-018 | `software-spec/09-traceability/reimplementation-readiness-manifest.md` | post-analysis state и актуальные hashes управляющих документов | traceability | ДА | ДА: нормативные контракты не изменены | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-019 | `.github/workflows/ci.yml` | Rails style/security/test/system CI на Ruby 4.0.6 и PostgreSQL 17 | acceptance strategy | ДА | ДА: Rails generator CI, PostgreSQL 17 | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-020 | `.github/dependabot.yml` | weekly Bundler и GitHub Actions dependency updates | dependency policy | ДА | ДА: Bundler и Actions раздельно | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-021 | `.vscode/launch.json` | прокомментированный rdbg launch для Rails server на 4000 и текущего Minitest-файла | ruby/vscode-rdbg; developer experience | ДА | ДА: debug gem и стандартный rdbg adapter | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ROOT-022 | `software-spec/10-decisions/accepted/ADR-003-server-rendered-resourceful-rails.md` | нормативный re-baseline Rails routes/forms/rendering и сброс проверок | решение пользователя 2026-07-23 | ДА | ДА: явно фиксирует Rails monolith boundary | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |

## 4. Исполняемые команды

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| BIN-001 | `bin/rails` | стандартный Rails launcher | Rails generator | ДА | ДА: стандартный launcher | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| BIN-002 | `bin/rake` | стандартный Rake launcher | Rails generator | ДА | ДА: стандартный launcher | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| BIN-003 | `bin/setup` | idempotent bundle, DB prepare, tmp cleanup без reset volumes | `07-operations/`; правила §4.3 | ДА | ДА: Rails setup без destructive reset | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| BIN-004 | `bin/dev` | development Puma/asset startup на изолированном runtime | `07-operations/runtime-and-deployment.md` | ДА | ДА: Puma на контрактном порту 4000 | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| BIN-005 | `bin/ci` | Rails 8.1 local CI: style, security, tests, schema checks | `08-quality/acceptance-strategy.md` | ДА | ДА: единая Rails CI-команда | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| BIN-006 | `bin/rubocop` | locked Bundler execution | правила §6 | ДА | ДА: Bundler + repo-local cache | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| BIN-007 | `bin/brakeman` | security scan без permanent blanket ignores | `08-quality/security.md` | ДА | ДА: locked scanner без ignores | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| BIN-008 | `bin/bundler-audit` | gem vulnerability scan | `08-quality/security.md` | ДА | ДА: repo-local advisory DB, no ignores | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| BIN-009 | `bin/docker-entrypoint` | config validation, advisory migration lock, exec Puma | BG-003; runtime/deployment | В РАБОТЕ | ДА: Ruby/Rails entrypoint with exec handoff | ТРЕБУЕТ PRESTAGE PROCESS REHEARSAL |
| BIN-010 | `bin/retention` | BG-001 long-running Rails process | BG-001; retention | ДА | ДА: executable Rails runner with TERM/INT stop | ПРОВЕРЕНО В БЛОКЕ 6G: load/lint/component tests; ТРЕБУЕТ PROCESS REHEARSAL И ФИНАЛЬНОГО ЦИКЛА |
| BIN-011 | `bin/reconciliation` | BG-002 long-running Rails process | BG-002; background jobs | ДА | ДА: executable Rails runner with disabled clean exit and signals | ПРОВЕРЕНО В БЛОКЕ 6G: load/lint/component tests; ТРЕБУЕТ PROCESS REHEARSAL И ФИНАЛЬНОГО ЦИКЛА |
| BIN-012 | `bin/importmap` | locked Importmap command and vulnerability audit | Rails Importmap; security | ДА | ДА: стандартный Importmap command | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |

## 5. Rails boot и configuration

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| CFG-001 | `config/boot.rb` | Bundler/bootsnap boot стандартного Rails app | Rails generator | ДА | ДА: стандартный Rails boot | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-002 | `config/application.rb` | Rails 8.1 defaults, UTC, `ru`, four namespaces | правила §3–4 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-003 | `config/application.rb` | отключены только неиспользуемые Cable/Mailbox/Text/Storage frameworks | `02-interfaces/files.md`, `events.md` | ДА | ДА: минимальный набор Railties | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-004 | `config/environment.rb` | стандартная инициализация application | Rails generator | ДА | ДА: стандартная инициализация | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-005 | `config/environments/development.rb` | dev caching/CSP/logging без production weakening | runtime isolation | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-006 | `config/environments/test.rb` | deterministic tests, no external production calls | acceptance strategy | ДА | ДА: изолированное Rails test environment | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-007 | `config/environments/production.rb` | force SSL/proxy, JSON logs, cache, no secrets in image | runtime/security | ДА | ДА: штатные Rails production primitives и типизированный config | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-008 | `config/database.yml` | PostgreSQL URL, pool per process, UTC, no silent fallback | `06-data/storage-model.md` | ДА | ДА: PostgreSQL URLs и отдельная test DB | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-009 | `config/puma.rb` | port 4000, threads/workers, graceful shutdown | runtime/deployment | ДА | ДА: Puma DSL и Rails restart plugin | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-010 | `config/application.rb` | Redis cache namespace, bounded timeout/pool и error handler без лишнего config-файла | REDIS-001…005 | ДА | ДА: штатный Rails RedisCacheStore | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-011 | `config/app_config.rb` | typed strict runtime configuration object loaded before environment configuration | `02-interfaces/configuration.md` | ДА | ДА: Ruby Data value groups, strict parser, redacted secrets | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-012 | `config/initializers/filter_parameter_logging.rb` | recursive secret aliases redaction | sensitive-data; observability | ДА | ДА: Rails parameter filter с secret aliases | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-013 | `config/initializers/content_security_policy.rb` | production CSP, nonce, exact external origins | security; browser/PWA | ДА | ДА: Rails CSP DSL, nonce и минимальный allowlist | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-014 | `config/initializers/permissions_policy.rb` | WebAuthn/clipboard/browser permissions | BR-002…006 | ДА | ДА: точный browser header через Rails default headers | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-015 | `config/initializers/active_record_encryption.rb` | encrypted Remnashop tokens, key separation | sensitive-data | ДА | ДА: Active Record Encryption с раздельно выведенными ключами | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-016 | `config/initializers/faraday.rb` | shared adapters, timeouts, instrumentation, safe retry policy | `04-integrations/` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-017 | `config/initializers/redis.rb` | pooled redis-client, namespacing, bounded responses | storage integration | ДА | ДА: redis-client через ConnectionPool с таймаутами и prefix | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-018 | `config/initializers/pundit.rb` | deny-by-default policy verification | permissions docs | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-019 | `config/initializers/strong_migrations.rb` | migration safety checks | `06-data/migrations.md` | ДА | ДА: strong_migrations с PostgreSQL 17 и bounded locks | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-020 | `config/initializers/structured_events.rb` | Rails.event subscribers and stable JSON event schema | `07-operations/observability.md` | ДА | ДА: Rails 8.1 Event Reporter subscriber и JSON formatter | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-021 | `config/locales/ru.yml` | все общие русские labels/messages/errors | `05-frontend/`; HTTP cards | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-022 | `config/locales/models.ru.yml` | model/validation/domain translations | module errors | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-023 | `config/initializers/webauthn.rb` | exact RP origin/id/name; ceremony отдельно отвергает cross-origin iframe | WebAuthn; BR-003/004 | ДА | ДА: официальный webauthn-ruby 3.4 initializer API | В РАБОТЕ: identity block 3 verification |
| CFG-024 | `config/initializers/assets.rb` | Propshaft asset version и только необходимые load paths | Rails asset pipeline | ДА | ДА: стандартный asset version | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-024A | `config/initializers/assets.rb` | registered `webmanifest` MIME for an implicit Rails protocol view | PWA/files | ДА | ДА: Rails MIME registry, no manual response body | ПРОВЕРЕНО В БЛОКЕ 7A: `200 application/manifest+json`; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CFG-025 | `config/bundler-audit.yml` | Bundler Audit configuration без blanket ignores | security | ДА | ДА: ignore list пуст | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| CFG-026 | `config/ci.rb` | единый локальный Rails 8.1 CI pipeline | acceptance strategy | ДА | ДА: штатный Rails CI runner | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |

## 6. Маршруты: resourceful Rails-входы и 19 страниц

Каждая строка ниже — отдельная feature одного файла `config/routes.rb`.

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| ROUTE-001 | `config/routes.rb` | HTTP-001 `POST /account/identity` | HTTP-001 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-002 | `config/routes.rb` | HTTP-002 `POST /account/session` | HTTP-002 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-003 | `config/routes.rb` | HTTP-003 `POST /account/registration` | HTTP-003 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-004 | `config/routes.rb` | HTTP-004 `GET /account/session` | HTTP-004 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-005 | `config/routes.rb` | HTTP-005 `DELETE /account/session` | HTTP-005 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-005A | `config/routes.rb` | `PATCH /account/session` promotes an eligible bootstrap session when PAGE-007 is skipped | PAGE-007 | ДА | ДА: update on the existing singular Rails session resource | ПРОВЕРЕНО В БЛОКЕ 7A: PAGE-007 system transition to cabinet; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-006 | `config/routes.rb` | HTTP-006 `PATCH /account/password` | HTTP-006 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-007 | `config/routes.rb` | HTTP-007 `POST /account/email_verification` | HTTP-007 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-008 | `config/routes.rb` | HTTP-008 `PATCH /account/email_verification` | HTTP-008 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-009 | `config/routes.rb` | HTTP-009 `PATCH /account/email` | HTTP-009 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-010 | `config/routes.rb` | HTTP-010 `POST /account/passkey_registration` | HTTP-010 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-011 | `config/routes.rb` | HTTP-011 `PATCH /account/passkey_registration` | HTTP-011 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-012 | `config/routes.rb` | HTTP-012 `POST /account/passkey_session` | HTTP-012 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-013 | `config/routes.rb` | HTTP-013 `PATCH /account/passkey_session` | HTTP-013 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-014 | `config/routes.rb` | HTTP-014 `GET /account/passkeys` | HTTP-014 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-015 | `config/routes.rb` | HTTP-015 `DELETE /account/passkeys/:id` | HTTP-015 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-016 | `config/routes.rb` | HTTP-016 `POST /account/telegram_session` | HTTP-016 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-017 | `config/routes.rb` | HTTP-017 `GET /account/merge_confirmation` | HTTP-017 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-018 | `config/routes.rb` | HTTP-018 `PATCH /account/merge_confirmation` | HTTP-018 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-019 | `config/routes.rb` | HTTP-019 `DELETE /account/merge_confirmation` | HTTP-019 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-020 | `config/routes.rb` | HTTP-020 `POST /account/remnashop_link` | HTTP-020 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-021 | `config/routes.rb` | HTTP-021 `GET /plans` | HTTP-021 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-022 | `config/routes.rb` | HTTP-022 `GET /subscription` | HTTP-022 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-023 | `config/routes.rb` | HTTP-023 `GET /subscription/offers` | HTTP-023 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-024 | `config/routes.rb` | HTTP-024 `POST /purchases` | HTTP-024 | ДА | ДА: resourceful Rails form route, ADR-003 | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-025 | `config/routes.rb` | HTTP-025 `POST /extensions` | HTTP-025 | ДА | ДА: resourceful Rails form route, ADR-003 | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-026 | `config/routes.rb` | HTTP-026 `POST /subscription/reissue` | HTTP-026 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-027 | `config/routes.rb` | HTTP-027 `POST /subscription/promocode` | HTTP-027 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-028 | `config/routes.rb` | HTTP-028 `GET /subscription/devices` | HTTP-028 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-029 | `config/routes.rb` | HTTP-029 `DELETE /subscription/devices` | HTTP-029 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-030 | `config/routes.rb` | HTTP-030 `DELETE /subscription/devices/:id` | HTTP-030 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-031 | `config/routes.rb` | HTTP-031 `GET /payments` | HTTP-031 | ДА | ДА: resourceful Rails collection, ADR-003 | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-032 | `config/routes.rb` | HTTP-032 `GET /payments/:id` | HTTP-032 | ДА | ДА: resourceful Rails member, ADR-003 | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-033 | `config/routes.rb` | HTTP-033 `GET /support` (PAGE-017 server view) | HTTP-033 | ДА | ДА: singular Rails resource | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci 153 tests/677 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-034 | `config/routes.rb` | HTTP-034 `GET /health` | HTTP-034 | ДА | ДА: public machine resource | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci 153 tests/677 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-035 | `config/routes.rb` | HTTP-035 `GET /health/liveness` | HTTP-035 | ДА | ДА: resource member probe | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci 153 tests/677 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-036 | `config/routes.rb` | HTTP-036 `GET /health/readiness` | HTTP-036 | ДА | ДА: resource member probe | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci 153 tests/677 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-037 | `config/routes.rb` | HTTP-037 `GET /internal/health/readiness` | HTTP-037 | ДА | ДА: isolated internal resource | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci and real dependency readiness; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-038 | `config/routes.rb` | HTTP-038 `POST /internal/payment_reconciliations` | HTTP-038 | ДА | ДА: isolated internal machine command | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-041 | `config/routes.rb` | HTTP-041 `GET /account/telegram_authorization/new` | HTTP-041 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-042 | `config/routes.rb` | HTTP-042 `GET /account/telegram_authorization/callback` | HTTP-042 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-043 | `config/routes.rb` | HTTP-043 `POST /account/telegram_authorization/callback` | HTTP-043 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-044 | `config/routes.rb` | HTTP-044 `GET /service-worker.js` | HTTP-044 | ДА | ДА: public protocol JS resource | ПРОВЕРЕНО В БЛОКЕ 6G: privacy request test and bin/ci; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-045 | `config/routes.rb` | PAGE-001 `GET /` | PAGE-001 | ДА | ДА: Rails page route | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-046 | `config/routes.rb` | PAGE-002 `GET /login` | PAGE-002 | ДА | ДА: Rails page route | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-047 | `config/routes.rb` | PAGE-003 `GET /register` | PAGE-003 | ДА | ДА: Rails page route | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-048 | `config/routes.rb` | PAGE-004 `GET /register/verify-email` | PAGE-004 | ДА | ДА: Rails page route | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-049 | `config/routes.rb` | PAGE-005 `GET /verify-email` | PAGE-005 | ДА | ДА: Rails page route | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-050 | `config/routes.rb` | PAGE-006 `GET /auth/telegram/webapp` | PAGE-006 | ДА | ДА: Rails page plus browser protocol boundary | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-051 | `config/routes.rb` | PAGE-007 `GET /passkey/setup` | PAGE-007 | ДА | ДА: Rails page plus WebAuthn boundary | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-052 | `config/routes.rb` | PAGE-008 `GET /cabinet` | PAGE-008 | ДА | ДА: protected Rails page | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-053 | `config/routes.rb` | PAGE-009 `GET /tariffs` | PAGE-009 | ДА | ДА: public Rails page | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-054 | `config/routes.rb` | PAGE-010 `GET /payment` | PAGE-010 | ДА | ДА: explicitly named Rails page without resource-helper collision | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-055 | `config/routes.rb` | PAGE-011 `GET /extend` | PAGE-011 | ДА | ДА: protected Rails page | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-056 | `config/routes.rb` | PAGE-012 `GET /payment/success` | PAGE-012 | ДА | ДА: owner-scoped Rails return page | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-057 | `config/routes.rb` | PAGE-013 `GET /payment/fail` | PAGE-013 | ДА | ДА: owner-scoped Rails return page | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-058 | `config/routes.rb` | PAGE-014 `GET /payment/pending` | PAGE-014 | ДА | ДА: owner-scoped Rails return page | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-059 | `config/routes.rb` | PAGE-015 `GET /profile` | PAGE-015 | ДА | ДА: protected Rails page | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-060 | `config/routes.rb` | PAGE-016 `GET /link-account` | PAGE-016 | ДА | ДА: protected Rails page | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-061 | `config/routes.rb` | PAGE-017 `GET /support` | PAGE-017 | ДА | ДА: support resource doubles as PAGE-017 | ПРОВЕРЕНО В БЛОКЕ 6G: HTML request tests; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-062 | `config/routes.rb` | PAGE-018 `GET /install` | PAGE-018 | ДА | ДА: public AuthShell Rails page | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-063 | `config/routes.rb` | PAGE-019 `GET /offline` | PAGE-019 | ДА | ДА: public AuthShell Rails page | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI handoff gate |
| ROUTE-064 | `config/routes.rb` | dynamic `/manifest.webmanifest` and static assets | files/PWA | ДА | ДА: Rails-rendered manifest resource | ПРОВЕРЕНО В БЛОКЕ 6G: route/boot/bin-ci; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| ROUTE-065 | `config/routes.rb` | unmatched/method mismatch behavior без catch-all masking | error contracts | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 7. Миграции и schema

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| DB-001 | `db/migrate/20260619145932_create_core_records.rb` | users, sessions, audit, rate limits, settings, integrations | migration 1 | ДА | ДА: Rails 8.1 migration DSL и database constraints | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-002 | `db/migrate/20260619153000_split_session_expirations_and_add_email_codes.rb` | access/refresh expirations и email codes под lock | migration 2 | ДА | ДА: reversible migration с явным lock и data backfill | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-003 | `db/migrate/20260619154500_add_telegram_profile_and_auth_states.rb` | Telegram profile/OIDC state и guarded type conversion | migration 3 | ДА | ДА: Rails schema DSL и guarded identity storage | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-004 | `db/migrate/20260619161000_add_encrypted_remnashop_tokens_to_sessions.rb` | encrypted upstream tokens/expirations | migration 4 | ДА | ДА: ciphertext columns owned by Active Record Encryption | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-005 | `db/migrate/20260619202616_create_payment_records.rb` | payment status enum/records | migration 5 | ДА | ДА: PostgreSQL enum, money precision и CHECK | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-006 | `db/migrate/20260623214000_store_telegram_ids_as_text.rb` | lossless Telegram ID text | migration 6 | ДА | ДА: guarded lossless type transition | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-007 | `db/migrate/20260623222500_add_auth_method_to_sessions.rb` | EMAIL/TELEGRAM auth method | migration 7 | ДА | ДА: PostgreSQL enum через Rails migration DSL | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-008 | `db/migrate/20260624213519_add_passkeys_and_session_trust.rb` | PASSKEY, trust, credentials, challenges | migration 8 | ДА | ДА: constrained WebAuthn tables and foreign keys | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-009 | `db/migrate/20260624213935_add_auth_pending_to_users.rb` | non-null default false auth pending | migration 9 | ДА | ДА: safe non-null boolean default | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-010 | `db/migrate/20260717223000_create_payment_operations.rb` | idempotent operations and record link | migration 10 | ДА | ДА: immutable identity indexes and database constraints | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-011 | `db/migrate/20260718000000_add_payment_reconciliation_and_history_sync.rb` | chronology, leases, cursor generation, checks | migration 11 | ДА | ДА: explicit chronology/lease CHECK constraints | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-012 | `db/migrate/20260718141000_remove_redundant_indexes.rb` | three indexes, 5s lock timeout, atomic rollback | migration 12 | ДА | ДА: reversible bounded-lock cleanup | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-013 | `db/migrate/20260719003000_create_account_merge_confirmations.rb` | merge states, lease, expiry indexes | migration 13 | ДА | ДА: enum lifecycle, leases и referential integrity | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-014 | `db/migrate/20260720233000_create_refresh_token_predecessors.rb` | rotation time, predecessor digest, encrypted successor/grace | migration 14 | ДА | ДА: constrained predecessor lifecycle and ciphertext custody | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-015 | `db/migrate/20260721020000_add_pending_owner_evidence_to_users.rb` | pending Remnashop owner/email evidence and index | migration 15 | ДА | ДА: nullable staged evidence with lookup index | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| DB-016 | `db/schema.rb` | generated exact 15-table/9-enum final schema | `06-data/`; regression requirements | ДА | ДА: generated Rails schema, не редактируется вручную | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |

## 8. Active Record models

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| MODEL-001 | `app/models/application_record.rb` | abstract Rails base без глобальных business callbacks | правила §4.4 | ДА | ДА: стандартный Active Record base | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| MODEL-002 | `app/models/web_user.rb` | normalized unique email, Telegram/Remnashop identities, profile | entities/invariants | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-003 | `app/models/web_user.rb` | associations/deletion restrictions and ownership root | relationships/ownership | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-004 | `app/models/web_session.rb` | access/refresh lifecycle, trust, auth method, revocation | states/lifecycles | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-005 | `app/models/web_session.rb` | encrypted exclusive custody of Remnashop tokens | ownership/sensitive-data | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-006 | `app/models/web_refresh_token.rb` | predecessor digest, grace and encrypted same successor | refresh lifecycle | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-007 | `app/models/web_authn_credential.rb` | credential/public key/counter/transports and last-key guard | WebAuthn; invariant 5 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-008 | `app/models/web_authn_challenge.rb` | register/login type, expiry, atomic one-time consume | one-time entities | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-009 | `app/models/telegram_auth_state.rb` | state/nonce/verifier digests, safe return, consume | TG-001…003 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-010 | `app/models/email_verification_code.rb` | digest, attempts, resend/expiry/use lifecycle | MAIL-001…003 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-011 | `app/models/account_merge_confirmation.rb` | AASM states, token, lease, idempotent completion | merge states/lifecycle | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-012 | `app/models/payment_operation.rb` | immutable request/idempotency/owner fingerprints | payment invariants | ДА | ДА: Active Record validations, unique indexes and HMAC fingerprints | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-013 | `app/models/payment_operation.rb` | READY/DISPATCHING/terminal/unknown transitions and lease | payment states | ДА | ДА: AASM plus PostgreSQL row locks and fenced leases | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-014 | `app/models/payment_record.rb` | normalized status, immutable local ID, latest upstream snapshot | payment lifecycle | ДА | ДА: Active Record owner fence and monotonic upsert | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-015 | `app/models/payment_history_sync_state.rb` | cursor, generation, owner fence, lease/next attempt | history lifecycle | ДА | ДА: Active Record lock, generation and stale-claim rejection | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| MODEL-016 | `app/models/audit_log.rb` | immutable sanitized durable event and severity | observability | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-017 | `app/models/rate_limit_event.rb` | durable identity/action evidence and retention scope | rate limits/storage | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-018 | `app/models/app_setting.rb` | typed key + JSON value without secret misuse | entities/config | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-019 | `app/models/integration_status.rb` | UNKNOWN/OK/DEGRADED/DOWN snapshot and staleness | health/states | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 9. Value objects, policies и cross-aggregate operations

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| DOM-001 | `app/models/email_address.rb` | trim/lower/validate canonical email | value objects | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-002 | `app/models/safe_return_path.rb` | one-root-relative path, reject `//`, slash, NUL, external origin | value objects/global rules | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-003 | `app/models/idempotency_key.rb` | UUID validation and keyed digest | payment invariants | ДА | ДА: immutable ActiveModel value object | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-004 | `app/models/confirmed_offer.rb` | amount≤8 decimals, currency/version/duration exact match | value objects/payment | ДА | ДА: immutable ActiveModel value object | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-005 | `app/models/money_amount.rb` | BigDecimal parse and DECIMAL(12,2) final fit without rounding | data constraints | ДА | ДА: BigDecimal ActiveModel value object | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-006 | `app/models/operation_context.rb` | explicit request/worker audit context | runtime observability | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-007 | `app/models/current.rb` | Rails CurrentAttributes user/session/request context | rules §4.6 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-008 | `app/models/identity/session_authenticator.rb` | access verify, refresh rotation, grace replay, compromise revoke | IAM-SC-002; concurrency | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-009 | `app/models/identity/email_authentication.rb` | identify/login/register and upstream token custody | IAM-SC-001…003 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-010 | `app/models/identity/email_verification.rb` | request/confirm/change and partial merge continuation | IAM rules; MAIL operations | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-011 | `app/models/identity/passkey_ceremony.rb` | WebAuthn options/verify/register/login/counter | IAM-SC-006; BR-003/004 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-012 | `app/models/identity/telegram_authentication.rb` | OIDC/WebApp/Login Widget verification and local identity resolution | IAM-SC-004/005; TG-001…006 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-013 | `app/models/identity/account_merge.rb` | stable locks, explicit evidence, owner-fenced child transfer | IAM-SC-008; consistency | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-014 | `app/models/subscriptions/catalog.rb` | public plans and exact personal offers | SUB-SC-001; RS-012/014 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-015 | `app/models/subscriptions/current_access.rb` | upstream subscription plus authoritative Remnawave URL | SUB-SC-002; RW-001…003 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-016 | `app/models/subscriptions/device_management.rb` | list/delete one/delete all/reload | SUB-SC-003; RS-019…021 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-017 | `app/models/subscriptions/account_actions.rb` | reissue/promocode with degradation/audit | SUB-SC-004/005 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-018 | `app/models/payments/create_operation.rb` | offer recheck, immutable idempotency, pre-dispatch commit | PAY-SC-001…004 | ДА | ДА: signed server form state, model transaction and row lock | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-019 | `app/models/payments/create_operation.rb` | success/final failure/unknown outcome persistence | payment lifecycle | ДА | ДА: durable Rails domain operation, external call outside SQL transaction | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-020 | `app/models/payments/reconcile_batch.rb` | claim unknown operations, observe, settle/defer/manual | PAY-SC-004; BG-002 | ДА | ДА: bounded fenced Active Record batch | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-021 | `app/models/payments/sync_history_page.rb` | cursor lease/generation/owner-fenced idempotent upsert | PAY-SC-005/006 | ДА | ДА: capability fallback and atomic Active Record upsert | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-021A | `app/models/payments/sync_history_batch.rb` | bounded continuation of incomplete owner-fenced history | HTTP-038; BG-002 | ДА | ДА: small Rails domain batch reusing the page operation | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-022 | `app/models/platform/readiness_check.rb` | parallel dependency fan-out, 5s/8s budgets, sanitized result | health/readiness | ДА | ДА: concurrent-ruby fan-out with Rails clients and sanitized snapshot | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci 153 tests/677 assertions and real four-dependency readiness; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-023 | `app/models/platform/rate_limiter.rb` | Redis atomic counter + PostgreSQL evidence/fallback | REDIS-002/003; security | ДА | ДА: Redis Lua/TTL plus HMAC PostgreSQL evidence | ПРОВЕРЕНО В БЛОКЕ 6G: model and real Redis contract tests; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-024 | `app/models/platform/audit_writer.rb` | sanitized durable audit and non-rollback failure event | observability | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-025 | `app/models/platform/retention_batch.rb` | bounded idempotent deletion of allowed categories only | retention; BG-001 | ДА | ДА: bounded Active Record allowlist deletion, no user/payment relations | ПРОВЕРЕНО В БЛОКЕ 6G: retention safety regression in bin/ci; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| DOM-026 | `app/policies/application_policy.rb` | Pundit deny-by-default base | permissions | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-027 | `app/policies/identity_policy.rb` | guest/bootstrap/unverified/full identity permissions | identity permissions | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-028 | `app/policies/subscription_policy.rb` | linked owner/subscription action permissions | subscription permissions | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-029 | `app/policies/payment_policy.rb` | verified full owner payment/history permissions | payments permissions | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-030 | `app/policies/platform_policy.rb` | public/internal/support/PWA permissions | platform permissions | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 10. Integration clients

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| INT-001 | `app/models/integrations/http_client.rb` | Faraday base, timeouts, request IDs, safe logging/error mapping | integration rules | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-002 | `app/models/integrations/remnashop_client.rb` | RS-001…011 identity/auth/email operations | `remnashop-operations.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-003 | `app/models/integrations/remnashop_client.rb` | RS-012…014 plans/current/offers | `remnashop-operations.md` | ДА | ДА: Faraday client methods and server-side catalog operations | ПРОВЕРЕНО ЧАСТИЧНО В БЛОКЕ 4G: RS-012 preserved container; RS-013/014 ТРЕБУЮТ AUTH CONTRACT ЦИКЛА |
| INT-004 | `app/models/integrations/remnashop_client.rb` | RS-015…021 purchase/extend/reissue/promo/devices | `remnashop-operations.md` | ДА | ДА: Faraday client methods and Rails mutation boundaries | ПРОВЕРЕНО ЛОКАЛЬНО В БЛОКЕ 4G; RS-017…021 ТРЕБУЮТ PRESERVED AUTH CONTRACT ЦИКЛА |
| INT-005 | `app/models/integrations/remnashop_client.rb` | RS-022…027 capabilities/history/recovery public | `remnashop-operations.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-006 | `app/models/integrations/remnashop_client.rb` | RS-028…030 admin merge/payment recovery | `remnashop-operations.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-007 | `app/models/integrations/remnashop_client.rb` | auth-cookie jar refresh/transfer and exact error normalization | `remnashop.md`; errors | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-008 | `app/models/integrations/remnawave_client.rb` | RW-001 UUID lookup | `remnawave.md` | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| INT-009 | `app/models/integrations/remnawave_client.rb` | RW-002 email lookup | `remnawave.md` | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| INT-010 | `app/models/integrations/remnawave_client.rb` | RW-003 Telegram lookup | `remnawave.md` | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| INT-011 | `app/models/integrations/remnawave_client.rb` | RW-004 readiness metadata | `remnawave.md` | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| INT-012 | `app/models/integrations/telegram_oidc_client.rb` | TG-001 authorization + PKCE | `telegram.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-013 | `app/models/integrations/telegram_oidc_client.rb` | TG-002 code exchange | `telegram.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-014 | `app/models/integrations/telegram_oidc_client.rb` | TG-003 discovery/JWKS/ID token/nonce validation | `telegram.md`; ADR-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-015 | `app/models/integrations/telegram_payload.rb` | TG-004 popup/widget signed payload verification | `telegram.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-016 | `app/models/integrations/telegram_payload.rb` | TG-005 verified identity mapping to Remnashop | `telegram.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-017 | `app/models/integrations/turnstile_client.rb` | TS-001 form-encoded verification and failure mapping | `turnstile.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-018 | `app/models/integrations/mailpit_client.rb` | MP-001 optional readiness only | `mailpit-smtp.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-019 | `app/models/integrations/redis_store.rb` | REDIS-001 PING | `storage.md` | ДА | ДА: redis-rb pooled PING | ПРОВЕРЕНО В БЛОКЕ 6G: real container Redis contract; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| INT-020 | `app/models/integrations/redis_store.rb` | REDIS-002 EVAL counter and expiry | `storage.md` | ДА | ДА: exact atomic Lua through redis-rb | ПРОВЕРЕНО В БЛОКЕ 6G: real container Redis contract; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| INT-021 | `app/models/integrations/redis_store.rb` | REDIS-003 TTL Retry-After | `storage.md` | ДА | ДА: bounded TTL fallback | ПРОВЕРЕНО В БЛОКЕ 6G: real container Redis contract; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| INT-022 | `app/models/integrations/redis_store.rb` | REDIS-004 SET readiness JSON EX 120 | `storage.md` | ДА | ДА: JSON SET EX via redis-rb | ПРОВЕРЕНО В БЛОКЕ 6G: real container Redis contract; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| INT-023 | `app/models/integrations/redis_store.rb` | REDIS-005 GET readiness bounded JSON | `storage.md` | ДА | ДА: bounded parse and fail-closed fallback | ПРОВЕРЕНО В БЛОКЕ 6G: real container Redis contract; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |

## 11. Controllers и transport concerns

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| CTRL-001 | `app/controllers/application_controller.rb` | request context, Pundit, CSRF/origin, shared secure behavior | global/security | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-002 | `app/controllers/concerns/error_handling.rb` | Rails HTML/Turbo errors plus protocol JSON mapping | error contracts | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-003 | `app/controllers/concerns/session_authentication.rb` | cookie parse/refresh/current session and exact clearing | HTTP auth common | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-004 | `app/controllers/account/identities_controller.rb` | HTTP-001 identify and Rails redirect | HTTP-001 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-005 | `app/controllers/account/sessions_controller.rb` | HTTP-002/004/005 session resource | HTTP-002/004/005 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-005A | `app/controllers/account/sessions_controller.rb` | owner-bound verified bootstrap promotion and access-cookie reissue | PAGE-007 | ДА | ДА: resource update with server-owned eligibility and existing authenticator | ПРОВЕРЕНО В БЛОКЕ 7A: PAGE-007 system transition; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-006 | `app/controllers/account/registrations_controller.rb` | HTTP-003 registration resource | HTTP-003 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-007 | `app/controllers/account/passwords_controller.rb` | HTTP-006 change password/revoke peer sessions | HTTP-006 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-008 | `app/controllers/account/email_verifications_controller.rb` | HTTP-007/008 email verification resource | HTTP-007/008 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-009 | `app/controllers/account/emails_controller.rb` | HTTP-009 email resource | HTTP-009 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-010 | `app/controllers/account/passkeys/registrations_controller.rb` | HTTP-010/011 WebAuthn protocol boundary | HTTP-010/011 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-011 | `app/controllers/account/passkeys/sessions_controller.rb` | HTTP-012/013 WebAuthn protocol boundary | HTTP-012/013 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-012 | `app/controllers/account/passkeys/credentials_controller.rb` | HTTP-014/015 list/delete and Turbo rendering | HTTP-014/015 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-013 | `app/controllers/account/telegram/sessions_controller.rb` | HTTP-016 Telegram WebApp session | HTTP-016 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-014 | `app/controllers/account/merge_confirmations_controller.rb` | HTTP-017/018/019 merge resource | HTTP-017…019 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-015 | `app/controllers/account/remnashop_links_controller.rb` | HTTP-020 external account link | HTTP-020 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-016 | `app/controllers/plans_controller.rb` | HTTP-021 server-rendered plans | HTTP-021 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-017 | `app/controllers/subscriptions_controller.rb` | HTTP-022/023/026/027 subscription resource actions | HTTP-022/023/026/027 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-018 | `app/controllers/devices_controller.rb` | HTTP-028/029/030 nested devices | HTTP-028…030 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-019 | `app/controllers/purchases_controller.rb` | HTTP-024 purchase resource | HTTP-024 | ДА | ДА: thin resourceful Rails form controller | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-020 | `app/controllers/extensions_controller.rb` | HTTP-025 extension resource | HTTP-025 | ДА | ДА: thin resourceful Rails form controller | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-021 | `app/controllers/payments_controller.rb` | HTTP-031/032 history and durable status | HTTP-031/032 | ДА | ДА: thin owner-scoped collection/member controller | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-022 | `app/controllers/supports_controller.rb` | HTTP-033/PAGE-017 server-rendered support | HTTP-033; SUP-001…003 | ДА | ДА: thin Rails resource controller | ПРОВЕРЕНО В БЛОКЕ 6G: HTML/auth request tests; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-023 | `app/controllers/healths_controller.rb` | HTTP-034/035/036 machine health | HTTP-034…036 | ДА | ДА: thin machine resource controller | ПРОВЕРЕНО В БЛОКЕ 6G: request tests and real readiness; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-024 | `app/controllers/internal/readiness_controller.rb` | HTTP-037 secret-protected detail | HTTP-037 | ДА | ДА: constant-time internal boundary | ПРОВЕРЕНО В БЛОКЕ 6G: secret/detail request tests; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-025 | `app/controllers/internal/payment_reconciliations_controller.rb` | HTTP-038 secret batch endpoint | HTTP-038 | ДА | ДА: isolated thin machine controller and constant-time authentication | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-026 | `app/controllers/account/telegram_authorizations_controller.rb` | HTTP-041…043 Telegram authorization resource | HTTP-041…043 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-031 | `app/controllers/pwa_controller.rb` | HTTP-044 service worker and dynamic manifest | HTTP-044; PWA | ДА | ДА: Rails protocol rendering, no custom API | ПРОВЕРЕНО В БЛОКЕ 6G: request/privacy tests; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CTRL-032 | `app/controllers/pages_controller.rb` | page access redirects for guest/bootstrap/unverified/full | frontend permissions | ДА | ДА: server-rendered Rails controller с policy-подобными guard и resource helpers | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: обязательный system rerun после последних UI-правок |

## 12. Machine/protocol JSON views

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| JSON-001 | `app/views/healths/show.json.jbuilder` | sanitized public machine health | HTTP-034…036 | ДА | ДА: Jbuilder at machine-only boundary | ПРОВЕРЕНО В БЛОКЕ 6G: exact request contracts; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| JSON-002 | `app/views/internal/readiness/show.json.jbuilder` | dependency detail without credentials/errors | HTTP-037 | ДА | ДА: Jbuilder at internal machine boundary | ПРОВЕРЕНО В БЛОКЕ 6G: detail sanitization request test; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| JSON-003 | `app/views/internal/payment_reconciliations/show.json.jbuilder` | batch counters/manual IDs/bounded schema | HTTP-038 | ДА | ДА: Jbuilder only at the machine boundary | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |

## 13. HTML layouts, partials и 19 page views

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| VIEW-001 | `app/views/layouts/application.html.erb` | AppShell, metadata, CSP nonce, assets, SW registration | components/design tokens | ДА | ДА: Rails layout, helpers, CSP nonce и importmap/Propshaft | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: обязательный system/browser rerun |
| VIEW-002 | `app/views/layouts/auth.html.erb` | AuthShell exact desktop/mobile frame | components/design tokens | ДА | ДА: отдельный Rails layout без client-side shell | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: обязательный system/browser rerun |
| VIEW-003 | `app/views/shared/_navigation.html.erb` | state-aware desktop/mobile navigation | permissions/navigation | ДА | ДА: server-rendered partial и минимальный Stimulus behavior | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: responsive navigation изменена после прошлого system run |
| VIEW-004 | `app/views/shared/_flash.html.erb` | info/success/warn/error aria-live messages | screen states | ДА | ДА: стандартный Rails flash partial с aria-live | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: обязательный system rerun |
| VIEW-005 | `app/views/shared/_form_errors.html.erb` | field errors/focus target without data loss | forms/accessibility | ДА | ДА: Active Model errors через общий ERB partial | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: обязательный system rerun |
| VIEW-005A | `app/views/shared/_turnstile.html.erb` | shared conditional server-configured Turnstile widget | forms; TS-000 | ДА | ДА: shared Rails partial with CSP-approved official script in layouts | ПРОВЕРЕНО В БЛОКЕ 7A: all 19 page renders; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| VIEW-006 | `app/views/shared/_account_action_required.html.erb` | bootstrap/unverified/link guidance | permissions | ДА | ДА: общий server-rendered guidance partial | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: добавлен после прошлого system run |
| VIEW-006B | `app/helpers/formatting_helper.rb` | ru-RU date/traffic/byte/duration/status formatting | components | ДА | ДА: Rails view helper для общего форматирования | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: обязательный system rerun |
| VIEW-006C | `app/helpers/navigation_helper.rb` | menu state, active route and accessible labels | navigation/permissions | ДА | ДА: Rails view helper для состояния меню | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: responsive navigation изменена после прошлого system run |
| VIEW-007 | `app/views/pages/home.html.erb` | PAGE-001 root/action cards | PAGE-001 | ДА | ДА: server-rendered ERB и resourceful route helpers | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-001 system rerun |
| VIEW-008 | `app/views/pages/login.html.erb` | PAGE-002 identify/known/unknown/passkey/Telegram states | PAGE-002 | ДА | ДА: Rails forms и progressive enhancement | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-002 system rerun |
| VIEW-009 | `app/views/pages/register.html.erb` | PAGE-003 register/Turnstile/password feedback | PAGE-003 | ДА | ДА: Rails form_with, model errors и общий Turnstile partial | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-003 system rerun |
| VIEW-010 | `app/views/pages/register_verify_email.html.erb` | PAGE-004 six-digit confirm/resend/back | PAGE-004 | ДА | ДА: Rails forms/resource routes | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-004 system rerun |
| VIEW-011 | `app/views/pages/verify_email.html.erb` | PAGE-005 session email confirm/resend/partial success | PAGE-005 | ДА | ДА: Rails forms/resource routes | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-005 system rerun |
| VIEW-012 | `app/views/pages/telegram_webapp.html.erb` | PAGE-006 auto initData login/safe redirect | PAGE-006 | ДА | ДА: server-rendered shell с узким protocol Stimulus adapter | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-006 system/browser rerun |
| VIEW-013 | `app/views/pages/passkey_setup.html.erb` | PAGE-007 passkey setup/skip/bootstrap promotion | PAGE-007 | ДА | ДА: Rails resource mutation и WebAuthn progressive enhancement | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-007 system/browser rerun |
| VIEW-014 | `app/views/pages/cabinet.html.erb` | PAGE-008 subscription, URL, devices, history, actions | PAGE-008 | ДА | ДА: server-rendered aggregate page с Rails links/forms | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-008 system/browser rerun |
| VIEW-015 | `app/views/pages/tariffs.html.erb` | PAGE-009 plan/duration/gateway exact selection | PAGE-009 | ДА | ДА: Rails-rendered offer selection и signed server input | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-009 system/browser rerun |
| VIEW-016 | `app/views/pages/payment.html.erb` | PAGE-010 refreshed offer confirmation/idempotent submit | PAGE-010 | ДА | ДА: Rails form и server-owned signed submission token | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-010 system/browser rerun |
| VIEW-017 | `app/views/pages/extend.html.erb` | PAGE-011 extension selection/confirmation | PAGE-011 | ДА | ДА: Rails form и server-owned offer | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-011 system/browser rerun |
| VIEW-018 | `app/views/pages/payment_success.html.erb` | PAGE-012 durable status polling with success hint only | PAGE-012 | ДА | ДА: Rails durable state page с bounded Stimulus refresh | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: payment-return behavior изменён после system run |
| VIEW-019 | `app/views/pages/payment_fail.html.erb` | PAGE-013 durable status polling with fail hint only | PAGE-013 | ДА | ДА: Rails durable state page с bounded Stimulus refresh | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: payment-return behavior изменён после system run |
| VIEW-020 | `app/views/pages/payment_pending.html.erb` | PAGE-014 bounded pending/network retry | PAGE-014 | ДА | ДА: Rails durable state page с bounded Stimulus refresh | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: payment-return behavior изменён после system run |
| VIEW-021 | `app/views/pages/profile.html.erb` | PAGE-015 profile/email/password/verification | PAGE-015 | ДА | ДА: server-rendered Rails resource forms | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-015 system rerun |
| VIEW-022 | `app/views/pages/link_account.html.erb` | PAGE-016 email/Telegram/passkeys/merge panel | PAGE-016 | ДА | ДА: server-rendered Rails forms и resource links | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: PAGE-016 system rerun |
| VIEW-022A | `app/views/account/passkeys/credentials/index.html.erb` | server-rendered passkey list and accessible delete controls | HTTP-014/015 | В РАБОТЕ | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ |
| VIEW-022B | `app/views/account/merge_confirmations/show.html.erb` | owner-bound masked merge evidence and Rails confirm/cancel forms | HTTP-017…019 | ДА | ДА: ADR-003, server-rendered resource with Rails forms | ПРОВЕРЕНО В БЛОКЕ 3M: request/model tests; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| VIEW-022C | `app/views/plans/index.html.erb` | public server-rendered plan catalog and empty state | HTTP-021 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| VIEW-022D | `app/views/subscriptions/show.html.erb` | current subscription, verified live URL and Rails mutations | HTTP-022/026/027 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| VIEW-022E | `app/views/subscriptions/offers.html.erb` | server-rendered personal offers and empty state | HTTP-023 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| VIEW-022F | `app/views/devices/index.html.erb` | device limits, empty/list states and resourceful delete forms | HTTP-028…030 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| VIEW-022G | `app/views/payments/index.html.erb` | owner-scoped server-rendered payment history | HTTP-031 | ДА | ДА: escaped ERB collection resource | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| VIEW-022H | `app/views/payments/show.html.erb` | durable operation/payment state and safe provider transition | HTTP-032 | ДА | ДА: escaped ERB member resource with safe external link attributes | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| VIEW-023 | `app/views/supports/show.html.erb` | PAGE-017 SUP-001…003 and disabled/empty/error states | PAGE-017 | ДА | ДА: escaped ERB resource view and safe external links | ПРОВЕРЕНО В БЛОКЕ 6G: HTML/auth request tests; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| VIEW-024 | `app/views/pages/install.html.erb` | PAGE-018 native/iOS/embedded/Android/installed states | PAGE-018 | ДА | ДА: AuthShell Rails page и minimal install Stimulus controller | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: install/dialog изменены после system run |
| VIEW-025 | `app/views/pages/offline.html.erb` | PAGE-019 safe public offline fallback | PAGE-019 | ДА | ДА: безопасный публичный Rails fallback без private state | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: offline page изменена после system run |
| VIEW-026 | `app/views/pwa/manifest.webmanifest.erb` | dynamic brand/icons/start/display contract | PWA/files | ДА | ДА: Rails ERB protocol view with JSON escaping | ПРОВЕРЕНО В БЛОКЕ 6G: route/boot/bin-ci; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| VIEW-027 | `app/views/pwa/service_worker.js.erb` | build-scoped public cache, offline navigation, private bypass | HTTP-044; BR-006 | ДА | ДА: minimal public-only service worker protocol | ПРОВЕРЕНО В БЛОКЕ 6G: private-route exclusion request test; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |

## 14. Assets и Stimulus

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| ASSET-001 | `app/assets/config/manifest.js` | Propshaft asset declarations | Rails asset pipeline | Н/П: Rails 8 Propshaft не использует Sprockets manifest | ДА: отсутствие лишнего Sprockets-файла соответствует Rails 8 skeleton | Н/П: отсутствие файла подтверждено структурной проверкой |
| ASSET-002 | `app/assets/stylesheets/application.css` | ordered imports without Node build | rules §4.8 | ДА | ДА: Propshaft CSS entrypoint без Node build | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser/system rerun |
| ASSET-003 | `app/assets/stylesheets/tokens.css` | exact typography/palette/spacing/radius/shadow/focus tokens | design-tokens | ДА | ДА: один concern-файл токенов без дублирования public theme | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser visual gate |
| ASSET-004 | `app/assets/stylesheets/layouts.css` | AuthShell/AppShell desktop/mobile grids | design-tokens/screens | ДА | ДА: отдельный layout concern Propshaft | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser visual gate |
| ASSET-005 | `app/assets/stylesheets/components.css` | controls/cards/tags/messages/dialog/table/device cards states | components/forms/dialogs | ДА | ДА: отдельный component concern Propshaft | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser visual gate |
| ASSET-006 | `app/assets/stylesheets/pages.css` | page-specific composition for PAGE-001…019 | PAGE cards | ДА | ДА: отдельный page composition concern Propshaft | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser visual gate |
| ASSET-007 | `config/importmap.rb` | pinned local Hotwire/Stimulus modules, no floating CDN | rules §4.8/security | ДА | ДА: Rails-managed local gem assets | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ASSET-008 | `app/javascript/application.js` | Turbo/Stimulus boot and SW registration | browser/PWA | ДА | ДА: standard importmap Turbo/Stimulus boot и scoped SW registration | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser/PWA rerun |
| ASSET-009 | `app/javascript/controllers/index.js` | eager/lazy registration through stimulus-loading | Rails Stimulus | ДА | ДА: stimulus-loading convention | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ASSET-009A | `app/javascript/controllers/application.js` | standard Stimulus application bootstrap | Rails Stimulus | ДА | ДА: стандартный Stimulus bootstrap | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| ASSET-009B | `app/javascript/controllers/navigation_controller.js` | accessible responsive sidebar toggle, overlay, focus and Escape | navigation/accessibility | ДА | ДА: small Stimulus behavior over server-rendered navigation | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: UI block 7 browser gate |
| ASSET-010 | `app/javascript/controllers/form_lock_controller.js` | one pending mutation, disabled/label/focus result | screen-states | ДА | ДА: минимальный Stimulus progressive enhancement | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser interaction gate |
| ASSET-011 | `app/javascript/controllers/password_visibility_controller.js` | show/hide preserving focus/value | forms | ДА | ДА: минимальный Stimulus progressive enhancement | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser interaction gate |
| ASSET-012 | `app/javascript/controllers/passkey_controller.js` | BR-003/004 native create/get/cancel/error serialization | browser/WebAuthn | ДА | ДА: browser-only WebAuthn adapter над Rails endpoints | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser/WebAuthn gate |
| ASSET-013 | `app/javascript/controllers/clipboard_controller.js` | BR-002 copy live URL and managed failure | browser | ДА | ДА: browser-only Clipboard adapter | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser interaction gate |
| ASSET-014 | `app/javascript/controllers/payment_controller.js` | BR-001/007/008 stable idempotency and external navigation | browser/payment | ДА | ДА: server token сохраняет идемпотентность, JS только управляет submit/navigation | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser payment gate |
| ASSET-015 | `app/javascript/controllers/payment_return_controller.js` | aliases, durable correlation, bounded polling/retry | return pages/API usage | ДА | ДА: bounded polling читает owner-scoped Rails durable state | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: изменён после прошлого system run |
| ASSET-016 | `app/javascript/controllers/telegram_webapp_controller.js` | TG-006 SDK/initData/openLink fallback/storage | TG-006; BR-011 | ДА | ДА: узкий Telegram browser adapter, сервер остаётся владельцем auth state | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser Telegram gate |
| ASSET-017 | `app/javascript/controllers/pwa_install_controller.js` | BR-005 install state machine and dialogs | install/PWA | ДА | ДА: browser-only install progressive enhancement | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: изменён после прошлого system run |
| ASSET-018 | `app/javascript/controllers/dialog_controller.js` | accessible focus trap/restore/escape for install only | dialogs/accessibility | ДА | ДА: native dialog с минимальным Stimulus lifecycle | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: изменён после прошлого system run |
| ASSET-019 | `public/clean-pay-logo.png` | preserved brand asset URL/checksum | files/reference manifest | ДА | ДА: нормативный статический Rails public asset сохранён | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: финальный physical evidence gate |
| ASSET-020 | `public/clean-pay-icon-192.png` | preserved PWA 192 icon | files/PWA | ДА | ДА: нормативный PWA asset сохранён | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: manifest/browser gate |
| ASSET-021 | `public/clean-pay-icon-512.png` | preserved PWA 512 icon | files/PWA | ДА | ДА: нормативный PWA asset сохранён | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: manifest/browser gate |
| ASSET-022 | `public/clean-pay-icon-maskable-512.png` | preserved maskable icon | files/PWA | ДА | ДА: нормативный PWA asset сохранён | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: manifest/browser gate |
| ASSET-023 | `public/themes/lara-light-indigo/theme.css` | preserved theme bytes and served MIME/cache | files/design | ДА | ДА: сохранённый theme asset подключён до application CSS | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser visual gate |
| ASSET-024 | `public/themes/lara-light-indigo/fonts/Inter-roman.var.woff2` | preserved Inter roman font | files/design | ДА | ДА: локальный immutable font asset | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser visual gate |
| ASSET-025 | `public/themes/lara-light-indigo/fonts/Inter-italic.var.woff2` | preserved Inter italic font | files/design | ДА | ДА: локальный immutable font asset | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: browser visual gate |
| ASSET-026 | `public/favicon.ico` | browser favicon at exact public path | `02-interfaces/files.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-027 | `public/400.html` | safe static bad-request fallback without internals | security/error contracts | ДА | ДА: безопасный Rails public fallback без internals | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: production error gate |
| ASSET-028 | `public/404.html` | safe static not-found fallback without route masking | security/error contracts | ДА | ДА: безопасный Rails public fallback без internals | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: production error gate |
| ASSET-029 | `public/406-unsupported-browser.html` | Rails browser compatibility fallback | Rails 8.1 | ДА | ДА: Rails browser compatibility fallback | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: production browser gate |
| ASSET-030 | `public/422.html` | safe static unprocessable-content fallback | security/error contracts | ДА | ДА: безопасный Rails public fallback без internals | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: production error gate |
| ASSET-031 | `public/500.html` | safe static production error without exception leakage | security/error contracts | ДА | ДА: безопасный Rails public fallback без internals | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: production error gate |

## 15. Workers и эксплуатационные Ruby classes

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| OPS-001 | `app/models/platform/interval_runner.rb` | Rails executor, non-overlap, monotonic schedule, signal stop | background jobs | ДА | ДА: Rails executor and monotonic interval primitive | ПРОВЕРЕНО В БЛОКЕ 6G: immediate/stop unit test; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| OPS-002 | `app/models/platform/heartbeat.rb` | atomic epoch-ms replace and freshness calculation | BG-001/002 | ДА | ДА: atomic Tempfile replace and epoch-ms parser | ПРОВЕРЕНО В БЛОКЕ 6G: freshness unit test; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| OPS-003 | `app/models/platform/retention_runner.rb` | first run, 300…86400 interval, batch summary, retry next cycle | BG-001 | ДА | ДА: thin composition of Rails domain batch and interval runner | ПРОВЕРЕНО В БЛОКЕ 6G: component tests/bin-ci; ТРЕБУЕТ PROCESS REHEARSAL И ФИНАЛЬНОГО ЦИКЛА |
| OPS-004 | `app/models/platform/reconciliation_runner.rb` | disabled exit 0, 5…3600 interval, 45s HTTP request validation | BG-002 | ДА | ДА: isolated internal HTTP worker and bounded schema | ПРОВЕРЕНО В БЛОКЕ 6G: machine response validation test; ТРЕБУЕТ PROCESS REHEARSAL И ФИНАЛЬНОГО ЦИКЛА |
| OPS-005 | `app/models/platform/migration_runner.rb` | strict config, PostgreSQL advisory lock, migrate/version verify | BG-003 | В РАБОТЕ | ДА: Active Record migration task under PostgreSQL advisory lock | ТРЕБУЕТ PRESTAGE PROCESS REHEARSAL |
| OPS-006 | `lib/tasks/quality.rake` | schema/route/spec coverage checks in bin/ci | acceptance strategy | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| OPS-007 | `lib/tasks/visual.rake` | render and compare 19×2 reference screenshots | visual contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| OPS-008 | `lib/tasks/prestage.rake` | safe start/wait/test without volume reset default | BG-004 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 16. Model, operation и integration tests

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| TEST-001 | `test/test_helper.rb` | deterministic Rails/Minitest setup, parallel safety, no real prod endpoints | acceptance | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-001A | `test/integration/skeleton_test.rb` | pinned stack, 42 canonical resource operations, Rails PUT variants, 19 rendered pages, no BFF aliases, isolated test DB | этап 1/re-baseline gate | ДА | ДА: ADR-003, resourceful Rails forms/views или WebAuthn protocol boundary | ПРОВЕРЕНО В БЛОКЕ 3R: 18 tests/95 assertions + skeleton 3/12 + Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-001B | `test/models/schema_contract_test.rb` | 15 tables, 9 enums, natural PK, money precision, uniqueness/FK/CHECK inventory | этап 2 gate; `06-data/` | ДА | ДА: Rails schema introspection против PostgreSQL | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| TEST-001C | `test/models/app_config_test.rb` | typed defaults, strict booleans, bounds, feature completeness, secret redaction | этап 2 gate; configuration contract | ДА | ДА: Ruby typed config и Rails boot | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| TEST-001D | `test/integration/migration_upgrade_test.rb` | session expiration и Telegram ID сохраняются на исторических переходах | этап 2 gate; migration compatibility | ДА | ДА: Rails MigrationContext в изолированной PostgreSQL schema | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| TEST-001E | `test/models/structured_events_test.rb` | JSON line schema и recursive redaction Rails.event payload | этап 2 gate; observability/security | ДА | ДА: Rails 8.1 Event Reporter subscriber | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| TEST-001F | `test/models/security_configuration_test.rb` | CSP, Permissions Policy, Redis pool и Active Record Encryption config | этап 2 gate; security/storage | ДА | ДА: Rails configuration primitives | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| TEST-002 | `test/models/web_user_test.rb` | identity normalization/uniqueness/ownership | model contract | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-003 | `test/models/web_session_test.rb` | session states/token custody/encryption | model contract | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-004 | `test/models/web_refresh_token_test.rb` | grace replay/reuse evidence | model contract | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-005 | `test/models/web_authn_credential_test.rb` | credential counter/transports/last-key guard | model contract | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-006 | `test/models/web_authn_challenge_test.rb` | one-time expiry/consume | model contract | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-007 | `test/models/telegram_auth_state_test.rb` | digests/safe return/one-time | model contract | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-008 | `test/models/email_verification_code_test.rb` | attempts/resend/use/expiry | model contract | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-009 | `test/models/account_merge_confirmation_test.rb` | states/lease/idempotency | model contract | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-010 | `test/models/payment_operation_test.rb` | state machine/idempotency/owner/leases | model contract | ДА | ДА: Minitest state and constraint coverage | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-011 | `test/models/payment_record_test.rb` | status mapping/upsert chronology | model contract | ДА | ДА: Minitest model coverage | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-012 | `test/models/payment_history_sync_state_test.rb` | cursor/generation/lease fence | model contract | ДА | ДА: Minitest lease invariant coverage | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-013 | `test/models/audit_log_test.rb` | immutability/redaction/retention | model contract | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-014 | `test/models/rate_limit_event_test.rb` | evidence scopes/retention | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-015 | `test/models/app_setting_test.rb` | typed JSON config | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-016 | `test/models/integration_status_test.rb` | state/staleness | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-017 | `test/models/value_objects_test.rb` | email/path/idempotency/offer/money edge cases | value objects | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-018 | `test/models/identity/session_authenticator_test.rb` | rotation/race/replay/revocation | high-risk regression | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-019 | `test/models/identity/account_merge_test.rb` | transfer/partial failure/owner fence | high-risk regression | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-019A | `test/models/subscriptions/current_access_test.rb` | authoritative live URL, expiry and ambiguous fallback | SUB-SC-002; RW-001…003 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-019B | `test/models/subscriptions/operations_test.rb` | catalog/device/reissue/promocode mutation and audit boundaries | SUB-SC-001/003/004 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-019C | `test/models/identity/passkey_ceremony_test.rb` | real WebAuthn fake-client origin, one-time challenge and counter flow | IAM-SC-006; WebAuthn | ДА | ДА: namespaced Minitest matching the domain path | ПРОВЕРЕНО В БЛОКЕ 5S: structure audit and bin/ci 134 tests/610 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-019D | `test/models/policies_test.rb` | deny-by-default and assurance-level Pundit rules | permissions | ДА | ДА: focused Rails/Pundit unit test | ПРОВЕРЕНО В БЛОКЕ 5S: structure audit and bin/ci 134 tests/610 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-020 | `test/models/payments/create_operation_test.rb` | dispatch crash windows and immutable retry | high-risk regression | ДА | ДА: Minitest fault/idempotency/rate-limit coverage | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-021 | `test/models/payments/reconcile_batch_test.rb` | recovery outcomes/manual/defer | high-risk regression | ДА | ДА: Minitest recovery state coverage | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-022 | `test/models/payments/sync_history_page_test.rb` | stale lease/generation/owner rejection | high-risk regression | ДА | ДА: Minitest owner/generation/stale-claim coverage | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-022A | `test/models/platform/platform_operations_test.rb` | readiness aggregation, Redis rate limit and retention allowlist | platform high-risk regression | ДА | ДА: focused namespaced Rails/Minitest operations test | ПРОВЕРЕНО В БЛОКЕ 6G: 6 tests/17 assertions within bin/ci; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-023 | `test/integration/remnashop_contract_test.rb` | RS-001…030 individually against preserved service | integration matrix | В РАБОТЕ: RS-012 реализован; остальные RS добавляются по этапам | ДА: реальный preserved Remnashop endpoint | ПРОВЕРЕНО В БЛОКЕ 4G: RS-012 1 test/2 assertions; ТРЕБУЕТ ДОПОЛНЕНИЯ |
| TEST-024 | `test/integration/remnawave_contract_test.rb` | RW-001…004 against mock | integration matrix | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-025 | `test/integration/telegram_oidc_contract_test.rb` | TG-001…005 including ADR-001 mismatch | integration matrix | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-026 | `test/integration/turnstile_contract_test.rb` | TS-000/001 widget/server modes | integration matrix | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-027 | `test/integration/mailpit_contract_test.rb` | MAIL-001…003, SMTP-001, MP-001…003 through Remnashop | integration matrix | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-028 | `test/integration/redis_contract_test.rb` | REDIS-001…005 exact commands/fallback | integration matrix | ДА | ДА: real container Redis contract without volume reset | ПРОВЕРЕНО В БЛОКЕ 6G: 3 tests/6 assertions and full bin/ci; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TEST-029 | `test/integration/reverse_proxy_contract_test.rb` | trusted forwarding/origin/health routes | reverse proxy | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-030 | `test/integration/concurrency_test.rb` | two-connection refresh/passkey/merge/payment/history races | concurrency requirements | ДА | ДА: PostgreSQL row locks and real two-thread contention | ПРОВЕРЕНО В БЛОКЕ 5G: five two-connection races included in bin/ci, 134 tests/610 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |

## 17. HTTP contract tests: все 44 операции

Каждый файл проверяет method/path, query/path/body, unknown fields, content type, limits, auth, permissions, statuses, headers, cookies/redirect, exact JSON и side effects своей карточки.

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| HTTPTEST-001 | `test/requests/http_001_test.rb` | HTTP-001 contract | HTTP-001 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-002 | `test/requests/http_002_test.rb` | HTTP-002 contract | HTTP-002 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-003 | `test/requests/http_003_test.rb` | HTTP-003 contract | HTTP-003 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-004 | `test/requests/http_004_test.rb` | HTTP-004 contract | HTTP-004 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-005 | `test/requests/http_005_test.rb` | HTTP-005 contract | HTTP-005 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-006 | `test/requests/http_006_test.rb` | HTTP-006 contract | HTTP-006 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-007 | `test/requests/http_007_test.rb` | HTTP-007 contract | HTTP-007 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-008 | `test/requests/http_008_test.rb` | HTTP-008 contract | HTTP-008 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-009 | `test/requests/http_009_test.rb` | HTTP-009 contract | HTTP-009 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-010 | `test/requests/http_010_test.rb` | HTTP-010 contract | HTTP-010 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-011 | `test/requests/http_011_test.rb` | HTTP-011 contract | HTTP-011 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-012 | `test/requests/http_012_test.rb` | HTTP-012 contract | HTTP-012 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-013 | `test/requests/http_013_test.rb` | HTTP-013 contract | HTTP-013 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-014 | `test/requests/http_014_test.rb` | HTTP-014 contract | HTTP-014 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-015 | `test/requests/http_015_test.rb` | HTTP-015 contract | HTTP-015 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-016 | `test/requests/http_016_test.rb` | HTTP-016 contract | HTTP-016 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-017 | `test/requests/http_017_test.rb` | HTTP-017 contract | HTTP-017 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-018 | `test/requests/http_018_test.rb` | HTTP-018 contract | HTTP-018 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-019 | `test/requests/http_019_test.rb` | HTTP-019 contract | HTTP-019 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-020 | `test/requests/http_020_test.rb` | HTTP-020 contract | HTTP-020 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-021 | `test/requests/http_021_test.rb` | HTTP-021 contract | HTTP-021 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-022 | `test/requests/http_022_test.rb` | HTTP-022 contract | HTTP-022 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-023 | `test/requests/http_023_test.rb` | HTTP-023 contract | HTTP-023 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-024 | `test/requests/http_024_test.rb` | HTTP-024 contract | HTTP-024 | ДА | ДА: Rails form/strong parameters/redirect contract | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-025 | `test/requests/http_025_test.rb` | HTTP-025 contract | HTTP-025 | ДА | ДА: Rails form/strong parameters/redirect contract | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-026 | `test/requests/http_026_test.rb` | HTTP-026 contract | HTTP-026 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-027 | `test/requests/http_027_test.rb` | HTTP-027 contract | HTTP-027 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-028 | `test/requests/http_028_test.rb` | HTTP-028 contract | HTTP-028 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-029 | `test/requests/http_029_test.rb` | HTTP-029 contract | HTTP-029 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-030 | `test/requests/http_030_test.rb` | HTTP-030 contract | HTTP-030 | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-031 | `test/requests/http_031_test.rb` | HTTP-031 contract | HTTP-031 | ДА | ДА: server-rendered owner-scoped collection | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-032 | `test/requests/http_032_test.rb` | HTTP-032 contract | HTTP-032 | ДА | ДА: server-rendered owner-scoped member | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-033 | `test/requests/http_033_test.rb` | HTTP-033 contract | HTTP-033 | ДА | ДА: Rails HTML resource/auth contract | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci 153 tests/677 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-034 | `test/requests/http_034_test.rb` | HTTP-034 contract | HTTP-034 | ДА | ДА: exact Jbuilder process probe | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci 153 tests/677 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-035 | `test/requests/http_035_test.rb` | HTTP-035 contract | HTTP-035 | ДА | ДА: exact Jbuilder liveness probe | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci 153 tests/677 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-036 | `test/requests/http_036_test.rb` | HTTP-036 contract | HTTP-036 | ДА | ДА: fail-closed sanitized Jbuilder readiness | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci 153 tests/677 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-037 | `test/requests/http_037_test.rb` | HTTP-037 contract | HTTP-037 | ДА | ДА: constant-time internal detail contract | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci and real dependency readiness; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-038 | `test/requests/http_038_test.rb` | HTTP-038 contract | HTTP-038 | ДА | ДА: isolated authenticated machine JSON boundary | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, 134 tests/610 assertions, RuboCop 184, security audits, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-041 | `test/requests/http_041_test.rb` | HTTP-041 contract | HTTP-041 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-042 | `test/requests/http_042_test.rb` | HTTP-042 contract | HTTP-042 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-043 | `test/requests/http_043_test.rb` | HTTP-043 contract | HTTP-043 | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| HTTPTEST-044 | `test/requests/http_044_test.rb` | HTTP-044 contract and private-cache exclusion | HTTP-044 | ДА | ДА: Rails JS protocol and privacy regression | ПРОВЕРЕНО В БЛОКЕ 6G: bin/ci 153 tests/677 assertions; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |

## 18. System, browser и visual tests

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| SYS-001 | `test/application_system_test_case.rb` | Capybara RackTest server-rendered page harness; browser viewport evidence is separate | visual strategy | ДА | ДА: Rails ActionDispatch system test base без лишней Selenium-зависимости для HTML gate | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: final system rerun |
| SYS-002 | `test/system/page_001_test.rb` | PAGE-001 server-rendered states/actions | PAGE-001 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-003 | `test/system/page_002_test.rb` | PAGE-002 server-rendered states/actions | PAGE-002 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-004 | `test/system/page_003_test.rb` | PAGE-003 server-rendered states/actions | PAGE-003 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-005 | `test/system/page_004_test.rb` | PAGE-004 server-rendered states/actions | PAGE-004 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-006 | `test/system/page_005_test.rb` | PAGE-005 server-rendered states/actions | PAGE-005 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-007 | `test/system/page_006_test.rb` | PAGE-006 server-rendered states/actions | PAGE-006 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-008 | `test/system/page_007_test.rb` | PAGE-007 server-rendered states/actions | PAGE-007 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-009 | `test/system/page_008_test.rb` | PAGE-008 server-rendered states/actions | PAGE-008 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-010 | `test/system/page_009_test.rb` | PAGE-009 server-rendered states/actions | PAGE-009 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-011 | `test/system/page_010_test.rb` | PAGE-010 server-rendered states/actions | PAGE-010 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-012 | `test/system/page_011_test.rb` | PAGE-011 server-rendered states/actions | PAGE-011 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-013 | `test/system/page_012_test.rb` | PAGE-012 server-rendered states/actions | PAGE-012 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-014 | `test/system/page_013_test.rb` | PAGE-013 server-rendered states/actions | PAGE-013 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-015 | `test/system/page_014_test.rb` | PAGE-014 server-rendered states/actions | PAGE-014 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-016 | `test/system/page_015_test.rb` | PAGE-015 server-rendered states/actions | PAGE-015 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-017 | `test/system/page_016_test.rb` | PAGE-016 server-rendered states/actions | PAGE-016 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-018 | `test/system/page_017_test.rb` | PAGE-017 server-rendered states/actions | PAGE-017 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-019 | `test/system/page_018_test.rb` | PAGE-018 server-rendered states/actions | PAGE-018 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-020 | `test/system/page_019_test.rb` | PAGE-019 server-rendered states/actions | PAGE-019 | ДА | ДА: Rails system test | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: ранее зелёный, UI изменён |
| SYS-021 | `test/system/email_purchase_journey_test.rb` | full email→verify→offer→pay→return→cabinet→logout | user journeys/E2E | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-022 | `test/system/telegram_merge_journey_test.rb` | OIDC/WebApp collision→explicit merge/cancel | user journeys/E2E | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-023 | `test/system/subscription_management_journey_test.rb` | URL/copy/devices/reissue/promo/extend | user journeys/E2E | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-024 | `test/system/pwa_privacy_test.rb` | install/update/offline and no private cache | PWA regression | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-025 | `test/visual/visual_comparison_test.rb` | automated 19×desktop/mobile diff and report | GATE-3 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 19. Fixtures

Fixtures содержат только синтетические несекретные данные и соответствуют DB constraints.

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| FIX-001 | `test/fixtures/web_users.yml` | user identity/trust scenarios | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-002 | `test/fixtures/web_sessions.yml` | active/expired/revoked/bootstrap sessions | states | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-003 | `test/fixtures/web_refresh_tokens.yml` | valid/grace/expired predecessors | states | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-004 | `test/fixtures/web_authn_credentials.yml` | multi/single credentials | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-005 | `test/fixtures/web_authn_challenges.yml` | register/login one-time challenges | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-006 | `test/fixtures/telegram_auth_states.yml` | pending/used/expired OIDC states | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-007 | `test/fixtures/email_verification_codes.yml` | pending/exhausted/used codes | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-008 | `test/fixtures/account_merge_confirmations.yml` | pending/leased/completed/failed merge | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-009 | `test/fixtures/payment_operations.yml` | each operation/recovery state | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-010 | `test/fixtures/payment_records.yml` | each normalized payment status | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-011 | `test/fixtures/payment_history_sync_states.yml` | cursor/generation/lease states | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-012 | `test/fixtures/audit_logs.yml` | info/security sanitized entries | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-013 | `test/fixtures/rate_limit_events.yml` | identity/action/window events | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-014 | `test/fixtures/app_settings.yml` | non-secret JSON settings | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| FIX-015 | `test/fixtures/integration_statuses.yml` | unknown/ok/degraded/down/stale | entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 20. Container, prestage и operations files

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| DEPLOY-001 | `Dockerfile` | reproducible Ruby multi-stage image, non-root, no production secrets | runtime/deployment | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-002 | `docker-compose.yml` | сохранённые PostgreSQL/Redis/Remnashop/mocks/volumes unchanged | external tentacles | ДА | Н/П — review Rails app не начат | Н/П — полный stack не проверен |
| DEPLOY-003 | `docker-compose.app.yml` | web app override, port 4000, healthcheck, networks | runtime/deployment | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-004 | `docker-compose.app.yml` | required retention worker and heartbeat healthcheck | BG-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-005 | `docker-compose.app.yml` | optional reconciliation profile and heartbeat healthcheck | BG-002 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-006 | `.env.example` | complete safe dev/prestage app variables plus preserved infra variables | configuration catalog | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-007 | `Makefile` | Rails setup/test/ci commands | acceptance | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-008 | `Makefile` | safe infra/app up/down/status/logs, no volume reset command | operations/safety | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-009 | `scripts/wait-for-compose.sh` | preserve bounded dependency wait | BG-004 | ДА | Н/П — Rails integration не проверена | Н/П — полный stack не проверен |
| DEPLOY-010 | `scripts/wait-for-http.sh` | preserve bounded HTTP wait and failure output | BG-004 | ДА | Н/П — Rails integration не проверена | Н/П — полный stack не проверен |
| DEPLOY-011 | `scripts/validate-env.rb` | strict production `.env` parser and all cross-field rules | configuration catalog | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-012 | `scripts/backup.rb` | PostgreSQL logical backup manifest/checksum | backup/recovery | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-013 | `scripts/restore.rb` | explicit target restore and verification, no implicit overwrite | backup/recovery | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-014 | `deploy/README.md` | operator start/update/rollback/recovery runbook | operations | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DEPLOY-015 | `infra/test/Caddyfile` | preserved proxy routes/forwarding behavior | reverse proxy | ДА | Н/П — Rails upstream не проверен | Н/П — полный stack не проверен |
| DEPLOY-016 | `infra/test/remnawave-mock/server.js` | preserved RW mock behavior | mock services | ДА | Н/П — client не реализован | Н/П — contract test не запущен |
| DEPLOY-017 | `infra/test/telegram-mock/server.js` | preserved Bot API mock behavior | mock services | ДА | Н/П — integration не реализована | Н/П — contract test не запущен |
| DEPLOY-018 | `infra/test/telegram-oidc-mock/server.js` | preserved TG mock and ADR-001 mismatch | mock services/ADR-001 | ДА | Н/П — client не реализован | Н/П — contract test не запущен |
| DEPLOY-019 | `infra/test/mailpit-logger/server.js` | preserved MP-002/003 logger behavior | mock services | ДА | Н/П — integration не реализована | Н/П — contract test не запущен |

## 21. Полные release gates

| ID | Проверка / команда | Объём | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|
| GATE-001 | `bundle exec rubocop` | весь Ruby/Rails/test code | ДА | ДА: RuboCop Rails Omakase | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| GATE-002 | `bin/brakeman` | Rails security scan | ДА | ДА: Brakeman без blanket ignores | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| GATE-003 | `bin/bundler-audit` | dependency vulnerabilities | ДА | ДА: advisory audit без ignores | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| GATE-004 | `RAILS_ENV=test bin/rails db:prepare test` | unit/model/operation tests | ДА | ДА: Rails database/test tasks | ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ: смена входной архитектуры на server-rendered Rails |
| GATE-005 | HTTP contract suite | HTTP-001…044 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-006 | external integration suite | RS/RW/TG/TS/MAIL/SMTP/MP/REDIS/proxy | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-007 | PostgreSQL concurrency suite | refresh/passkey/merge/token/payment/history | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-008 | full system/E2E suite | primary user journeys and all browser states | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-009 | visual suite | 19 desktop + 19 mobile + documented diffs | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-010 | production config/build/start | clean image, strict env, port/network, migrations | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-011 | worker rehearsal | retention/reconciliation leases/signals/heartbeats | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-012 | recovery rehearsal | restart during effects, backup/restore, schema/data verify | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-013 | traceability audit | CAP-01…13, every named interface/page/data item has positive row | ДА: реестр создан | ДА: структура задана | Н/П — реализация отсутствует |
| GATE-014 | zero-gap audit | нет пустых cells, TODO, skipped mandatory test, pending ADR | ДА: cells заполнены | ДА: протокол задан | Н/П — реализация отсутствует |

## 22. Именованное покрытие спецификации

Эта таблица не заменяет атомарные строки выше; она предотвращает потерю целого класса требований.

| Набор | Где реализуется | Где доказывается | Текущий статус |
|---|---|---|---|
| CAP-01…06 Identity | models/identity, auth controllers/views | model + HTTP-001…020/039/041…043 + system | НЕ РЕАЛИЗОВАНО |
| CAP-07…08 Subscription | models/subscriptions, clients, controllers/views | HTTP-021…023/026…030 + integration/system | НЕ РЕАЛИЗОВАНО |
| CAP-09…10 Payments | payment models/operations/controllers/views | HTTP-024/025/031/032/038 + concurrency/fault injection | РЕАЛИЗОВАНО В БЛОКЕ 5G; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-11 Support | support controller/page | HTTP-033, SUP-001…003, PAGE-017 | НЕ РЕАЛИЗОВАНО |
| CAP-12 PWA | PWA controller/views/Stimulus/SW | HTTP-044, BR-005/006, PAGE-018/019 | НЕ РЕАЛИЗОВАНО |
| CAP-13 Operations | health/config/workers/deploy | HTTP-034…038, BG-001…004, production gates | НЕ РЕАЛИЗОВАНО |
| HTTP-001…044 | routes/controllers/Jbuilder | 44 individual request tests | НЕ РЕАЛИЗОВАНО |
| PAGE-001…019 | ERB/CSS/Stimulus | 19 system files × 2 viewports + visual diff | НЕ РЕАЛИЗОВАНО |
| RS-001…030 | Remnashop client | `remnashop_contract_test.rb`, каждая операция отдельно | НЕ РЕАЛИЗОВАНО |
| RW-001…004 | Remnawave client | mock contract test | НЕ РЕАЛИЗОВАНО |
| TG-001…006 | OIDC/payload client + Stimulus | OIDC/WebApp contract/system tests | НЕ РЕАЛИЗОВАНО |
| TS-000/001 | register/profile view + Turnstile client | integration/system tests | НЕ РЕАЛИЗОВАНО |
| MAIL-001…003, SMTP-001, MP-001…003 | Remnashop boundary + readiness | Mailpit integration flow | НЕ РЕАЛИЗОВАНО |
| BR-001…011 | ERB/Stimulus/PWA/support | system/browser privacy tests | НЕ РЕАЛИЗОВАНО |
| REDIS-001…005 | Redis store/rate/readiness | Redis contract and degradation tests | НЕ РЕАЛИЗОВАНО |
| SUP-001…003 | support config/controller/page | HTTP-033/PAGE-017 system test | НЕ РЕАЛИЗОВАНО |
| 15 models / 9 enums / 15 migrations | db/migrate + Active Record | schema, constraints, migration upgrade tests | НЕ РЕАЛИЗОВАНО |
| GATE-1…6 спецификации | вся реализация | GATE-001…014 этого плана | НЕ ПРОЙДЕНО |

## 23. Атомарный реестр именованных контрактов

Диапазон в сводной таблице не заменяет отдельный статус. Поэтому каждый именованный контракт, кроме уже разложенных выше HTTP-001…044 и PAGE-001…019, имеет собственную строку ниже.

| Контракт | Целевой файл | Отдельно проверяемая feature | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|
| CAP-01 | `app/models/identity/email_authentication.rb` | определение способа входа | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-02 | `app/models/identity/email_authentication.rb` | регистрация и вход по почте | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-03 | `app/models/identity/email_verification.rb` | подтверждение и изменение почты | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-04 | `app/models/identity/telegram_authentication.rb` | Telegram login/link | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-05 | `app/models/identity/passkey_ceremony.rb` | passkey register/login/list/delete | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-06 | `app/models/identity/account_merge.rb` | способы входа и объединение владельцев | ДА | ДА: Rails 8.1 models/resources, ADR-003, thin controllers | ПРОВЕРЕНО В БЛОКЕ 3G: full suite 96 tests/438 assertions, RuboCop 146 files, Zeitwerk; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-07 | `app/models/subscriptions/catalog.rb` | публичный и персональный каталог | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-08 | `app/models/subscriptions/current_access.rb` | подписка, URL, устройства, reissue, promo | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-09 | `app/models/payments/create_operation.rb` | покупка и продление без повтора эффекта | ДА | ДА: signed server state, durable operation and PostgreSQL lock | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, concurrency/fault tests; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-10 | `app/models/payments/reconcile_batch.rb` | история, durable result и reconciliation | ДА | ДА: bounded fenced Rails operations and owner-scoped history | ПРОВЕРЕНО В БЛОКЕ 5G: bin/ci, concurrency/fault tests; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| CAP-11 | `app/controllers/supports_controller.rb` | support contacts | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-12 | `app/views/pwa/service_worker.js.erb` | install/update/offline/privacy | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-13 | `app/models/platform/readiness_check.rb` | health/readiness/audit/retention/recovery | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-001 | `app/models/integrations/remnashop_client.rb` | register | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-002 | `app/models/integrations/remnashop_client.rb` | login | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-003 | `app/models/integrations/remnashop_client.rb` | Telegram auth | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-004 | `app/models/integrations/remnashop_client.rb` | Telegram WebApp auth | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-005 | `app/models/integrations/remnashop_client.rb` | refresh auth cookies | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-006 | `app/models/integrations/remnashop_client.rb` | change password | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-007 | `app/models/integrations/remnashop_client.rb` | current upstream profile | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-008 | `app/models/integrations/remnashop_client.rb` | link Telegram | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-009 | `app/models/integrations/remnashop_client.rb` | request e-mail verification | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-010 | `app/models/integrations/remnashop_client.rb` | confirm e-mail verification | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-011 | `app/models/integrations/remnashop_client.rb` | change e-mail | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-012 | `app/models/integrations/remnashop_client.rb` | public plans | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-013 | `app/models/integrations/remnashop_client.rb` | current subscription | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-014 | `app/models/integrations/remnashop_client.rb` | personal offers | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-015 | `app/models/integrations/remnashop_client.rb` | purchase dispatch | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-016 | `app/models/integrations/remnashop_client.rb` | extension dispatch | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-017 | `app/models/integrations/remnashop_client.rb` | subscription reissue | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-018 | `app/models/integrations/remnashop_client.rb` | promocode activation | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-019 | `app/models/integrations/remnashop_client.rb` | devices index | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-020 | `app/models/integrations/remnashop_client.rb` | destroy all devices | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-021 | `app/models/integrations/remnashop_client.rb` | destroy one encoded hwid | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-022 | `app/models/integrations/remnashop_client.rb` | subscription capabilities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-023 | `app/models/integrations/remnashop_client.rb` | cursor transaction page | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-024 | `app/models/integrations/remnashop_client.rb` | transaction by payment id | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-025 | `app/models/integrations/remnashop_client.rb` | legacy transaction history | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-026 | `app/models/integrations/remnashop_client.rb` | public payment recovery read | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-027 | `app/models/integrations/remnashop_client.rb` | public payment recovery trigger | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-028 | `app/models/integrations/remnashop_client.rb` | admin user merge | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-029 | `app/models/integrations/remnashop_client.rb` | admin payment recovery read | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RS-030 | `app/models/integrations/remnashop_client.rb` | admin payment recovery trigger | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RW-001 | `app/models/integrations/remnawave_client.rb` | user lookup by UUID | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| RW-002 | `app/models/integrations/remnawave_client.rb` | users lookup by e-mail | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| RW-003 | `app/models/integrations/remnawave_client.rb` | users lookup by Telegram ID | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| RW-004 | `app/models/integrations/remnawave_client.rb` | readiness metadata | ДА | ДА: Rails resources/domain operations, ADR-003, verified external boundary | ПРОВЕРЕНО В БЛОКЕ 4G: full suite 113 tests/505 assertions, RuboCop 167 files, Zeitwerk, preserved Remnashop/Remnawave smoke; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| TG-001 | `app/models/integrations/telegram_oidc_client.rb` | authorization redirect/PKCE | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TG-002 | `app/models/integrations/telegram_oidc_client.rb` | authorization code exchange | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TG-003 | `app/models/integrations/telegram_oidc_client.rb` | JWKS/ID token/nonce | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TG-004 | `app/models/integrations/telegram_payload.rb` | popup/widget payload | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TG-005 | `app/models/integrations/telegram_payload.rb` | identity conversion to Remnashop | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TG-006 | `app/javascript/controllers/telegram_webapp_controller.js` | Telegram WebApp SDK | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TS-000 | `app/views/pages/register.html.erb` | browser Turnstile widget | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TS-001 | `app/models/integrations/turnstile_client.rb` | server-side siteverify | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MAIL-001 | `app/models/identity/email_verification.rb` | request code through Remnashop | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MAIL-002 | `app/models/identity/email_verification.rb` | confirm code through Remnashop | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MAIL-003 | `app/models/identity/email_verification.rb` | change address through Remnashop | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SMTP-001 | `test/integration/mailpit_contract_test.rb` | observe Remnashop→SMTP delivery boundary | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MP-001 | `app/models/integrations/mailpit_client.rb` | optional Mailpit readiness | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MP-002 | `test/integration/mailpit_contract_test.rb` | Mailpit webhook logger event | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MP-003 | `test/integration/mailpit_contract_test.rb` | Mailpit API message enrichment | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-001 | `app/javascript/controllers/payment_controller.js` | navigate to payment URL | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-002 | `app/javascript/controllers/clipboard_controller.js` | clipboard subscription URL | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-003 | `app/javascript/controllers/passkey_controller.js` | navigator.credentials.create | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-004 | `app/javascript/controllers/passkey_controller.js` | navigator.credentials.get | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-005 | `app/javascript/controllers/pwa_install_controller.js` | beforeinstallprompt | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-006 | `app/views/pwa/service_worker.js.erb` | Service Worker/Cache/fetch privacy | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-007 | `app/javascript/controllers/payment_controller.js` | localStorage payment correlation | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-008 | `app/javascript/controllers/payment_controller.js` | sessionStorage idempotency/WebApp state | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-009 | `app/views/layouts/application.html.erb` | safe same-origin logo request | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-010 | `app/views/supports/show.html.erb` | mailto/t.me system handlers | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-011 | `app/javascript/controllers/telegram_webapp_controller.js` | Telegram openLink/fallback | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| REDIS-001 | `app/models/integrations/redis_store.rb` | PING/PONG | ДА | ДА: redis-rb exact contract | ПРОВЕРЕНО В БЛОКЕ 6G: real Redis; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| REDIS-002 | `app/models/integrations/redis_store.rb` | EVAL rate counter | ДА | ДА: atomic Lua | ПРОВЕРЕНО В БЛОКЕ 6G: real Redis; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| REDIS-003 | `app/models/integrations/redis_store.rb` | TTL Retry-After | ДА | ДА: bounded TTL | ПРОВЕРЕНО В БЛОКЕ 6G: real Redis; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| REDIS-004 | `app/models/integrations/redis_store.rb` | SET readiness EX 120 | ДА | ДА: JSON snapshot TTL | ПРОВЕРЕНО В БЛОКЕ 6G: real Redis; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| REDIS-005 | `app/models/integrations/redis_store.rb` | GET readiness | ДА | ДА: bounded JSON read | ПРОВЕРЕНО В БЛОКЕ 6G: real Redis; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| SUP-001 | `app/views/supports/show.html.erb` | support e-mail | ДА | ДА: Rails mail_to | ПРОВЕРЕНО В БЛОКЕ 6G: HTML request; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| SUP-002 | `app/views/supports/show.html.erb` | support Telegram | ДА | ДА: escaped safe t.me link | ПРОВЕРЕНО В БЛОКЕ 6G: HTML request; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| SUP-003 | `app/views/supports/show.html.erb` | support FAQ | ДА | ДА: validated HTTPS config link | ПРОВЕРЕНО В БЛОКЕ 6G: HTML request; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА |
| BG-001 | `app/models/platform/retention_runner.rb` | retention process | ДА | ДА: Rails interval runner and allowlist batch | ПРОВЕРЕНО В БЛОКЕ 6G: component tests; ТРЕБУЕТ PROCESS REHEARSAL И ФИНАЛЬНОГО ЦИКЛА |
| BG-002 | `app/models/platform/reconciliation_runner.rb` | reconciliation process | ДА | ДА: Rails internal HTTP runner | ПРОВЕРЕНО В БЛОКЕ 6G: schema/component tests; ТРЕБУЕТ PROCESS REHEARSAL И ФИНАЛЬНОГО ЦИКЛА |
| BG-003 | `app/models/platform/migration_runner.rb` | migration/start command | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BG-004 | `lib/tasks/prestage.rake` | controlled E2E runner | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-1 | `TECHNICAL_IMPLEMENTATION_PLAN.md` | behavioral reproducibility gate | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-2 | `TECHNICAL_IMPLEMENTATION_PLAN.md` | end-to-end interaction traceability gate | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-3 | `test/visual/visual_comparison_test.rb` | visual preservation gate | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-4 | `TECHNICAL_IMPLEMENTATION_PLAN.md` | independence from deleted sources gate | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-5 | `bin/ci` | completeness/conflict verification gate | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-6 | `TECHNICAL_IMPLEMENTATION_PLAN.md` | final physical evidence manifest gate | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 24. Журнал полных циклов

| Cycle | Дата/commit | Static | Unit | HTTP | Integrations | Concurrency | E2E | Visual | Production/recovery | Итог |
|---:|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-07-23, только план | Н/П | Н/П | Н/П | Н/П | Н/П | Н/П | Н/П | Н/П | НЕ ГОТОВО |

Новая строка добавляется перед запуском полного цикла. Cycle считается действительным только после заполнения всех cells точными командами/артефактами и только если ни одна атомарная строка выше не имеет отрицательного или непроверенного статуса.
