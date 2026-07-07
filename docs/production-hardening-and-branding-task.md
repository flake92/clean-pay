# Задача: Production Hardening И Брендинг Clean Pay

## Цель

Привести Clean Pay к более безопасному и предсказуемому production-ready состоянию без изменения исходного кода Remnashop.

Этот документ является источником правды для следующей последовательности работ. Работать нужно по пунктам ниже и по порядку, если пользователь явно не изменит приоритет. Каждый завершенный пункт должен сопровождаться доказательной базой: ссылками на код, кратким выводом команд, результатами тестов/сборки и runtime-проверками, которые подтверждают, что текущий рабочий код не пострадал.

## Зафиксированные Решения

1. Пользовательские сообщения по умолчанию остаются на русском языке.
2. Переключение между русским и английским языками планируется позже, но не реализуется в рамках этой задачи без отдельного запроса.
3. Логирование должно быть построено строго вокруг безопасности. Production-логи не должны содержать чувствительные request/response body, cookies, tokens, secrets, платежные данные или персональные данные, если эти поля не внесены в явный безопасный whitelist.
4. Ссылка подключения подписки должна браться только из Remnawave.
5. Если Remnawave не может предоставить ссылку подписки, Clean Pay должен показать явную ошибку о недоступности ссылки, а не использовать кэшированную ссылку из Remnashop.
6. Ошибки статуса платежа/подписки должны быть явными. Нельзя скрывать upstream/integration failures как `null`.
7. Production Docker startup должен использовать Docker-сеть `remnawave-network`. Процесс запуска должен проверять, существует ли сеть, и создавать ее, если она отсутствует.
8. Некорректная production-конфигурация должна приводить к fail-fast с понятной причиной.
9. Текущие токены тестового стенда считаются демонстрационными/тестовыми, но меры безопасности по очистке, ротации или санитизации все равно нужны.
10. README и env-документация должны соответствовать реальному production startup flow.
11. В публичном README нужно указать, что проект предназначен для запуска на Linux.
12. Windows не является целевой платформой продукта. Windows-specific исправления допустимы только если они нужны для локальной проверки в рамках этой задачи.
13. Linting для devcontainer/mock-кода должен быть настроен корректно, а не скрыт неаккуратным ignore.
14. Sass deprecation warnings должны быть устранены.
15. Next lint warnings вокруг image/style usage должны быть устранены там, где это уместно.
16. Clean Pay должен поддерживать будущий брендинг кабинета: настраиваемое название личного кабинета и пользовательский логотип.

## Правила Доказательной Базы

Для каждого завершенного пункта нужно предоставить:

- что изменилось;
- почему изменение безопасно;
- точные файлы, которые были затронуты;
- какие тесты/проверки были запущены;
- результат каждой проверки;
- оставшийся риск, если он есть.

Нельзя отмечать пункт завершенным без доказательной базы.

## План Работ

### 1. Исправить Кодировку Пользовательских Production-Соообщений

Приоритет: критичный.

Проблема:
В нескольких production-facing русских сообщениях лежит mojibake-текст, например в BFF errors и proxy responses.

Влияние:
Пользователи видят сломанный текст в ошибках login/auth/session/payment/passkey/email verification. Логика может работать, но продукт выглядит сломанным.

Scope:

- `src/backend/integrations/remnashop/errors.ts`
- `src/backend/http/bff-response.ts`
- `src/proxy.ts`
- `src/app/api/bff/payments/status/route.ts`
- любые другие source-файлы, найденные поиском mojibake-паттернов.

Требуемое поведение:

- Сообщения по умолчанию читаемые и на русском языке.
- Текст хранится как UTF-8.
- Переключение языка в этом пункте не требуется.

Доказательная база:

- Поиск, подтверждающий, что production source-файлы больше не содержат mojibake-паттернов.
- Unit/integration tests.
- Build или targeted route checks, если затронуты соответствующие маршруты.

### 2. Сделать Логирование Безопасным По Умолчанию

Приоритет: критичный.

Проблема:
Текущее upstream и BFF logging может включать полные headers, bodies и response data.

Влияние:
В логи могут утечь cookies, tokens, персональные данные, платежные данные или неожиданные чувствительные upstream-поля.

Scope:

- `src/backend/integrations/remnashop/client.ts`
- `src/backend/http/bff-response.ts`
- `src/backend/observability/logger.ts`
- связанные tests.

Требуемое поведение:

- Production logs используют только безопасные whitelist-поля.
- Не логируются полные request bodies, response bodies, cookies, authorization headers, tokens или secrets.
- Debug visibility не должна отменять production safety.

Доказательная база:

- Tests, подтверждающие, что sensitive keys и body fields не логируются.
- Review формы log payload.
- Unit/integration tests.

