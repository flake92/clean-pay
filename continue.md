# Clean Pay — обязательная передача следующей LLM

Прочитай этот файл полностью до любых изменений. Проект уже является
Ruby on Rails монолитом; не начинай его заново и не восстанавливай удалённое
Next.js/TypeScript/Prisma-приложение.

## 1. Текущая точка

- Дата передачи: 2026-07-23.
- Ветка: `refach`.
- HEAD на момент передачи: `98d934c` (`not completed`).
- Общий статус: **НЕ ГОТОВО**.
- Реализация остановлена внутри этапа 7.
- Этап 8 «контейнеры, deploy и recovery» ещё не начат.
- В рабочем дереве на момент создания этого handoff новый файл `continue.md`
  не проиндексирован. Не выполнять `git add` и не создавать commit без прямой
  команды владельца.

Источники истины в порядке приоритета:

1. `software-spec/` — продуктовые, внешние, data и визуальные контракты.
2. `RUBY_RAILS_RULES.md` — обязательные правила реализации Ruby/Rails.
3. `TECHNICAL_IMPLEMENTATION_PLAN.md` — полный file/feature backlog, статусы и
   журнал доказательств.
4. Фактически работающий код и тесты — только как доказательство реализации,
   но не как основание изменить нормативный контракт.

Главная актуальная точка передачи уже продублирована в разделе 0.1
`TECHNICAL_IMPLEMENTATION_PLAN.md`. При расхождении сначала актуализируй оба
handoff-раздела, не угадывай состояние.

## 2. Что уже реализовано

- Rails 8.1.3 на Ruby 4.0.6.
- PostgreSQL schema и 15 Rails migrations.
- Identity, sessions, refresh rotation, WebAuthn, Telegram и account merge.
- Subscription, devices, offers и Remnashop/Remnawave integrations.
- Payments, idempotency, history sync, reconciliation и recovery.
- Health/readiness, audit, rate limiting, retention/reconciliation runners,
  PWA protocol и эксплуатационные primitives.
- Server-rendered Rails frontend: 19 страниц, layouts, partials, CSS,
  importmap/Stimulus behaviors и русская локализация.
- Request contract tests для реализованных HTTP-входов, model/integration/
  concurrency tests и 19 page system tests.
- Сохранены prestage/test-сервисы: Remnashop, Remnawave mock, Telegram Bot
  mock, Telegram OIDC mock, Mailpit/SMTP logger, PostgreSQL, Redis/Valkey и
  Caddy.
- Сохранены все нормативные документы и 76 визуальных reference-файлов.

Старый код не является источником архитектуры. Сохраняются внешнее поведение,
интерфейсы, данные и визуальный контракт, а не внутренние детали прежней
реализации.

## 3. Обязательное ведение полной таблицы

`TECHNICAL_IMPLEMENTATION_PLAN.md` — единственное место, где разрешено вести
статус реализации. Его нельзя заменить кратким отчётом, TODO-листом или
сообщением в чате.

Для **каждого файла и каждой отдельной обязанности** должна существовать
атомарная строка таблицы со следующими полями:

1. ID.
2. Файл.
3. Feature / обязанность.
4. Нормативный источник.
5. `ИМПЛЕМЕНТИРОВАНО`.
6. `СООТВЕТСТВУЕТ RUBY-ДОКУМЕНТУ`.
7. `РАБОТАЕТ`.

Обязательный рабочий протокол:

1. До создания нового файла или feature добавить либо уточнить его строку в
   таблице.
2. Не объединять несколько независимо проверяемых обязанностей в одну
   расплывчатую строку. Если один файл выполняет несколько обязанностей, путь
   повторяется в нескольких строках.
3. После реализации заполнить `ИМПЛЕМЕНТИРОВАНО` только по фактическому
   состоянию, без «почти готово».
4. Выполнить отдельный review по `RUBY_RAILS_RULES.md` и только после него
   заполнить колонку соответствия.
5. Выполнить реальную проверку и записать точное доказательство в `РАБОТАЕТ`:
   команду, число тестов/assertions, результат browser/visual/integration/
   recovery-проверки и номер цикла.
