# Конфигурационные входы

## Среда выполнения приложения

| Группа | Переменные | Основные ограничения |
|---|---|---|
| Публичные URL | `APP_URL`, `NEXT_PUBLIC_APP_URL` | обязательный HTTP(S), в production один и тот же origin |
| Branding | `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_LOGO_URL` | defaults `Clean Pay`, `/clean-pay-logo.png`; name ≤80, root-relative logo |
| Storage | `DATABASE_URL`, `REDIS_URL` | required runtime connections |
| Remnashop | `REMNASHOP_API_BASE_URL`, `REMNASHOP_ADMIN_API_BASE_URL`, `REMNASHOP_API_KEY` | public required, admin derived/optional override, key for admin operations |
| Remnawave | `REMNAWAVE_API_BASE_URL`, `REMNAWAVE_TOKEN` | configured as pair; production required |
| Session/security | `WEB_JWT_SECRET`, `WEB_REFRESH_SECRET`, `AUDIT_IP_HASH_SECRET`, `RATE_LIMIT_IDENTITY_SECRET` | secrets; audit secret falls back to JWT outside stricter production validation |
| Cookies | `COOKIE_SECURE`, `COOKIE_SAMESITE` | strict bool; `lax|strict|none`; none requires secure |
| Telegram | `TELEGRAM_OIDC_CLIENT_ID`, `TELEGRAM_OIDC_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN` | OIDC required; bot token required for signed Remnashop Telegram calls |
| Telegram overrides | `TELEGRAM_OIDC_ISSUER`, `TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT`, `TELEGRAM_OIDC_TOKEN_ENDPOINT`, `TELEGRAM_OIDC_JWKS_URI` | honored only outside production; official defaults otherwise |
| Turnstile | `TURNSTILE_ENABLED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_VERIFY_URL` | disabled default; keys required when enabled |
| Support | `SUPPORT_ENABLED`, `SUPPORT_EMAIL`, `SUPPORT_TELEGRAM_USERNAME`, `SUPPORT_FAQ_URL` | disabled/nullable defaults |
| Readiness | `READINESS_INTERNAL_SECRET`, `CLEAN_PAY_READINESS_MAILPIT_URL`, `CLEAN_PAY_READINESS_REMNAWAVE_URL` | internal secret required; dependency URLs optional |
| Reconciliation | `PAYMENT_RECONCILIATION_ENABLED`, `PAYMENT_RECONCILIATION_SECRET`, `PAYMENT_RECONCILIATION_BATCH_SIZE`, `PAYMENT_RECONCILIATION_INTERVAL_SECONDS`, `PAYMENT_RECONCILIATION_INTERNAL_URL` | disabled; secret ≥32 when enabled; batch 1–100; interval 5–3600 |
| Logs/build | `LOG_LEVEL`, `NODE_ENV`, `CLEAN_PAY_BUILD_ID`, `CLEAN_PAY_BUILD_PHASE`, `GITHUB_SHA` | log enum and build controls |

## Сроки хранения

| Variable | Default | Constraint |
|---|---:|---|
| `AUTH_STATE_RETENTION_DAYS` | 7 | 1–30 |
| `SESSION_RETENTION_DAYS` | 90 | 30–365 |
| `AUDIT_INFO_RETENTION_DAYS` | 180 | 30–730 |
| `AUDIT_SECURITY_RETENTION_DAYS` | 365 | 90–2555 and ≥ info retention |
| `RATE_LIMIT_RETENTION_DAYS` | 30 | 1–180 |
| `DATA_RETENTION_INTERVAL_SECONDS` | 21600 | 300–86400 |

## Оркестрация и развёртывание

`COMPOSE_PROJECT_NAME`, `CLEAN_PAY_IMAGE`, `CLEAN_PAY_BIND`, `CLEAN_PAY_PORT`, `CLEAN_PAY_EDGE_NETWORK`, `REMNASHOP_DOCKER_NETWORK`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `CLEAN_PAY_MODE`, `NEXT_TELEMETRY_DISABLED`.

## Разработка, тесты и имитаторы

`CLEAN_PAY_DEVCONTAINER_PROJECT`, `CLEAN_PAY_HOST_DEVCONTAINER_DIR`, `CLEAN_PAY_E2E_RUNNER_INSIDE`, `REMOTE_CONTAINERS`, `RESET_E2E`, `KEEP_E2E_STACK`, `CLEAN_PAY_E2E_BASE_URL`, `CLEAN_PAY_E2E_MAILPIT_URL`, `CLEAN_PAY_E2E_OIDC_URL`, `REAL_DATABASE_URL`, а также локальные для имитаторов `PORT`, `OIDC_ISSUER`, `OIDC_PUBLIC_ISSUER`, `OIDC_CLIENT_ID`, `MAILPIT_API_URL`, `SMTP_LOG_MAX_BODY_CHARS`.

`RESET_E2E` по безопасному prestage-умолчанию равен `0`: общий volume не очищается. Сброс разрешён только для заранее проверенного изолированного тестового проекта. `KEEP_E2E_STACK=1` оставляет инфраструктурные сервисы поднятыми после runner; это не означает сохранение запущенного им процесса приложения. `REAL_DATABASE_URL` включает PostgreSQL concurrency tests; без него эти тесты явно пропускаются, а не считаются успешно пройденными.

