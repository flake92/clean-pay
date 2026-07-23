# Отчёт физических проверок исходного среза и спецификации

Дата проверки: 2026-07-22. Все команды выполнялись на сохранённом исходном срезе; удаление, сброс Docker volumes и реальная оплата не выполнялись.

## Автоматические проверки поведения

| Проверка | Результат | Покрытие |
|---|---:|---|
| Проверка типов | успешно | вся TypeScript-сборка исходного приложения |
| Линтер | успешно | исходники и конфигурация по действующим правилам |
| Unit | 67 файлов, 475/475 | бизнес-правила, parsers, клиенты, UI helpers и ошибки |
| Route handlers | 2 файла, 44/44 | все 44 входные HTTP method/path операции |
| Integration с реальными PostgreSQL/Redis | 8 файлов, 58/58 | route handlers, одноразовые состояния, refresh-family, Passkey, merge, Telegram recovery, Redis timeout |
| Full-stack E2E | 1 файл, 104/104 | публичные/защищённые маршруты, e-mail/SMTP, Telegram, аккаунт, подписка, устройства и платежные ветки без реальной оплаты |
| Production build | успешно | 44 HTTP-операции и 19 страниц |
| Миграции | 15/15, схема актуальна | последовательное применение на чистой dev-БД и повторный `migrate status` |

Integration и повторный E2E запускались без общего сброса данных. Тесты создавали уникальные временные записи и удаляли только их; `RESET_E2E=0`, topology оставлена поднятой. E2E подтвердил реальную цепочку регистрации и отправки письма через SMTP/Mailpit, а также сценарии Telegram и business endpoints.

Первый повторный unit-запуск внутри E2E-контейнера получил пять ожидаемо несовместимых значений URL: глобальные devcontainer-переменные направляли Telegram на mock, тогда как unit-тесты проверяют официальные production endpoints. После удаления только четырёх OIDC override из окружения тестового процесса тот же неизменённый код прошёл 475/475. Это подтверждает необходимость раздельных runtime-профилей, зафиксированную в эксплуатационных требованиях.

## Проверка конкурентности

Подтверждены:

- один победитель потребления WebAuthn challenge и Telegram state;
- запрет конкурентно удалить оба последних Passkey;
- CAS ненулевого WebAuthn counter;
- один преемник refresh-token и отзыв семейства при позднем reuse;
- один claimant подтверждения merge;
- атомарный перенос passkeys/payments при merge и payment-owner fence;
- один победитель Telegram token recovery без stale overwrite;
- timeout закрывает зависшее Redis-соединение.

В тесте конфликта WebAuthn counter защищающая транзакция прошла, но дополнительный audit попытался получить HTTP headers вне request scope и создал `audit_write_failed`. Это не скрыто: требование к явному audit context внесено в `07-operations/runtime-and-deployment.md` и обязательно для новой реализации.

## Визуальная проверка

| Набор | Desktop 1440×1000 | Mobile 390×844 | Проверка |
|---|---:|---:|---|
| Текущее приложение | 19/19 снимков | 19/19 снимков | checksums сохранены и повторно проверяемы |
| Автономный макет | 19/19 снимков | 19/19 снимков | без browser page errors, скрытые test-controls, без горизонтального overflow |

Средняя простая RGB-схожесть макета с текущими эталонами — 95,86%; минимальная — 89,49% для mobile PAGE-007. Эта метрика используется только как автоматический sanity check. Авторитетны текущие растровые эталоны и детальный разбор `05-frontend/visual-comparison-report.md`; Unicode-замены части PrimeIcons в макете не разрешают новой реализации менять фактические иконки.

## Инфраструктурные проверки

- Полная Docker-топология поднималась: Clean Pay app/PostgreSQL/Redis, Remnashop app/worker/scheduler/PostgreSQL/cache, Remnawave mock, Telegram Bot/OIDC mocks, Mailpit, smtp logger и Caddy.
- Реальная цепочка браузер → регистрация → Remnashop → SMTP → Mailpit → шестизначный код → bootstrap → пропуск Passkey → кабинет → выход выполнена.
- Mailpit image разрешён до точного digest и закреплён ADR-002.
- Сверены 30 операций Remnashop, Telegram OIDC/WebApp/Bot, Remnawave, Turnstile, SMTP, payment provider boundary, Redis, reverse proxy и browser/PWA interfaces.

