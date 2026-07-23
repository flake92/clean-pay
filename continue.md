# Clean Pay — передача следующей LLM

Прочитай этот файл полностью до любых изменений. Проект является завершённым
server-rendered Ruby on Rails монолитом. Не начинай реализацию заново и не
восстанавливай удалённое Next.js/TypeScript/Prisma-приложение.

## Текущее состояние

- Дата финальной проверки: 2026-07-23.
- Ветка: `refach`; рабочее дерево намеренно не закоммичено — владелец коммитит
  самостоятельно.
- Общий статус: `ГОТОВО`, verification cycle 3.
- `TECHNICAL_IMPLEMENTATION_PLAN.md`: 581/581 строк имеют положительные
  implementation/review/runtime-доказательства.
- Не выполнять `git add`, commit, push или destructive Git-команды без прямой
  команды владельца.
- Не трогать `.idea/`.

Источники истины:

1. `software-spec/` — продуктовые, внешние, data и визуальные контракты.
2. `RUBY_RAILS_RULES.md` — архитектурные правила Ruby/Rails.
3. `TECHNICAL_IMPLEMENTATION_PLAN.md` — атомарный file/feature ledger и журнал
   полных циклов.
4. `software-spec/09-traceability/main-user-capability-parity.md` — MCU-001…033,
   полный паритет наблюдаемых пользовательских возможностей с `main`.
5. `software-spec/09-traceability/verification-report.md` — физические
   доказательства cycle 3.

## Финальные доказательства cycle 3

- `mise exec -- bin/ci`: 173 runs, 842 assertions, 0 failures/errors/skips;
  RuboCop 251 files, Brakeman 0 warnings, audits и Zeitwerk PASS.
- HTTP: 53 runs / 281 assertions.
- Внешние интеграции: 30 / 135.
- PostgreSQL concurrency: 5 / 23.
- System/E2E: 26 / 184.
- Visual: 19 desktop + 19 mobile, 38/38 PASS; минимум 89,27% при gate 88%.
- Runtime readiness: PostgreSQL, Redis, Remnashop, Telegram OIDC, Remnawave,
  Mailpit — 6/6 `ok`.
- Финальный no-cache image:
  `sha256:1f1007e70472ea96ba38f90c74c79ee7a2d3c6c3f074b905a1122956d4c133c8`.
- Web, retention и reconciliation: heartbeat/health PASS, graceful exit 0,
  restart PASS.
- Recovery: backup SHA-256
  `a205475f8e30f4d0c70c1e232d445d5ed8263033510aac2365ab82f09f1e5d2c`,
  restore в отдельную пустую БД, schema/row counts/read-only smoke PASS;
  временная БД и backup удалены.

## Обязательное правило пользовательского паритета

Новая проверка или последующая доработка не имеет права сравнивать архитектуру
ради архитектуры. Паритет с `main` означает совпадение пользовательских
возможностей: исходное состояние, видимый control, осмысленное действие,
бизнес-результат, устойчивое изменение и управляемая ошибка. JWT, BFF,
framework, язык, внутренний endpoint и способ хранения сессии не являются
пользовательскими возможностями.

Если меняется пользовательское поведение:

1. повторно прочитай `main` read-only, не переключая рабочую ветку;
2. добавь/уточни отдельную строку MCU;
3. свяжи её со спецификацией, Rails flow и исполняемым доказательством;
4. запусти полный цикл, а не только один локальный тест;
5. не оставляй `ОЖИДАЕТ`, `В РАБОТЕ`, `TODO`, `SKIP` или пустую ячейку.

## Ведение технического плана

Каждый новый source-файл и каждая отдельная обязанность сначала получают
атомарную строку в `TECHNICAL_IMPLEMENTATION_PLAN.md`. После изменения:

1. заполнить фактический `ИМПЛЕМЕНТИРОВАНО`;
2. выполнить review по `RUBY_RAILS_RULES.md`;
3. записать точное runtime-доказательство;
4. запустить `quality:plan` и `quality:release_plan`;
5. если любой gate падает, признать цикл недействительным, исправить причину и
   заново пройти static → unit → HTTP → integrations → concurrency → system →
   visual → prestage/recovery.

Положительный старый запуск не переносится через изменение исполняемого кода.
Fixtures намеренно заменены deterministic builders; Rails 8 Propshaft намеренно
не использует Sprockets `manifest.js`.

## Внешние интерфейсы и инфраструктура

Критичны Remnashop app/worker/scheduler/PostgreSQL/cache, Remnawave, Telegram
Bot/OIDC/WebApp, Turnstile, SMTP/Mailpit/logger, payment-provider boundary,
PostgreSQL, Redis, Caddy, cookies/redirects/CSRF/WebAuthn/PWA. Почтовая цепочка
обязательна; наличие Ruby mock само по себе не доказывает внешний интерфейс.

После проверок Clean Pay и test/spec контейнеры выключаются без `-v`. Никогда не
удаляй и не сбрасывай persistent volumes или сохранённые данные без отдельной
прямой команды владельца.

## Визуальный контракт

Сохраняются все 19 страниц и состояния на 1440×1000 и 390×844. Авторитетны
`software-spec/05-frontend/`, reference screenshots, design tokens,
screen-states и `public/`. Pixel gate дополняется смысловой проверкой текста,
controls, loading/empty/error/success/focus/dialog/offline/install состояний.

## Перед любым объявлением готовности

Проверь физически:

- `quality:release_plan` положителен для всех 581 строк;
- MCU-001…033 положительны и `main` не изменился;
- все внешние интерфейсы и почта подтверждены;
- visual 38/38;
- нормативные SHA-256 сходятся;
- `git diff --check` чист;
- контейнеры выключены, volumes сохранены;
- `.idea/` не затронута;
- commit/stage отсутствуют, если владелец отдельно их не запросил.

Физическая итоговая отметка находится в
`software-spec/09-traceability/reimplementation-readiness-manifest.md`.