6. Промежуточное доказательство записывать как
   `ПРОВЕРЕНО В БЛОКЕ N: ...; ТРЕБУЕТ ФИНАЛЬНОГО ЦИКЛА`. Это не означает
   release-готовность.
7. Значение `ДА` в колонке `РАБОТАЕТ` допустимо только после одного полного
   положительного verification cycle для всего проекта.
8. Пустые ячейки, подразумеваемые статусы и неподтверждённые `ДА` запрещены.
9. `Н/П` допустимо только с точной причиной и доказательством неприменимости.
10. После каждого изменения синхронизировать реальное дерево, таблицу,
    именованные контракты и журнал циклов.

### Правило полного сброса

Если не прошла хотя бы одна проверка или обнаружена хотя бы одна
несоответствующая строка:

1. записать конкретную ошибку в её строку;
2. установить общий статус `НЕ ГОТОВО`;
3. признать текущий полный verification cycle недействительным;
4. заменить все прежние release-значения `РАБОТАЕТ = ДА` на
   `ТРЕБУЕТ ПОВТОРНОЙ ПРОВЕРКИ`;
5. после исправления увеличить номер цикла;
6. заново пройти **все** уровни для **всех** строк:
   static → unit/model → HTTP contract → integration → concurrency →
   system/E2E → browser/visual → production/deploy/recovery.

Частичный rerun подтверждает только локальный блок и не восстанавливает полный
статус. Нельзя объявлять работу готовой по последнему успешному тесту, если
остальные строки не проверены в том же полном цикле.

В таблице сейчас 593 строки, и все 593 требуют финальной положительной проверки
в одном новом цикле. Не сокращать таблицу ради удобства.

## 4. Точное незавершённое место этапа 7

Ранее `mise exec -- bin/rails test:system` прошёл:

```text
19 runs, 82 assertions, 0 failures, 0 errors, 0 skips
```

После этого изменялись responsive navigation, payment-return polling,
install/offline, PWA и dialog behavior. Поэтому прежний результат правильно
сброшен и не является текущим доказательством.

После последних UI-изменений были положительными:

- Rails-aware ERB compilation для 36 файлов;
- `node --check`;
- RuboCop для 27 UI-файлов;
- Zeitwerk;
- структурная проверка 330 зарегистрированных файлов;
- реальный browser smoke 1440×1000 и 390×844 без горизонтального overflow;
- mobile navigation open/Escape.

Повтор system tests не состоялся из-за отклонённого средой доступа к Docker test
PostgreSQL после исчерпания approval limit. Не обходить это установкой
PostgreSQL на хосте или изменением test architecture.

Не реализированы:

- `SYS-021` — `test/system/email_purchase_journey_test.rb`;
- `SYS-022` — `test/system/telegram_merge_journey_test.rb`;
- `SYS-023` — `test/system/subscription_management_journey_test.rb`;
- `SYS-024` — `test/system/pwa_privacy_test.rb`;
- `SYS-025` — `test/visual/visual_comparison_test.rb`;
- `ASSET-026` — `public/favicon.ico`.

## 5. Следующие действия — строго в этом порядке

1. Проверить `git status`, текущий HEAD и разделы 0, 18, 20, 21 и 24
   `TECHNICAL_IMPLEMENTATION_PLAN.md`.
2. Не переписывая существующие 19 page tests, реализовать `SYS-021…SYS-024`
   как четыре настоящих сквозных journey.
3. Реализовать `SYS-025`: автоматический visual comparison всех 19 страниц
   для desktop 1440×1000 и mobile 390×844 с отчётом и явным порогом.
4. Добавить `public/favicon.ico` по `ASSET-026`, сохранив branding и файловый
   контракт.
5. При первом доступном Docker PostgreSQL повторить
   `mise exec -- bin/rails test:system`.
6. После любого исправления повторить полный UI gate:
   system tests, ERB compilation, JavaScript syntax, RuboCop, Zeitwerk,
   desktop/mobile browser, accessibility, visual diff и structural audit.