## Не являющиеся входами продукта

Имена `HISTORY_REFRESH_INTERVAL_MS`, `MAX_HISTORY_SESSION_CANDIDATES`, `RECONCILIATION_LEASE_MS` и `REDIS_MAX_RESPONSE_BYTES` выглядят как конфигурация, но в исследованном срезе являются фиксированными внутренними константами: соответственно 300000 мс, 20 кандидатов, 30000 мс и 1048576 байт. Новая реализация обязана сохранить наблюдаемую семантику; превращать их в настройки можно только без изменения default.

Имена shell-переменных `COMMAND`, `MODE`, `ROOT_DIR`, `ENV_FILE`, `COMPOSE_PATH` и подобные являются локальными переменными launch-скриптов, а не контрактом среды запущенного приложения. Системные `BASH_SOURCE`, `BASH_REMATCH`, `VERSION_CODENAME` и тестовые placeholder-переменные также не переносятся в Ruby runtime. Их поведение учитывается только при замене конкретного операционного script/harness.

## Рабочие правила по каждому полю

| Variable | Required/default | Exact production rule |
|---|---|---|
| `POSTGRES_DB`,`POSTGRES_USER` | required by validator | simple DB names; must equal decoded DATABASE_URL database/user |
| `POSTGRES_PASSWORD` | required | strong ≥24; equals decoded URL password; distinct from other secrets |
| `DATABASE_URL` | required | postgres(s), non-local; allowed query keys only; public host requires TLS; bundled `postgres` port 5432 |
| `REDIS_URL` | required | redis(s), numeric DB; public requires rediss; bundled `redis` has no creds/port 6379; external password strong |
| `APP_URL`,`NEXT_PUBLIC_APP_URL` | required | same public HTTPS origin, origin-only, no credentials |
| `CLEAN_PAY_BAKED_PUBLIC_APP_URL` | optional build evidence | when present same origin or image rebuild required |
| `NEXT_PUBLIC_BRAND_NAME` | `Clean Pay` | ≤80 |
| `NEXT_PUBLIC_BRAND_LOGO_URL` | `/clean-pay-logo.png` | safe root-relative public path, not `//`, backslash/NUL |
| `REMNASHOP_API_BASE_URL` | required | service URL ending `/api/v1/public` |
| `REMNASHOP_ADMIN_API_BASE_URL` | derived | same origin/prefix ending `/api/v1/admin` |
| `REMNASHOP_API_KEY` | production required | strong ≥24, distinct |
| `REMNAWAVE_API_BASE_URL`,`REMNAWAVE_TOKEN` | production required pair | public HTTPS origin; token strong ≥24 |
| `WEB_JWT_SECRET`,`WEB_REFRESH_SECRET`,`AUDIT_IP_HASH_SECRET`,`RATE_LIMIT_IDENTITY_SECRET`,`READINESS_INTERNAL_SECRET` | production required | each strong ≥32 and pairwise distinct |
| `COOKIE_SECURE` | true | must be true in production |
| `COOKIE_SAMESITE` | lax | lax/strict/none; general rule none requires secure |
| Telegram client id | required | numeric bot id 5..20 digits, first nonzero |
| Telegram client secret | required | strong ≥24 |
| `TELEGRAM_BOT_TOKEN` | production required | `<same client id>:<20+ token chars>`, whole secret ≥32 |
| Telegram endpoint overrides | official defaults | if present must equal official endpoints in production; dev may override HTTP(S) |
| Reconciliation enabled | false | if true: secret strong ≥32 and exact internal service URL; batch 1..100 default10; interval5..3600 default30 |
| Turnstile enabled | false | if true site+secret required; production rejects placeholders/test keys, secret ≥24 and official verify URL |
| Support | disabled/null | email syntax; Telegram `@?letter + 4..31 word`; FAQ public HTTPS |
| Readiness optional URLs | null | Mailpit service origin; Remnawave same production origin |
| `CLEAN_PAY_BIND` | 127.0.0.1 | production only loopback `127.0.0.1|::1` |
| `CLEAN_PAY_PORT` | 4000 | validator currently bounds **exactly 4000** (`min=max=4000`) despite compose interpolation allowing another textual value; effective production contract is 4000 |
| `RUN_MIGRATIONS` | true | strict boolean |
| `CLEAN_PAY_BUILD_PHASE` | absent | value true forbidden at runtime |
| `LOG_LEVEL` | info | logger accepts debug/info/warn/error; production example uses info |

Production parser `.env` отвергает интерполяцию, многострочное/неразбираемое присваивание, повтор имён, окружающие пробелы и управляющие имена Compose `COMPOSE_ENV_FILES|COMPOSE_FILE|COMPOSE_PROFILES`. Секреты проверяются на шаблонные/распространённые слабые значения и повтор между разными назначениями.

## Разделение областей конфигурации

Переменные отдельного развёртывания Remnashop (его APP/EMAIL/BOT/REMNAWAVE/DATABASE/REDIS) не загружаются Clean Pay: это предпосылки внешней интеграции, а не runtime-входы приложения. Compose-only переменные потребляются оркестратором до старта контейнера. Test/dev переменные влияют только на harness/mocks. Доказательства происхождения примеров сохраняются исключительно в `09-traceability/`.