### 3. Сделать Remnawave Обязательным Источником Ссылки Подключения

Приоритет: критичный.

Проблема:
Текущий subscription endpoint может fallback-нуться на кэшированный `subscription.url` из Remnashop, если Remnawave lookup не удался.

Влияние:
Пользователь может получить устаревшую или неверную ссылку подключения.

Scope:

- `src/backend/integrations/remnawave/client.ts`
- `src/app/api/bff/subscription/current/route.ts`
- `src/shared/remnashop/types.ts`, если контракт ответа потребует явных error fields.
- UI components, которые отображают/копируют/открывают subscription URL.

Требуемое поведение:

- Ссылка подключения берется только из Remnawave.
- Если Remnawave не вернул URL или недоступен, Clean Pay возвращает/показывает явную ошибку о недоступности ссылки подключения.
- Нельзя молча fallback-нуться на кэшированную ссылку Remnashop.

Доказательная база:

- Tests для успешного получения ссылки из Remnawave.
- Tests для Remnawave unavailable/no URL.
- UI behavior proof или component test, где это возможно.

### 4. Сделать Ошибки Статуса Платежа И Подписки Явными

Приоритет: высокий.

Проблема:
`payments/status` сейчас проглатывает ошибки subscription lookup и возвращает `subscription: null`.

Влияние:
Реальные integration failures выглядят как отсутствие данных. Пользователь и оператор теряют настоящий сигнал ошибки.

Scope:

- `src/app/api/bff/payments/status/route.ts`
- связанный UI status component.

Требуемое поведение:

- Различать "подписки нет" и upstream/auth/integration errors.
- Показывать явную пользовательскую ошибку, если статус нельзя проверить.
- Логировать безопасные diagnostic details.

Доказательная база:

- Tests для отсутствующей подписки.
- Tests для upstream failure.
- Tests для unauthorized/expired session behavior.

### 5. Сделать Production Docker Network Startup Надежным

Приоритет: высокий.

Проблема:
Production Compose ожидает external `remnawave-network`. На чистой машине этой сети может не быть.

Влияние:
Задокументированный запуск в три шага может упасть до старта приложения.

Scope:

- `deploy/prod/docker-compose.yml`
- `deploy/prod/prod.mjs` или production startup helper script.
- `README.md`
- `README.ru_RU.md`

Требуемое поведение:

- По умолчанию всегда используется Docker-сеть `remnawave-network`.
- Startup flow проверяет наличие сети.
- Если сети нет, startup создает ее.
- README соответствует реальной команде.

Доказательная база:

- Вывод команд, показывающий idempotent network create/check.
- Compose config validation.
- README command совпадает с implementation.

### 6. Добавить Fail-Fast Validation Для Production Config

Приоритет: высокий.

Проблема:
Некоторые неверные env-комбинации обнаруживаются только во время пользовательских действий.

Влияние:
Misconfiguration проявляется как сломанный user flow вместо понятной startup failure.

Scope:

- `src/backend/config/env.ts`
- app startup path или health/startup validation integration.
- tests.

Требуемое поведение:

- Production app падает с понятной ошибкой при неверной required configuration.
- Валидируются связанные настройки:
  - `TURNSTILE_ENABLED=true` требует `TURNSTILE_SITE_KEY` и `TURNSTILE_SECRET_KEY`;
  - `COOKIE_SAMESITE=none` требует `COOKIE_SECURE=true`;
  - так как subscription URL должен приходить из Remnawave, production требует одновременно `REMNAWAVE_API_BASE_URL` и `REMNAWAVE_TOKEN`;
  - Telegram settings должны быть внутренне согласованы;
  - required URLs должны быть валидными.

Доказательная база:

- Unit tests для valid и invalid env sets.
- Summary поведения build/startup check.

### 7. Security Cleanup Для Test Tokens И Env Files

Приоритет: высокий.

Проблема:
Локальные ignored env-файлы содержат демонстрационные/тестовые tokens и secrets.

Влияние:
Даже на тестовом стенде credentials могут утечь через скопированные logs или archives.

Scope:

- локальные ignored env files;
- документация;
- любые logs/artifacts, найденные в рамках задачи.

Требуемое поведение:

- Не коммитить реальные env files.
- По возможности удалить sensitive values из generated logs/artifacts.
- Ротировать или заменить test tokens, если это доступно и безопасно сделать.
- Задокументировать, что было изменено и что осталось.

Доказательная база:

- `git status --ignored` summary.
- Поиск, подтверждающий, что committed secrets не добавлены.
- Summary ротации/санитизации.

### 8. Обновить README И Env-Документацию Под Реальность

Приоритет: средний.