7. Заполнить **каждую связанную строку таблицы** фактическими результатами.
8. Только после полностью зелёного этапа 7 перейти к этапу 8:
   containerization, prestage, deploy, migration serialization, readiness,
   workers, backup/restore и restart.
9. После этапа 8 запустить новый полный verification cycle с самого начала для
   всех 593 строк.

## 6. Внешние интерфейсы — проверять как критические

Не считать интеграцию реализованной по внутреннему mock Ruby-класса. Нужны
black-box/contract проверки против сохранённых сервисов и точных спецификаций:

- Remnashop app, worker, scheduler, PostgreSQL и cache;
- Remnawave;
- Telegram Bot API;
- Telegram OIDC и Telegram WebApp;
- SMTP и Mailpit webhook logger;
- Turnstile;
- платёжные провайдеры;
- PostgreSQL/Redis;
- Caddy и health/readiness;
- browser cookies, redirects, CSRF, WebAuthn и PWA.

Особенно не пропустить почту/SMTP. Финальный gate должен включать настоящее
SMTP-сообщение, его появление в Mailpit и обработку webhook logger.

После инфраструктурных тестов погасить Clean Pay containers без `-v`. Docker
volumes не удалять и не сбрасывать. Сохранённую development-базу `clean_pay`
не мигрировать и не очищать без отдельного плана; проверки выполняются на
`clean_pay_test`.

## 7. Визуальный контракт

Новая реализация обязана воспроизвести все 19 страниц и их состояния.
Эталоны находятся в:

- `software-spec/05-frontend/pages/`;
- `software-spec/05-frontend/reference/current/`;
- `software-spec/05-frontend/reference/mockup/`;
- `software-spec/05-frontend/design-tokens.md`;
- `software-spec/05-frontend/screen-states.md`;
- `public/`.

Нужны обе контрольные геометрии: desktop 1440×1000 и mobile 390×844.
Проверяются не только happy-path изображения, но также loading, empty, error,
success, disabled, focus, dialogs, navigation, offline/install и responsive
состояния. Не принимать визуальный результат «на глаз» без автоматического diff
и объяснения отклонений.

## 8. Запреты

- Не восстанавливать старый Next.js/TypeScript/Prisma-код.
- Не превращать приложение в SPA и не добавлять React/Vue/Node toolchain.
- Не менять внешний контракт ради удобства Rails-кода.
- Не копировать внутреннюю архитектуру удалённого приложения.
- Не добавлять файл или feature без строки в техническом плане.
- Не ставить положительный статус без фактической проверки.
- Не обходить сбой Docker-теста локальной установкой PostgreSQL.
- Не сбрасывать БД и volumes.
- Не выполнять `git add`, commit, push или destructive Git-команды без прямого
  указания владельца.
- Не трогать пользовательские `.idea/`-файлы.
- Не переходить к этапу 8 до полного закрытия UI gate этапа 7.

## 9. Definition of Done

Проект можно назвать готовым только когда одновременно:

- все 593 строки таблицы имеют три доказанных положительных статуса в одном
  полном verification cycle;
- покрыты все именованные CAP, HTTP-001…044, PAGE-001…019, внешние операции,
  background jobs и data-инварианты;
- schema, constraints, indexes и 15 migrations проверены на PostgreSQL;
- пройдены integration, concurrency и fault-injection сценарии;
- пройдены четыре сквозных journey;
- все 19 desktop и 19 mobile сравнений не имеют необъяснённых отклонений;
- prestage сохраняет внешние сервисы, сети и volumes;
- доказаны clean build, migrations, readiness, workers, restart,
  backup/restore и reconciliation rehearsal;
- нормативные checksums и traceability согласованы;
- нет относящегося к release незакрытого ADR;
- общий статус `TECHNICAL_IMPLEMENTATION_PLAN.md` установлен в `ГОТОВО`, а
  номер полного цикла одинаков во всех доказательствах.

До выполнения всех условий формулировка результата только одна: **НЕ ГОТОВО**.
