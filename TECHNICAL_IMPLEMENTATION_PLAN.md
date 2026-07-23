# Clean Pay: технический план Ruby on Rails монолита

## 0. Состояние плана

| Поле | Значение |
|---|---|
| Общий статус | `НЕ ГОТОВО` |
| Текущий полный verification cycle | `0 — реализация не начата` |
| Источник правил Ruby/Rails | `RUBY_RAILS_RULES.md` |
| Нормативный продуктовый источник | `software-spec/` |
| Старое приложение | `намеренно удалено; не проверяется и не восстанавливается` |
| Положительных строк | `0` |
| Строк с отрицательным/непроверенным статусом | `все строки ниже` |
| Условие готовности | `три положительных статуса у каждой строки в одном полном цикле` |

Этот файл одновременно является:

- целевым деревом новой реализации;
- атомарным backlog;
- матрицей соответствия Rails-правилам;
- журналом доказательств работоспособности.

Файл или feature нельзя добавлять в реализацию без добавления отдельной строки сюда. Сгенерированный Rails-файл, который не нужен, удаляется; нужный — сначала вносится в реестр. Одна строка описывает одну проверяемую обязанность. Если в одном файле несколько обязанностей, путь повторяется в нескольких строках.

## 1. Значения статусов

| Колонка | Допустимые значения |
|---|---|
| ИМПЛЕМЕНТИРОВАНО | `НЕТ`; `В РАБОТЕ`; `ДА`; `Н/П: причина` |
| СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | `Н/П — нет реализации`; `НЕТ: причина`; `ДА: review/commit`; `ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ` |
| РАБОТАЕТ | `Н/П — нет реализации`; `НЕТ: ошибка`; `ДА: цикл N, команда/тест`; `ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ` |

В таблицах ниже начальное состояние заполнено явно. `Н/П — нет реализации` не является положительным результатом.

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
| 1 | Rails skeleton и зависимости | этот план принят | clean boot, lint, security scan |
| 2 | конфигурация и итоговая PostgreSQL schema | этап 1 | все migrations/constraints/indexes проверены |
| 3 | identity/session/WebAuthn/Telegram | этап 2 | HTTP-001…020, 039, 041…043 и concurrency |
| 4 | subscriptions и внешние каталоги | этап 3 | HTTP-021…023, 026…030 и degradation |
| 5 | payments и recovery | этап 4 | HTTP-024/025/031/032/038 и fault injection |
| 6 | platform/health/workers/PWA | этап 5 | HTTP-033…037/040/044, BG-001…004 |
| 7 | 19 server-rendered UI routes | этап 6 | system, accessibility и visual checks |
| 8 | контейнеры, deploy и recovery | этап 7 | clean prestage, backup/restore/restart |
| 9 | полный cycle | этап 8 | все строки зелёные в одном cycle |

## 3. Корень проекта и dependency manifest

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| ROOT-001 | `.ruby-version` | точный Ruby `4.0.6` | Ruby releases; правила §3 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-002 | `Gemfile` | Rails `8.1.3`, pg, Puma и Rails defaults | правила §3, §5 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-003 | `Gemfile` | Pundit, Faraday, JWT/OIDC, WebAuthn, AASM, Redis | правила §5; `04-integrations/` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-004 | `Gemfile` | test/style/security gems без application Node toolchain | правила §5, §7 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-005 | `Gemfile.lock` | полностью зафиксированный dependency graph | правила §3 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-006 | `Rakefile` | стандартная загрузка Rails tasks без бизнес-логики | Rails skeleton | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-007 | `config.ru` | стандартный Rack entrypoint Rails application | Rails skeleton | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-008 | `.rubocop.yml` | RuboCop Rails Omakase, только объяснённые overrides | правила §6 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-009 | `.gitignore` | Rails secrets, logs, tmp, coverage, screenshots; assets/spec не скрываются | security; visual contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-010 | `.gitattributes` | text/binary и стабильные line endings для Ruby/assets | repository hygiene | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-011 | `.dockerignore` | исключить secrets/cache/test output, включить runtime assets | `07-operations/runtime-and-deployment.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-012 | `README.md` | Ruby quick start, источники истины, безопасная работа с volumes | system/operations | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROOT-013 | `RUBY_RAILS_RULES.md` | актуализируемый архитектурный контракт | этот файл | ДА | ДА: документ правил | ДА: проверено чтением, цикл 0 |
| ROOT-014 | `TECHNICAL_IMPLEMENTATION_PLAN.md` | полный file/feature ledger и status protocol | запрос пользователя | ДА | ДА: документ правил | ДА: проверено чтением, цикл 0 |

## 4. Исполняемые команды

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| BIN-001 | `bin/rails` | стандартный Rails launcher | Rails generator | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BIN-002 | `bin/rake` | стандартный Rake launcher | Rails generator | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BIN-003 | `bin/setup` | idempotent bundle, DB prepare, tmp cleanup без reset volumes | `07-operations/`; правила §4.3 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BIN-004 | `bin/dev` | development Puma/asset startup на изолированном runtime | `07-operations/runtime-and-deployment.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BIN-005 | `bin/ci` | Rails 8.1 local CI: style, security, tests, schema checks | `08-quality/acceptance-strategy.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BIN-006 | `bin/rubocop` | locked Bundler execution | правила §6 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BIN-007 | `bin/brakeman` | security scan без permanent blanket ignores | `08-quality/security.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BIN-008 | `bin/bundler-audit` | gem vulnerability scan | `08-quality/security.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BIN-009 | `bin/docker-entrypoint` | config validation, advisory migration lock, exec Puma | BG-003; runtime/deployment | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BIN-010 | `bin/retention` | BG-001 long-running Rails process | BG-001; retention | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BIN-011 | `bin/reconciliation` | BG-002 long-running Rails process | BG-002; background jobs | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 5. Rails boot и configuration

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| CFG-001 | `config/boot.rb` | Bundler/bootsnap boot стандартного Rails app | Rails generator | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-002 | `config/application.rb` | Rails 8.1 defaults, UTC, `ru`, four namespaces | правила §3–4 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-003 | `config/application.rb` | отключены только неиспользуемые Cable/Mailbox/Text/Storage frameworks | `02-interfaces/files.md`, `events.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-004 | `config/environment.rb` | стандартная инициализация application | Rails generator | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-005 | `config/environments/development.rb` | dev caching/CSP/logging без production weakening | runtime isolation | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-006 | `config/environments/test.rb` | deterministic tests, no external production calls | acceptance strategy | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-007 | `config/environments/production.rb` | force SSL/proxy, JSON logs, cache, no secrets in image | runtime/security | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-008 | `config/database.yml` | PostgreSQL URL, pool per process, UTC, no silent fallback | `06-data/storage-model.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-009 | `config/puma.rb` | port 4000, threads/workers, graceful shutdown | runtime/deployment | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-010 | `config/cache.yml` | Redis readiness/rate/cache namespaces and TTL rules | REDIS-001…005 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-011 | `config/initializers/app_config.rb` | typed strict runtime configuration object | `02-interfaces/configuration.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-012 | `config/initializers/filter_parameter_logging.rb` | recursive secret aliases redaction | sensitive-data; observability | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-013 | `config/initializers/content_security_policy.rb` | production CSP, nonce, exact external origins | security; browser/PWA | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-014 | `config/initializers/permissions_policy.rb` | WebAuthn/clipboard/browser permissions | BR-002…006 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-015 | `config/initializers/active_record_encryption.rb` | encrypted Remnashop tokens, key separation | sensitive-data | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-016 | `config/initializers/faraday.rb` | shared adapters, timeouts, instrumentation, safe retry policy | `04-integrations/` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-017 | `config/initializers/redis.rb` | pooled redis-client, namespacing, bounded responses | storage integration | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-018 | `config/initializers/pundit.rb` | deny-by-default policy verification | permissions docs | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-019 | `config/initializers/strong_migrations.rb` | migration safety checks | `06-data/migrations.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-020 | `config/initializers/structured_events.rb` | Rails.event subscribers and stable JSON event schema | `07-operations/observability.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-021 | `config/locales/ru.yml` | все общие русские labels/messages/errors | `05-frontend/`; HTTP cards | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-022 | `config/locales/models.ru.yml` | model/validation/domain translations | module errors | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CFG-023 | `config/credentials.yml.enc` | только безопасные local/test Rails credentials; production secrets приходят из ENV | rules §4.6; deployment | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 6. Маршруты: все 44 HTTP-операции и 19 страниц