Проблема:
README должен оставаться синхронизированным с реальным production startup и env validation.

Влияние:
Неверная документация приводит к сломанным deployments.

Scope:

- `README.md`
- `README.ru_RU.md`
- `deploy/prod/.env.example`

Требуемое поведение:

- English и Russian README имеют идентичную структуру и смысл.
- README указывает, что целевая runtime-платформа — Linux.
- Startup остается тремя простыми шагами.
- Env reference соответствует реальному коду и Compose.

Доказательная база:

- Script/check, показывающий, что каждая переменная из `.env.example` описана в обоих README.
- Поиск, подтверждающий, что unrelated dev instructions не вернулись.

### 9. Сохранить Практичную Проверку На Windows, Но Не Делать Windows Целью

Приоритет: средний.

Проблема:
Продукт Linux-first, но текущая локальная проверка может выполняться из Windows.

Влияние:
Сломанные local scripts замедляют validation.

Scope:

- минимальные scripts, нужные для checks;
- без promise поддержки Windows в public README.

Требуемое поведение:

- Исправлять только то, что блокирует verification.
- README не должен превращаться в Windows setup guide.

Доказательная база:

- Команды, использованные для verification, указаны в итоговом отчете.

### 10. Корректно Настроить Linting Для Devcontainer/Mock-Кода

Приоритет: средний.

Проблема:
Ignore `.devcontainer/**/*.js` убирает lint noise, но скрывает реальные проблемы в поддерживаемых mock services.

Влияние:
Mock services могут незаметно устареть или сломаться.

Scope:

- `eslint.config.mjs`
- `.devcontainer/**/*.js`

Требуемое поведение:

- Либо lint mock JS с подходящими CommonJS rules, либо явно документировать, почему конкретный generated file игнорируется.
- Не использовать широкие careless ignores.

Доказательная база:

- Результат lint run.
- Пояснение config.

### 11. Убрать Sass Deprecation Warnings

Приоритет: низкий.

Проблема:
Sass `@import` deprecated.

Влияние:
Будущие версии Sass могут сломать build.

Scope:

- `src/frontend/styles/layout/*.scss`

Требуемое поведение:

- Мигрировать с `@import` на поддерживаемый Sass module syntax.
- Сохранить визуальное поведение.

Доказательная база:

- Build output больше не содержит Sass `@import` deprecation warnings.
- Visual smoke check, где это возможно.

### 12. Устранить Next Image/Style Lint Warnings

Приоритет: низкий.

Проблема:
Next lint ругается на manual stylesheet и raw `<img>` usage.

Влияние:
Потенциально хуже performance и шумный lint.

Scope:

- `src/app/layout.tsx`
- `src/frontend/components/layout/auth-shell.tsx`
- похожие файлы, найденные lint.

Требуемое поведение:

- Устранить warnings там, где это уместно.
- Не сломать theme loading или logo rendering.

Доказательная база:

- Lint run без relevant warnings.
- Build result.

### 13. Спроектировать Поддержку Брендинга Кабинета

Приоритет: product planning, до реализации.

Проблема:
Deployments Clean Pay должны поддерживать пользовательское название кабинета и пользовательский логотип.

Влияние:
Без поддержки брендинга каждый customer deployment выглядит hardcoded, а для изменения брендинга нужны code changes.

Требуемое product behavior:

- Admin/operator может задать display name кабинета.
- Admin/operator может задать custom logo.
- Defaults остаются Clean Pay / существующий logo.
- Branding применяется консистентно:
  - login/register shell;
  - app header/sidebar/topbar;
  - page title/metadata, где это уместно;
  - support/customer-facing screens.

Открытые design points:

- Storage: только env, database setting, uploaded asset или оба варианта.
- Logo upload path: local volume, object storage или URL-only.
- Validation: file type, size limit, dimensions, fallback behavior.
- Branding per deployment или per tenant.

Начальная рекомендация:

- Начать с deployment-level branding:
  - `BRAND_NAME`;
  - `BRAND_LOGO_URL` или позже uploaded file, который сервится из persistent volume.
- Database-backed settings проектировать только если нужен runtime editing.

Доказательная база для будущей реализации:

- Tests для default branding.
- Tests для custom env/database branding.
- Screenshot или browser check, показывающий logo/name на ключевых экранах.

## Completion Checklist

Задача считается завершенной только когда:

- critical и high-priority пункты исправлены или явно deferred пользователем;
- README и env examples соответствуют фактическому startup behavior;
- subscription connection links никогда не fallback-ятся молча на устаревшие Remnashop URLs;
- production logs безопасны по умолчанию;
- invalid production configuration fail-fast-ится с понятной причиной;
- пользовательский русский текст читаемый;
- у каждого завершенного пункта есть доказательная база.