## Обнаруженные ограничения проверки

Production provider charge намеренно не выполнялся; он проверяется contract/mock-ветками, потому что реальная оплата была бы внешним необратимым действием. Полное disaster-recovery восстановление production-данных также не выполнялось на пользовательской среде: проверены процедуры, миграции и test-state recovery, а обязательный rehearsal новой реализации включён в критерии приёмки. Эти ограничения не создают неизвестного внешнего поля, но должны остаться release gates Ruby-prestage.

## Чистая проверка самодостаточности

Каталог `software-spec/` скопирован отдельно от репозитория в временную clean-room директорию. В этой копии успешно проверены все относительные Markdown-ссылки, наличие 44 карточек HTTP и 19 PAGE-карточек, обе группы SHA-256 визуальных эталонов и отсутствие ссылок из нормативных разделов `01`—`08`, `99-llm` на исходные каталоги/файлы старого приложения. Автономный макет, изображения и контекст реализации входят в сам каталог спецификации.

## Финальная проверка Rails-монолита — cycle 3, 2026-07-23

Результаты старого приложения выше являются историческим доказательством
исходного контракта. Текущая Ruby on Rails реализация проверена отдельным единым
cycle 3 после всех исправлений исполняемого кода.

| Уровень | Команда/среда | Результат |
|---|---|---|
| Единый CI | `mise exec -- bin/ci` | 173 runs, 842 assertions, 0 failures/errors/skips; RuboCop 251 files; Brakeman 0 warnings; dependency audits и Zeitwerk PASS |
| HTTP | `bin/rails test test/requests` | 53 runs, 281 assertions |
| Внешние интеграции | `bin/rails test test/integration` | 30 runs, 135 assertions |
| Конкурентность | `bin/rails test test/integration/concurrency_test.rb` | 5 runs, 23 assertions |
| System/E2E | `bin/rails test:system` | 26 runs, 184 assertions |
| Visual | `visual_comparison_test.rb` | 38/38 PASS: 19 экранов × 1440×1000 и 390×844; minimum 89,27% при gate 88% |
| Структура/реестр | `quality:plan`, `quality:structure` | 581 unique rows, 322/322 source files, 19 pages, 15 tables |
| Пользовательский паритет | `main-user-capability-parity.md` | MCU-001…033 — `ДА`, сравнивались возможности и бизнес-результаты, а не технологии |

### Внешние интерфейсы

В работающем prestage защищённый readiness вернул `ok` отдельно для PostgreSQL,
Redis, Remnashop, Telegram OIDC, Remnawave и Mailpit. Контрактные тесты охватили
RS-001…030, RW-001…004, TG-001…006, TS-000/001, MAIL-001…003, SMTP-001,
MP-001…003, REDIS-001…005 и reverse proxy. Реальное списание у
production-провайдера не выполнялось: необратимый эффект ограничен
mock/contract boundary.

### Образ, процессы и recovery

Финальный `clean-pay:prestage` собран без cache; manifest image —
`sha256:1f1007e70472ea96ba38f90c74c79ee7a2d3c6c3f074b905a1122956d4c133c8`.
Web, retention и reconciliation работали от одного образа и пользователя
`rails:rails`. Heartbeat-файлы retention/reconciliation имели mode `0600`;
оба worker и web завершились по сигналу с exit code 0 и после этого успешно
перезапустились.

Backup финального образа получил SHA-256
`a205475f8e30f4d0c70c1e232d445d5ed8263033510aac2365ab82f09f1e5d2c`.
Он восстановлен в отдельную пустую БД
`clean_pay_restore_rehearsal_cycle3`; checksum, schema version и row counts 15
таблиц совпали. Read-only Rails smoke подтвердил отсутствие pending migrations.
Временная БД и backup удалены; рабочие volumes и данные не изменялись.

Cycle 1 и 2 в корневом плане сохранены как недействительные с обнаруженными
причинами. Они не используются как доказательство готовности cycle 3.