Каждая строка ниже — отдельная feature одного файла `config/routes.rb`.

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| ROUTE-001 | `config/routes.rb` | HTTP-001 `POST /api/bff/auth/identify` | HTTP-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-002 | `config/routes.rb` | HTTP-002 `POST /api/bff/auth/login` | HTTP-002 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-003 | `config/routes.rb` | HTTP-003 `POST /api/bff/auth/register` | HTTP-003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-004 | `config/routes.rb` | HTTP-004 `GET /api/bff/auth/me` | HTTP-004 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-005 | `config/routes.rb` | HTTP-005 `POST /api/bff/auth/logout` | HTTP-005 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-006 | `config/routes.rb` | HTTP-006 `POST /api/bff/auth/change-password` | HTTP-006 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-007 | `config/routes.rb` | HTTP-007 `POST /api/bff/auth/email/request-verification` | HTTP-007 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-008 | `config/routes.rb` | HTTP-008 `POST /api/bff/auth/email/confirm` | HTTP-008 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-009 | `config/routes.rb` | HTTP-009 `POST /api/bff/auth/email/change` | HTTP-009 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-010 | `config/routes.rb` | HTTP-010 passkey register options | HTTP-010 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-011 | `config/routes.rb` | HTTP-011 passkey register verify | HTTP-011 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-012 | `config/routes.rb` | HTTP-012 passkey login options | HTTP-012 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-013 | `config/routes.rb` | HTTP-013 passkey login verify | HTTP-013 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-014 | `config/routes.rb` | HTTP-014 credentials index | HTTP-014 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-015 | `config/routes.rb` | HTTP-015 credential destroy by id | HTTP-015 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-016 | `config/routes.rb` | HTTP-016 Telegram WebApp login | HTTP-016 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-017 | `config/routes.rb` | HTTP-017 merge confirmation show | HTTP-017 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-018 | `config/routes.rb` | HTTP-018 merge confirmation update | HTTP-018 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-019 | `config/routes.rb` | HTTP-019 merge confirmation destroy | HTTP-019 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-020 | `config/routes.rb` | HTTP-020 link Remnashop | HTTP-020 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-021 | `config/routes.rb` | HTTP-021 public plans | HTTP-021 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-022 | `config/routes.rb` | HTTP-022 current subscription | HTTP-022 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-023 | `config/routes.rb` | HTTP-023 offers | HTTP-023 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-024 | `config/routes.rb` | HTTP-024 purchase command | HTTP-024 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-025 | `config/routes.rb` | HTTP-025 extend command | HTTP-025 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-026 | `config/routes.rb` | HTTP-026 subscription reissue | HTTP-026 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-027 | `config/routes.rb` | HTTP-027 promocode | HTTP-027 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-028 | `config/routes.rb` | HTTP-028 devices index | HTTP-028 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-029 | `config/routes.rb` | HTTP-029 all devices destroy | HTTP-029 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-030 | `config/routes.rb` | HTTP-030 one device destroy by hwid | HTTP-030 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-031 | `config/routes.rb` | HTTP-031 payment history | HTTP-031 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-032 | `config/routes.rb` | HTTP-032 payment status | HTTP-032 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-033 | `config/routes.rb` | HTTP-033 support | HTTP-033 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-034 | `config/routes.rb` | HTTP-034 health | HTTP-034 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-035 | `config/routes.rb` | HTTP-035 liveness | HTTP-035 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-036 | `config/routes.rb` | HTTP-036 public readiness | HTTP-036 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-037 | `config/routes.rb` | HTTP-037 internal readiness | HTTP-037 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-038 | `config/routes.rb` | HTTP-038 internal payment reconciliation | HTTP-038 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-039 | `config/routes.rb` | HTTP-039 legacy me | HTTP-039 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-040 | `config/routes.rb` | HTTP-040 legacy logout | HTTP-040 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-041 | `config/routes.rb` | HTTP-041 Telegram start | HTTP-041 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-042 | `config/routes.rb` | HTTP-042 Telegram GET callback | HTTP-042 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-043 | `config/routes.rb` | HTTP-043 Telegram POST callback | HTTP-043 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-044 | `config/routes.rb` | HTTP-044 `/sw.js` | HTTP-044 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-045 | `config/routes.rb` | PAGE-001 `GET /` | PAGE-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-046 | `config/routes.rb` | PAGE-002 `GET /login` | PAGE-002 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-047 | `config/routes.rb` | PAGE-003 `GET /register` | PAGE-003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-048 | `config/routes.rb` | PAGE-004 `GET /register/verify-email` | PAGE-004 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-049 | `config/routes.rb` | PAGE-005 `GET /verify-email` | PAGE-005 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-050 | `config/routes.rb` | PAGE-006 `GET /auth/telegram/webapp` | PAGE-006 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-051 | `config/routes.rb` | PAGE-007 `GET /passkey/setup` | PAGE-007 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-052 | `config/routes.rb` | PAGE-008 `GET /cabinet` | PAGE-008 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-053 | `config/routes.rb` | PAGE-009 `GET /tariffs` | PAGE-009 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-054 | `config/routes.rb` | PAGE-010 `GET /payment` | PAGE-010 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-055 | `config/routes.rb` | PAGE-011 `GET /extend` | PAGE-011 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-056 | `config/routes.rb` | PAGE-012 `GET /payment/success` | PAGE-012 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-057 | `config/routes.rb` | PAGE-013 `GET /payment/fail` | PAGE-013 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-058 | `config/routes.rb` | PAGE-014 `GET /payment/pending` | PAGE-014 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-059 | `config/routes.rb` | PAGE-015 `GET /profile` | PAGE-015 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-060 | `config/routes.rb` | PAGE-016 `GET /link-account` | PAGE-016 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-061 | `config/routes.rb` | PAGE-017 `GET /support` | PAGE-017 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-062 | `config/routes.rb` | PAGE-018 `GET /install` | PAGE-018 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-063 | `config/routes.rb` | PAGE-019 `GET /offline` | PAGE-019 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-064 | `config/routes.rb` | dynamic `/manifest.webmanifest` and static assets | files/PWA | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ROUTE-065 | `config/routes.rb` | unmatched/method mismatch behavior без catch-all masking | error contracts | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 7. Миграции и schema

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| DB-001 | `db/migrate/20260619145932_create_core_records.rb` | users, sessions, audit, rate limits, settings, integrations | migration 1 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-002 | `db/migrate/20260619153000_split_session_expirations_and_add_email_codes.rb` | access/refresh expirations и email codes под lock | migration 2 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-003 | `db/migrate/20260619154500_add_telegram_profile_and_auth_states.rb` | Telegram profile/OIDC state и guarded type conversion | migration 3 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-004 | `db/migrate/20260619161000_add_encrypted_remnashop_tokens_to_sessions.rb` | encrypted upstream tokens/expirations | migration 4 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-005 | `db/migrate/20260619202616_create_payment_records.rb` | payment status enum/records | migration 5 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-006 | `db/migrate/20260623214000_store_telegram_ids_as_text.rb` | lossless Telegram ID text | migration 6 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-007 | `db/migrate/20260623222500_add_auth_method_to_sessions.rb` | EMAIL/TELEGRAM auth method | migration 7 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-008 | `db/migrate/20260624213519_add_passkeys_and_session_trust.rb` | PASSKEY, trust, credentials, challenges | migration 8 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-009 | `db/migrate/20260624213935_add_auth_pending_to_users.rb` | non-null default false auth pending | migration 9 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-010 | `db/migrate/20260717223000_create_payment_operations.rb` | idempotent operations and record link | migration 10 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-011 | `db/migrate/20260718000000_add_payment_reconciliation_and_history_sync.rb` | chronology, leases, cursor generation, checks | migration 11 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-012 | `db/migrate/20260718141000_remove_redundant_indexes.rb` | three indexes, 5s lock timeout, atomic rollback | migration 12 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-013 | `db/migrate/20260719003000_create_account_merge_confirmations.rb` | merge states, lease, expiry indexes | migration 13 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-014 | `db/migrate/20260720233000_create_refresh_token_predecessors.rb` | rotation time, predecessor digest, encrypted successor/grace | migration 14 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-015 | `db/migrate/20260721020000_add_pending_owner_evidence_to_users.rb` | pending Remnashop owner/email evidence and index | migration 15 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-016 | `db/schema.rb` | generated exact 15-table/9-enum final schema | `06-data/`; regression requirements | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DB-017 | `db/seeds.rb` | idempotent non-secret development seed only | data/security | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 8. Active Record models

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| MODEL-001 | `app/models/application_record.rb` | abstract Rails base без глобальных business callbacks | правила §4.4 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-002 | `app/models/web_user.rb` | normalized unique email, Telegram/Remnashop identities, profile | entities/invariants | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-003 | `app/models/web_user.rb` | associations/deletion restrictions and ownership root | relationships/ownership | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-004 | `app/models/web_session.rb` | access/refresh lifecycle, trust, auth method, revocation | states/lifecycles | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-005 | `app/models/web_session.rb` | encrypted exclusive custody of Remnashop tokens | ownership/sensitive-data | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-006 | `app/models/web_refresh_token.rb` | predecessor digest, grace and encrypted same successor | refresh lifecycle | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-007 | `app/models/web_authn_credential.rb` | credential/public key/counter/transports and last-key guard | WebAuthn; invariant 5 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-008 | `app/models/web_authn_challenge.rb` | register/login type, expiry, atomic one-time consume | one-time entities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-009 | `app/models/telegram_auth_state.rb` | state/nonce/verifier digests, safe return, consume | TG-001…003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-010 | `app/models/email_verification_code.rb` | digest, attempts, resend/expiry/use lifecycle | MAIL-001…003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-011 | `app/models/account_merge_confirmation.rb` | AASM states, token, lease, idempotent completion | merge states/lifecycle | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-012 | `app/models/payment_operation.rb` | immutable request/idempotency/owner fingerprints | payment invariants | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-013 | `app/models/payment_operation.rb` | READY/DISPATCHING/terminal/unknown transitions and lease | payment states | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-014 | `app/models/payment_record.rb` | normalized status, immutable local ID, latest upstream snapshot | payment lifecycle | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-015 | `app/models/payment_history_sync_state.rb` | cursor, generation, owner fence, lease/next attempt | history lifecycle | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-016 | `app/models/audit_log.rb` | immutable sanitized durable event and severity | observability | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-017 | `app/models/rate_limit_event.rb` | durable identity/action evidence and retention scope | rate limits/storage | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-018 | `app/models/app_setting.rb` | typed key + JSON value without secret misuse | entities/config | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| MODEL-019 | `app/models/integration_status.rb` | UNKNOWN/OK/DEGRADED/DOWN snapshot and staleness | health/states | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 9. Value objects, policies и cross-aggregate operations

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| DOM-001 | `app/models/email_address.rb` | trim/lower/validate canonical email | value objects | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-002 | `app/models/safe_return_path.rb` | one-root-relative path, reject `//`, slash, NUL, external origin | value objects/global rules | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-003 | `app/models/idempotency_key.rb` | UUID validation and keyed digest | payment invariants | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-004 | `app/models/confirmed_offer.rb` | amount≤8 decimals, currency/version/duration exact match | value objects/payment | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-005 | `app/models/money_amount.rb` | BigDecimal parse and DECIMAL(12,2) final fit without rounding | data constraints | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-006 | `app/models/operation_context.rb` | explicit request/worker audit context | runtime observability | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-007 | `app/models/current.rb` | Rails CurrentAttributes user/session/request context | rules §4.6 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-008 | `app/models/identity/session_authenticator.rb` | access verify, refresh rotation, grace replay, compromise revoke | IAM-SC-002; concurrency | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-009 | `app/models/identity/email_authentication.rb` | identify/login/register and upstream token custody | IAM-SC-001…003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-010 | `app/models/identity/email_verification.rb` | request/confirm/change and partial merge continuation | IAM rules; MAIL operations | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-011 | `app/models/identity/passkey_ceremony.rb` | WebAuthn options/verify/register/login/counter | IAM-SC-006; BR-003/004 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-012 | `app/models/identity/telegram_authentication.rb` | OIDC/WebApp/popup verification and local identity resolution | IAM-SC-004/005; TG-001…006 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-013 | `app/models/identity/account_merge.rb` | stable locks, explicit evidence, owner-fenced child transfer | IAM-SC-008; consistency | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-014 | `app/models/subscriptions/catalog.rb` | public plans and exact personal offers | SUB-SC-001; RS-012/014 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-015 | `app/models/subscriptions/current_access.rb` | upstream subscription plus authoritative Remnawave URL | SUB-SC-002; RW-001…003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-016 | `app/models/subscriptions/device_management.rb` | list/delete one/delete all/reload | SUB-SC-003; RS-019…021 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-017 | `app/models/subscriptions/account_actions.rb` | reissue/promocode with degradation/audit | SUB-SC-004/005 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-018 | `app/models/payments/create_operation.rb` | offer recheck, immutable idempotency, pre-dispatch commit | PAY-SC-001…004 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-019 | `app/models/payments/create_operation.rb` | success/final failure/unknown outcome persistence | payment lifecycle | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-020 | `app/models/payments/reconcile_batch.rb` | claim unknown operations, observe, settle/defer/manual | PAY-SC-004; BG-002 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-021 | `app/models/payments/sync_history_page.rb` | cursor lease/generation/owner-fenced idempotent upsert | PAY-SC-005/006 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-022 | `app/models/platform/readiness_check.rb` | parallel dependency fan-out, 5s/8s budgets, sanitized result | health/readiness | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-023 | `app/models/platform/rate_limiter.rb` | Redis atomic counter + PostgreSQL evidence/fallback | REDIS-002/003; security | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-024 | `app/models/platform/audit_writer.rb` | sanitized durable audit and non-rollback failure event | observability | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| DOM-025 | `app/models/platform/retention_batch.rb` | bounded idempotent deletion of allowed categories only | retention; BG-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
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
| INT-003 | `app/models/integrations/remnashop_client.rb` | RS-012…014 plans/current/offers | `remnashop-operations.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-004 | `app/models/integrations/remnashop_client.rb` | RS-015…021 purchase/extend/reissue/promo/devices | `remnashop-operations.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-005 | `app/models/integrations/remnashop_client.rb` | RS-022…027 capabilities/history/recovery public | `remnashop-operations.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-006 | `app/models/integrations/remnashop_client.rb` | RS-028…030 admin merge/payment recovery | `remnashop-operations.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-007 | `app/models/integrations/remnashop_client.rb` | auth-cookie jar refresh/transfer and exact error normalization | `remnashop.md`; errors | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-008 | `app/models/integrations/remnawave_client.rb` | RW-001 UUID lookup | `remnawave.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-009 | `app/models/integrations/remnawave_client.rb` | RW-002 email lookup | `remnawave.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-010 | `app/models/integrations/remnawave_client.rb` | RW-003 Telegram lookup | `remnawave.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-011 | `app/models/integrations/remnawave_client.rb` | RW-004 readiness metadata | `remnawave.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-012 | `app/models/integrations/telegram_oidc_client.rb` | TG-001 authorization + PKCE | `telegram.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-013 | `app/models/integrations/telegram_oidc_client.rb` | TG-002 code exchange | `telegram.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-014 | `app/models/integrations/telegram_oidc_client.rb` | TG-003 discovery/JWKS/ID token/nonce validation | `telegram.md`; ADR-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-015 | `app/models/integrations/telegram_payload.rb` | TG-004 popup/widget signed payload verification | `telegram.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-016 | `app/models/integrations/telegram_payload.rb` | TG-005 verified identity mapping to Remnashop | `telegram.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-017 | `app/models/integrations/turnstile_client.rb` | TS-001 form-encoded verification and failure mapping | `turnstile.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-018 | `app/models/integrations/mailpit_client.rb` | MP-001 optional readiness only | `mailpit-smtp.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-019 | `app/models/integrations/redis_store.rb` | REDIS-001 PING | `storage.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-020 | `app/models/integrations/redis_store.rb` | REDIS-002 EVAL counter and expiry | `storage.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-021 | `app/models/integrations/redis_store.rb` | REDIS-003 TTL Retry-After | `storage.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-022 | `app/models/integrations/redis_store.rb` | REDIS-004 SET readiness JSON EX 120 | `storage.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| INT-023 | `app/models/integrations/redis_store.rb` | REDIS-005 GET readiness bounded JSON | `storage.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 11. Controllers и transport concerns

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| CTRL-001 | `app/controllers/application_controller.rb` | request context, Pundit, CSRF/origin, shared secure behavior | global/security | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-002 | `app/controllers/concerns/api_rendering.rb` | exact success/error envelopes and exception mapping | error contracts | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-003 | `app/controllers/concerns/session_authentication.rb` | cookie parse/refresh/current session and exact clearing | HTTP auth common | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-004 | `app/controllers/api/bff/auth/identities_controller.rb` | HTTP-001 identify | HTTP-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-005 | `app/controllers/api/bff/auth/sessions_controller.rb` | HTTP-002 login, HTTP-004 me, HTTP-005 logout | HTTP-002/004/005 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-006 | `app/controllers/api/bff/auth/registrations_controller.rb` | HTTP-003 register | HTTP-003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-007 | `app/controllers/api/bff/auth/passwords_controller.rb` | HTTP-006 change password/revoke peer sessions | HTTP-006 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-008 | `app/controllers/api/bff/auth/email_verifications_controller.rb` | HTTP-007 request and HTTP-008 confirm | HTTP-007/008 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-009 | `app/controllers/api/bff/auth/emails_controller.rb` | HTTP-009 email change | HTTP-009 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-010 | `app/controllers/api/bff/auth/passkeys/registrations_controller.rb` | HTTP-010/011 register options/verify | HTTP-010/011 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-011 | `app/controllers/api/bff/auth/passkeys/sessions_controller.rb` | HTTP-012/013 login options/verify | HTTP-012/013 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-012 | `app/controllers/api/bff/auth/passkeys/credentials_controller.rb` | HTTP-014/015 list/delete with last-key guard | HTTP-014/015 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-013 | `app/controllers/api/bff/auth/telegram/webapps_controller.rb` | HTTP-016 WebApp | HTTP-016 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-014 | `app/controllers/api/bff/auth/telegram/merge_confirmations_controller.rb` | HTTP-017/018/019 show/confirm/cancel | HTTP-017…019 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-015 | `app/controllers/api/bff/links/remnashop_controller.rb` | HTTP-020 link account | HTTP-020 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-016 | `app/controllers/api/bff/plans_controller.rb` | HTTP-021 public plans | HTTP-021 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-017 | `app/controllers/api/bff/subscriptions_controller.rb` | HTTP-022 current and HTTP-023 offers | HTTP-022/023 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-018 | `app/controllers/api/bff/subscription_reissues_controller.rb` | HTTP-026 reissue | HTTP-026 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-019 | `app/controllers/api/bff/promocodes_controller.rb` | HTTP-027 promo | HTTP-027 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-020 | `app/controllers/api/bff/devices_controller.rb` | HTTP-028/029/030 index/destroy all/destroy one | HTTP-028…030 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-021 | `app/controllers/api/bff/payment_commands_controller.rb` | HTTP-024 purchase and HTTP-025 extend | HTTP-024/025 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-022 | `app/controllers/api/bff/payment_history_controller.rb` | HTTP-031 local history + bounded refresh | HTTP-031 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-023 | `app/controllers/api/bff/payment_statuses_controller.rb` | HTTP-032 durable status | HTTP-032 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-024 | `app/controllers/api/bff/support_controller.rb` | HTTP-033 support channels | HTTP-033; SUP-001…003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-025 | `app/controllers/api/health_controller.rb` | HTTP-034/035 liveness without dependency calls | HTTP-034/035 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-026 | `app/controllers/api/readiness_controller.rb` | HTTP-036 sanitized cached public readiness | HTTP-036 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-027 | `app/controllers/api/internal/readiness_controller.rb` | HTTP-037 secret-protected detail | HTTP-037 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-028 | `app/controllers/api/internal/payment_reconciliations_controller.rb` | HTTP-038 secret batch endpoint | HTTP-038 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-029 | `app/controllers/api/legacy_sessions_controller.rb` | HTTP-039 compatible me and HTTP-040 compatible logout | HTTP-039/040 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-030 | `app/controllers/auth/telegram_controller.rb` | HTTP-041 start, HTTP-042 GET callback, HTTP-043 POST callback | HTTP-041…043 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-031 | `app/controllers/pwa_controller.rb` | HTTP-044 service worker and dynamic manifest | HTTP-044; PWA | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CTRL-032 | `app/controllers/pages_controller.rb` | page access redirects for guest/bootstrap/unverified/full | frontend permissions | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 12. JSON views

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| JSON-001 | `app/views/api/shared/_error.json.jbuilder` | exact standard error envelope and safe message | error contracts | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-002 | `app/views/api/bff/auth/_user.json.jbuilder` | exact current user/profile shape | HTTP-004 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-003 | `app/views/api/bff/auth/_session.json.jbuilder` | exact auth result without secret leakage | auth cards | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-004 | `app/views/api/bff/plans/index.json.jbuilder` | public plan response | HTTP-021 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-005 | `app/views/api/bff/subscriptions/show.json.jbuilder` | current subscription/live URL response | HTTP-022 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-006 | `app/views/api/bff/subscriptions/offers.json.jbuilder` | exact offers/price versions | HTTP-023 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-007 | `app/views/api/bff/devices/index.json.jbuilder` | responsive UI device data contract | HTTP-028 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-008 | `app/views/api/bff/payment_commands/show.json.jbuilder` | payment URL/operation durable reference | HTTP-024/025 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-009 | `app/views/api/bff/payment_history/index.json.jbuilder` | local stable history | HTTP-031 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-010 | `app/views/api/bff/payment_statuses/show.json.jbuilder` | terminal/retry/manual status and retry seconds | HTTP-032 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-011 | `app/views/api/readiness/show.json.jbuilder` | sanitized public readiness | HTTP-036 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-012 | `app/views/api/internal/readiness/show.json.jbuilder` | dependency detail without credentials/errors | HTTP-037 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| JSON-013 | `app/views/api/internal/payment_reconciliations/show.json.jbuilder` | batch counters/manual IDs/valid bounded schema | HTTP-038 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 13. HTML layouts, partials и 19 page views

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| VIEW-001 | `app/views/layouts/application.html.erb` | AppShell, metadata, CSP nonce, assets, SW registration | components/design tokens | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-002 | `app/views/layouts/auth.html.erb` | AuthShell exact desktop/mobile frame | components/design tokens | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-003 | `app/views/shared/_navigation.html.erb` | state-aware desktop/mobile navigation | permissions/navigation | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-004 | `app/views/shared/_flash.html.erb` | info/success/warn/error aria-live messages | screen states | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-005 | `app/views/shared/_form_errors.html.erb` | field errors/focus target without data loss | forms/accessibility | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-006 | `app/views/shared/_account_action_required.html.erb` | bootstrap/unverified/link guidance | permissions | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-006A | `app/helpers/application_helper.rb` | минимальная общая база Rails view helpers | Rails generator; rules §4.8 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-006B | `app/helpers/formatting_helper.rb` | ru-RU date/traffic/byte/duration/status formatting | components | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-006C | `app/helpers/navigation_helper.rb` | menu state, active route and accessible labels | navigation/permissions | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-007 | `app/views/pages/home.html.erb` | PAGE-001 root/action cards | PAGE-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-008 | `app/views/pages/login.html.erb` | PAGE-002 identify/known/unknown/passkey/Telegram states | PAGE-002 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-009 | `app/views/pages/register.html.erb` | PAGE-003 register/Turnstile/password feedback | PAGE-003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-010 | `app/views/pages/register_verify_email.html.erb` | PAGE-004 six-digit confirm/resend/back | PAGE-004 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-011 | `app/views/pages/verify_email.html.erb` | PAGE-005 session email confirm/resend/partial success | PAGE-005 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-012 | `app/views/pages/telegram_webapp.html.erb` | PAGE-006 auto initData login/safe redirect | PAGE-006 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-013 | `app/views/pages/passkey_setup.html.erb` | PAGE-007 passkey setup/skip/bootstrap promotion | PAGE-007 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-014 | `app/views/pages/cabinet.html.erb` | PAGE-008 subscription, URL, devices, history, actions | PAGE-008 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-015 | `app/views/pages/tariffs.html.erb` | PAGE-009 plan/duration/gateway exact selection | PAGE-009 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-016 | `app/views/pages/payment.html.erb` | PAGE-010 refreshed offer confirmation/idempotent submit | PAGE-010 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-017 | `app/views/pages/extend.html.erb` | PAGE-011 extension selection/confirmation | PAGE-011 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-018 | `app/views/pages/payment_success.html.erb` | PAGE-012 durable status polling with success hint only | PAGE-012 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-019 | `app/views/pages/payment_fail.html.erb` | PAGE-013 durable status polling with fail hint only | PAGE-013 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-020 | `app/views/pages/payment_pending.html.erb` | PAGE-014 bounded pending/network retry | PAGE-014 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-021 | `app/views/pages/profile.html.erb` | PAGE-015 profile/email/password/verification | PAGE-015 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-022 | `app/views/pages/link_account.html.erb` | PAGE-016 email/Telegram/passkeys/merge panel | PAGE-016 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-023 | `app/views/pages/support.html.erb` | PAGE-017 SUP-001…003 and disabled/empty/error states | PAGE-017 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-024 | `app/views/pages/install.html.erb` | PAGE-018 native/iOS/embedded/Android/installed states | PAGE-018 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-025 | `app/views/pages/offline.html.erb` | PAGE-019 safe public offline fallback | PAGE-019 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-026 | `app/views/pwa/manifest.webmanifest.erb` | dynamic brand/icons/start/display contract | PWA/files | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| VIEW-027 | `app/views/pwa/service_worker.js.erb` | build-scoped public cache, offline navigation, private bypass | HTTP-044; BR-006 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 14. Assets и Stimulus

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| ASSET-001 | `app/assets/config/manifest.js` | Propshaft asset declarations | Rails asset pipeline | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-002 | `app/assets/stylesheets/application.css` | ordered imports without Node build | rules §4.8 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-003 | `app/assets/stylesheets/tokens.css` | exact typography/palette/spacing/radius/shadow/focus tokens | design-tokens | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-004 | `app/assets/stylesheets/layouts.css` | AuthShell/AppShell desktop/mobile grids | design-tokens/screens | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-005 | `app/assets/stylesheets/components.css` | controls/cards/tags/messages/dialog/table/device cards states | components/forms/dialogs | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-006 | `app/assets/stylesheets/pages.css` | page-specific composition for PAGE-001…019 | PAGE cards | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-007 | `config/importmap.rb` | pinned local Hotwire/Stimulus modules, no floating CDN | rules §4.8/security | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-008 | `app/javascript/application.js` | Turbo/Stimulus boot and SW registration | browser/PWA | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-009 | `app/javascript/controllers/index.js` | eager/lazy registration through stimulus-loading | Rails Stimulus | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-010 | `app/javascript/controllers/form_lock_controller.js` | one pending mutation, disabled/label/focus result | screen-states | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-011 | `app/javascript/controllers/password_visibility_controller.js` | show/hide preserving focus/value | forms | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-012 | `app/javascript/controllers/passkey_controller.js` | BR-003/004 native create/get/cancel/error serialization | browser/WebAuthn | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-013 | `app/javascript/controllers/clipboard_controller.js` | BR-002 copy live URL and managed failure | browser | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-014 | `app/javascript/controllers/payment_controller.js` | BR-001/007/008 stable idempotency and external navigation | browser/payment | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-015 | `app/javascript/controllers/payment_return_controller.js` | aliases, durable correlation, bounded polling/retry | return pages/API usage | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-016 | `app/javascript/controllers/telegram_webapp_controller.js` | TG-006 SDK/initData/openLink fallback/storage | TG-006; BR-011 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-017 | `app/javascript/controllers/pwa_install_controller.js` | BR-005 install state machine and dialogs | install/PWA | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-018 | `app/javascript/controllers/dialog_controller.js` | accessible focus trap/restore/escape for install only | dialogs/accessibility | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-019 | `public/clean-pay-logo.png` | preserved brand asset URL/checksum | files/reference manifest | ДА | Н/П — review реализации не начат | Н/П — runtime не создан |
| ASSET-020 | `public/clean-pay-icon-192.png` | preserved PWA 192 icon | files/PWA | ДА | Н/П — review реализации не начат | Н/П — runtime не создан |
| ASSET-021 | `public/clean-pay-icon-512.png` | preserved PWA 512 icon | files/PWA | ДА | Н/П — review реализации не начат | Н/П — runtime не создан |
| ASSET-022 | `public/clean-pay-icon-maskable-512.png` | preserved maskable icon | files/PWA | ДА | Н/П — review реализации не начат | Н/П — runtime не создан |
| ASSET-023 | `public/themes/lara-light-indigo/theme.css` | preserved theme bytes and served MIME/cache | files/design | ДА | Н/П — review реализации не начат | Н/П — runtime не создан |
| ASSET-024 | `public/themes/lara-light-indigo/fonts/Inter-roman.var.woff2` | preserved Inter roman font | files/design | ДА | Н/П — review реализации не начат | Н/П — runtime не создан |
| ASSET-025 | `public/themes/lara-light-indigo/fonts/Inter-italic.var.woff2` | preserved Inter italic font | files/design | ДА | Н/П — review реализации не начат | Н/П — runtime не создан |
| ASSET-026 | `public/favicon.ico` | browser favicon at exact public path | `02-interfaces/files.md` | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-027 | `public/400.html` | safe static bad-request fallback without internals | security/error contracts | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-028 | `public/404.html` | safe static not-found fallback without route masking | security/error contracts | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-029 | `public/406-unsupported-browser.html` | Rails browser compatibility fallback | Rails 8.1 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-030 | `public/422.html` | safe static unprocessable-content fallback | security/error contracts | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| ASSET-031 | `public/500.html` | safe static production error without exception leakage | security/error contracts | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 15. Workers и эксплуатационные Ruby classes

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| OPS-001 | `app/models/platform/interval_runner.rb` | Rails executor, non-overlap, monotonic schedule, signal stop | background jobs | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| OPS-002 | `app/models/platform/heartbeat.rb` | atomic epoch-ms replace and freshness calculation | BG-001/002 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| OPS-003 | `app/models/platform/retention_runner.rb` | first run, 300…86400 interval, batch summary, retry next cycle | BG-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| OPS-004 | `app/models/platform/reconciliation_runner.rb` | disabled exit 0, 5…3600 interval, 45s HTTP request validation | BG-002 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| OPS-005 | `app/models/platform/migration_runner.rb` | strict config, PostgreSQL advisory lock, migrate/version verify | BG-003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| OPS-006 | `lib/tasks/quality.rake` | schema/route/spec coverage checks in bin/ci | acceptance strategy | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| OPS-007 | `lib/tasks/visual.rake` | render and compare 19×2 reference screenshots | visual contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| OPS-008 | `lib/tasks/prestage.rake` | safe start/wait/test without volume reset default | BG-004 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 16. Model, operation и integration tests

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| TEST-001 | `test/test_helper.rb` | deterministic Rails/Minitest setup, parallel safety, no real prod endpoints | acceptance | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-002 | `test/models/web_user_test.rb` | identity normalization/uniqueness/ownership | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-003 | `test/models/web_session_test.rb` | session states/token custody/encryption | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-004 | `test/models/web_refresh_token_test.rb` | grace replay/reuse evidence | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-005 | `test/models/web_authn_credential_test.rb` | credential counter/transports/last-key guard | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-006 | `test/models/web_authn_challenge_test.rb` | one-time expiry/consume | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-007 | `test/models/telegram_auth_state_test.rb` | digests/safe return/one-time | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-008 | `test/models/email_verification_code_test.rb` | attempts/resend/use/expiry | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-009 | `test/models/account_merge_confirmation_test.rb` | states/lease/idempotency | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-010 | `test/models/payment_operation_test.rb` | state machine/idempotency/owner/leases | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-011 | `test/models/payment_record_test.rb` | status mapping/upsert chronology | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-012 | `test/models/payment_history_sync_state_test.rb` | cursor/generation/lease fence | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-013 | `test/models/audit_log_test.rb` | immutability/redaction/retention | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-014 | `test/models/rate_limit_event_test.rb` | evidence scopes/retention | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-015 | `test/models/app_setting_test.rb` | typed JSON config | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-016 | `test/models/integration_status_test.rb` | state/staleness | model contract | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-017 | `test/models/value_objects_test.rb` | email/path/idempotency/offer/money edge cases | value objects | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-018 | `test/models/identity/session_authenticator_test.rb` | rotation/race/replay/revocation | high-risk regression | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-019 | `test/models/identity/account_merge_test.rb` | transfer/partial failure/owner fence | high-risk regression | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-020 | `test/models/payments/create_operation_test.rb` | dispatch crash windows and immutable retry | high-risk regression | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-021 | `test/models/payments/reconcile_batch_test.rb` | recovery outcomes/manual/defer | high-risk regression | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-022 | `test/models/payments/sync_history_page_test.rb` | stale lease/generation/owner rejection | high-risk regression | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-023 | `test/integration/remnashop_contract_test.rb` | RS-001…030 individually against preserved service | integration matrix | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-024 | `test/integration/remnawave_contract_test.rb` | RW-001…004 against mock | integration matrix | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-025 | `test/integration/telegram_oidc_contract_test.rb` | TG-001…005 including ADR-001 mismatch | integration matrix | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-026 | `test/integration/turnstile_contract_test.rb` | TS-000/001 widget/server modes | integration matrix | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-027 | `test/integration/mailpit_contract_test.rb` | MAIL-001…003, SMTP-001, MP-001…003 through Remnashop | integration matrix | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-028 | `test/integration/redis_contract_test.rb` | REDIS-001…005 exact commands/fallback | integration matrix | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-029 | `test/integration/reverse_proxy_contract_test.rb` | trusted forwarding/origin/health routes | reverse proxy | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| TEST-030 | `test/integration/concurrency_test.rb` | two-connection refresh/passkey/merge/payment/history races | concurrency requirements | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 17. HTTP contract tests: все 44 операции

Каждый файл проверяет method/path, query/path/body, unknown fields, content type, limits, auth, permissions, statuses, headers, cookies/redirect, exact JSON и side effects своей карточки.

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| HTTPTEST-001 | `test/requests/http_001_test.rb` | HTTP-001 contract | HTTP-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-002 | `test/requests/http_002_test.rb` | HTTP-002 contract | HTTP-002 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-003 | `test/requests/http_003_test.rb` | HTTP-003 contract | HTTP-003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-004 | `test/requests/http_004_test.rb` | HTTP-004 contract | HTTP-004 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-005 | `test/requests/http_005_test.rb` | HTTP-005 contract | HTTP-005 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-006 | `test/requests/http_006_test.rb` | HTTP-006 contract | HTTP-006 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-007 | `test/requests/http_007_test.rb` | HTTP-007 contract | HTTP-007 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-008 | `test/requests/http_008_test.rb` | HTTP-008 contract | HTTP-008 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-009 | `test/requests/http_009_test.rb` | HTTP-009 contract | HTTP-009 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-010 | `test/requests/http_010_test.rb` | HTTP-010 contract | HTTP-010 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-011 | `test/requests/http_011_test.rb` | HTTP-011 contract | HTTP-011 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-012 | `test/requests/http_012_test.rb` | HTTP-012 contract | HTTP-012 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-013 | `test/requests/http_013_test.rb` | HTTP-013 contract | HTTP-013 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-014 | `test/requests/http_014_test.rb` | HTTP-014 contract | HTTP-014 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-015 | `test/requests/http_015_test.rb` | HTTP-015 contract | HTTP-015 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-016 | `test/requests/http_016_test.rb` | HTTP-016 contract | HTTP-016 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-017 | `test/requests/http_017_test.rb` | HTTP-017 contract | HTTP-017 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-018 | `test/requests/http_018_test.rb` | HTTP-018 contract | HTTP-018 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-019 | `test/requests/http_019_test.rb` | HTTP-019 contract | HTTP-019 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-020 | `test/requests/http_020_test.rb` | HTTP-020 contract | HTTP-020 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-021 | `test/requests/http_021_test.rb` | HTTP-021 contract | HTTP-021 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-022 | `test/requests/http_022_test.rb` | HTTP-022 contract | HTTP-022 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-023 | `test/requests/http_023_test.rb` | HTTP-023 contract | HTTP-023 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-024 | `test/requests/http_024_test.rb` | HTTP-024 contract | HTTP-024 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-025 | `test/requests/http_025_test.rb` | HTTP-025 contract | HTTP-025 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-026 | `test/requests/http_026_test.rb` | HTTP-026 contract | HTTP-026 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-027 | `test/requests/http_027_test.rb` | HTTP-027 contract | HTTP-027 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-028 | `test/requests/http_028_test.rb` | HTTP-028 contract | HTTP-028 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-029 | `test/requests/http_029_test.rb` | HTTP-029 contract | HTTP-029 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-030 | `test/requests/http_030_test.rb` | HTTP-030 contract | HTTP-030 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-031 | `test/requests/http_031_test.rb` | HTTP-031 contract | HTTP-031 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-032 | `test/requests/http_032_test.rb` | HTTP-032 contract | HTTP-032 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-033 | `test/requests/http_033_test.rb` | HTTP-033 contract | HTTP-033 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-034 | `test/requests/http_034_test.rb` | HTTP-034 contract | HTTP-034 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-035 | `test/requests/http_035_test.rb` | HTTP-035 contract | HTTP-035 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-036 | `test/requests/http_036_test.rb` | HTTP-036 contract | HTTP-036 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-037 | `test/requests/http_037_test.rb` | HTTP-037 contract | HTTP-037 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-038 | `test/requests/http_038_test.rb` | HTTP-038 contract | HTTP-038 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-039 | `test/requests/http_039_test.rb` | HTTP-039 contract | HTTP-039 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-040 | `test/requests/http_040_test.rb` | HTTP-040 contract | HTTP-040 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-041 | `test/requests/http_041_test.rb` | HTTP-041 contract | HTTP-041 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-042 | `test/requests/http_042_test.rb` | HTTP-042 contract | HTTP-042 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-043 | `test/requests/http_043_test.rb` | HTTP-043 contract | HTTP-043 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| HTTPTEST-044 | `test/requests/http_044_test.rb` | HTTP-044 contract and private-cache exclusion | HTTP-044 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |

## 18. System, browser и visual tests

| ID | Файл | Feature / обязанность | Нормативный источник | ИМПЛЕМЕНТИРОВАНО | СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ | РАБОТАЕТ |
|---|---|---|---|---|---|---|
| SYS-001 | `test/application_system_test_case.rb` | Capybara/Selenium setup, 1440×1000 and 390×844, screenshots | visual strategy | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-002 | `test/system/page_001_test.rb` | PAGE-001 states/actions/desktop/mobile | PAGE-001 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-003 | `test/system/page_002_test.rb` | PAGE-002 states/actions/desktop/mobile | PAGE-002 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-004 | `test/system/page_003_test.rb` | PAGE-003 states/actions/desktop/mobile | PAGE-003 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-005 | `test/system/page_004_test.rb` | PAGE-004 states/actions/desktop/mobile | PAGE-004 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-006 | `test/system/page_005_test.rb` | PAGE-005 states/actions/desktop/mobile | PAGE-005 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-007 | `test/system/page_006_test.rb` | PAGE-006 states/actions/desktop/mobile | PAGE-006 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-008 | `test/system/page_007_test.rb` | PAGE-007 states/actions/desktop/mobile | PAGE-007 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-009 | `test/system/page_008_test.rb` | PAGE-008 states/actions/desktop/mobile | PAGE-008 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-010 | `test/system/page_009_test.rb` | PAGE-009 states/actions/desktop/mobile | PAGE-009 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-011 | `test/system/page_010_test.rb` | PAGE-010 states/actions/desktop/mobile | PAGE-010 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-012 | `test/system/page_011_test.rb` | PAGE-011 states/actions/desktop/mobile | PAGE-011 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-013 | `test/system/page_012_test.rb` | PAGE-012 states/actions/desktop/mobile | PAGE-012 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-014 | `test/system/page_013_test.rb` | PAGE-013 states/actions/desktop/mobile | PAGE-013 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-015 | `test/system/page_014_test.rb` | PAGE-014 states/actions/desktop/mobile | PAGE-014 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-016 | `test/system/page_015_test.rb` | PAGE-015 states/actions/desktop/mobile | PAGE-015 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-017 | `test/system/page_016_test.rb` | PAGE-016 states/actions/desktop/mobile | PAGE-016 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-018 | `test/system/page_017_test.rb` | PAGE-017 states/actions/desktop/mobile | PAGE-017 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-019 | `test/system/page_018_test.rb` | PAGE-018 states/actions/desktop/mobile | PAGE-018 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SYS-020 | `test/system/page_019_test.rb` | PAGE-019 states/actions/desktop/mobile | PAGE-019 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
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
| GATE-001 | `bundle exec rubocop` | весь Ruby/Rails/test code | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-002 | `bin/brakeman` | Rails security scan | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-003 | `bin/bundler-audit` | dependency vulnerabilities | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| GATE-004 | `RAILS_ENV=test bin/rails db:prepare test` | unit/model/operation tests | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
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
| CAP-09…10 Payments | payment models/operations/controllers/views | HTTP-024/025/031/032/038 + concurrency/fault injection | НЕ РЕАЛИЗОВАНО |
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
| CAP-01 | `app/models/identity/email_authentication.rb` | определение способа входа | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-02 | `app/models/identity/email_authentication.rb` | регистрация и вход по почте | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-03 | `app/models/identity/email_verification.rb` | подтверждение и изменение почты | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-04 | `app/models/identity/telegram_authentication.rb` | Telegram login/link | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-05 | `app/models/identity/passkey_ceremony.rb` | passkey register/login/list/delete | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-06 | `app/models/identity/account_merge.rb` | способы входа и объединение владельцев | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-07 | `app/models/subscriptions/catalog.rb` | публичный и персональный каталог | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-08 | `app/models/subscriptions/current_access.rb` | подписка, URL, устройства, reissue, promo | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-09 | `app/models/payments/create_operation.rb` | покупка и продление без повтора эффекта | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-10 | `app/models/payments/reconcile_batch.rb` | история, durable result и reconciliation | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| CAP-11 | `app/controllers/api/bff/support_controller.rb` | support contacts | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
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
| RW-001 | `app/models/integrations/remnawave_client.rb` | user lookup by UUID | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RW-002 | `app/models/integrations/remnawave_client.rb` | users lookup by e-mail | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RW-003 | `app/models/integrations/remnawave_client.rb` | users lookup by Telegram ID | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| RW-004 | `app/models/integrations/remnawave_client.rb` | readiness metadata | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
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
| BR-010 | `app/views/pages/support.html.erb` | mailto/t.me system handlers | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BR-011 | `app/javascript/controllers/telegram_webapp_controller.js` | Telegram openLink/fallback | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| REDIS-001 | `app/models/integrations/redis_store.rb` | PING/PONG | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| REDIS-002 | `app/models/integrations/redis_store.rb` | EVAL rate counter | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| REDIS-003 | `app/models/integrations/redis_store.rb` | TTL Retry-After | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| REDIS-004 | `app/models/integrations/redis_store.rb` | SET readiness EX 120 | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| REDIS-005 | `app/models/integrations/redis_store.rb` | GET readiness | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SUP-001 | `app/views/pages/support.html.erb` | support e-mail | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SUP-002 | `app/views/pages/support.html.erb` | support Telegram | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| SUP-003 | `app/views/pages/support.html.erb` | support FAQ | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BG-001 | `app/models/platform/retention_runner.rb` | retention process | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
| BG-002 | `app/models/platform/reconciliation_runner.rb` | reconciliation process | НЕТ | Н/П — нет реализации | Н/П — нет реализации |
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
