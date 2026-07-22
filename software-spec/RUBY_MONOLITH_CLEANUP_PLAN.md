# План очистки проекта и предварительного стенда для Ruby-монолита

## Статус и запрет исполнения

Это отдельный план, а не выполненное удаление. На текущем шаге **ничего из перечисленного не удаляется, контейнеры/сети/тома не останавливаются и не пересоздаются**. Исполнение допустимо только после отдельного явного подтверждения пользователя, фиксации архивной ревизии и повторной проверки конкретного списка путей.

Цель — удалить реализацию Clean Pay на Next.js/TypeScript, сохранить спецификацию, визуальные эталоны, внешнюю test/spec-инфраструктуру и нейтральную эксплуатационную обвязку, затем заменить только приложение на Ruby-монолит.

## Принцип границы

Ruby-монолит владеет четырьмя логическими областями Clean Pay в одном продукте и релизе. Remnashop, Remnawave, Telegram, SMTP/Mailpit, Turnstile, платёжные провайдеры, PostgreSQL, Redis и reverse proxy не становятся его внутренними модулями. Mock/spec-контейнеры сохраняются именно для проверки этих внешних границ.

## Сохранить без удаления

| Путь/объект | Что сохраняется | Причина |
|---|---|---|
| `software-spec/` | вся нормативная спецификация, traceability, эталоны, макет и LLM-контекст | единственный контракт новой реализации |
| `REVERSE_SYSTEM_ANALYSIS_PROMPT_RU.md` | исходное задание | критерии полноты и происхождение результата |
| `LICENSE` | лицензия репозитория | юридическая непрерывность |
| `public/clean-pay-logo.png`, `public/clean-pay-icon-192.png`, `public/clean-pay-icon-512.png`, `public/clean-pay-icon-maskable-512.png` | брендовые растровые ресурсы | точное визуальное и PWA-соответствие |
| `public/themes/lara-light-indigo/theme.css` и `public/themes/lara-light-indigo/fonts/` | эталонные стили/шрифтовые файлы до завершения переноса | воспроизведение текущего дизайна; после переноса заменить на Ruby asset pipeline только при совпавших checksum/рендере |
| `.devcontainer/Caddyfile` | тестовый reverse proxy | проверенные host/port границы |
| `.devcontainer/remnawave-mock/` | Remnawave mock | внешний контракт RW-001…004 |
| `.devcontainer/telegram-mock/` | Telegram Bot API mock | внешний BOT-001 |
| `.devcontainer/telegram-oidc-mock/` | Telegram OIDC mock | discovery/auth/token/JWKS/avatar и ADR-001 |
| `.devcontainer/mailpit-logger/` | Mailpit webhook logger | MP-002…003 |
| соответствующие копии в `infra/test/` | нейтральный test/spec-набор | использовать как каноническую инфраструктурную копию после дедупликации |
| контейнеры `remnashop`, `remnashop-worker`, `remnashop-scheduler` | совместимый внешний сервис и его процессы | 30 public/admin операций и косвенные интеграции |
| `remnashop-postgres`, `remnashop-cache` и их volumes | отдельное состояние внешнего Remnashop | не принадлежит коду Clean Pay |
| `remnawave-mock`, `telegram-mock`, `telegram-oidc-mock`, `smtp-log`, `caddy` | test/spec-сервисы | проверка всех внешних интерфейсов |
| Mailpit `smtp` | SMTP 1025, UI/API 8025 | проверка реальной доставки; образ закрепить ADR-002 |
| Clean Pay PostgreSQL/Redis и volumes | состояние/координация приложения | сохранить до миграции и доказанного backup/restore; не очищать вместе со старым кодом |
| Docker networks | существующая связность сервисов | менять только после проверки всех имён и aliases |
| `.editorconfig`, `.dockerignore` | нейтральные правила репозитория | адаптировать при необходимости, не удалять вслепую |
| `.idea/` | пользовательские IDE-файлы | вне области автоматической очистки |

## Удалить после подтверждения и только после успешной замены

Следующие пути относятся к старой реализации приложения, но удаляются **не сейчас**, а после того, как Ruby-контейнер прошёл полный compatibility suite:

| Путь | Причина | Предусловие удаления |
|---|---|---|
| `src/` | Next.js/TypeScript продуктовый код | 44 HTTP, 19 UI и все фоновые правила реализованы и проверены в Ruby |
| `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Node dependency/runtime manifests | ни один сохраняемый mock не зависит от корневой установки; mock имеет собственный минимальный runtime или образ |
| `next-env.d.ts`, `next.config.ts`, `postcss.config.mjs` | Next/frontend build | Ruby asset/UI pipeline воспроизводит эталоны |
| `tsconfig.json`, `tsconfig.typecheck.json`, `tsconfig.typecheck.tsbuildinfo` | TypeScript tooling/generated cache | Ruby static checks настроены |
| `eslint.config.mjs`, `vitest*.ts` | старые lint/test runners | контракты перенесены в стек-независимые или Ruby-тесты |
| `tests/unit/` | тесты внутренних деталей старого кода | все значимые утверждения перенесены в Ruby unit/contract tests |
| старые `tests/integration/route-handlers/` и service tests | привязаны к старым импортам | эквивалентные black-box/DB concurrency tests работают против Ruby |
| `tests/e2e/` | старый Node runner | сценарии перенесены в независимый acceptance harness; endpoint matrix сохранена |
| `tests/setup/`, корневой `test/` | старые test helpers/пустые остатки | подтверждено отсутствие уникальных fixtures |
| `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/` | Prisma-реализация схемы | Ruby migrations дают точно итоговую схему и проверены на копии данных; описание 15 шагов остаётся в спецификации |
| `Dockerfile` | образ Next-приложения | новый Ruby Dockerfile используется Compose |
| `scripts/next-command.mjs`, `scripts/typecheck.mjs` | Next/TS wrappers | не используются новым CI |
| `scripts/e2e-devcontainer.mjs` и `.sh` | runner, запускающий Node-приложение | заменён stack-neutral/Ruby runner без сброса volumes по умолчанию |
| `deploy/prod/*.mjs`, `deploy/prod/start.sh`, `deploy/prod/Dockerfile` | Node-specific deploy/workers/validator | функции перенесены и доказаны в Ruby-командах/образе |
| текущие `README.md`, `README.ru_RU.md`, `docs/` | описывают старый стек/внутреннее устройство | полезные продуктовые факты уже трассированы; написан новый operator README |
| `.vscode/` | старые Next/Node задачи и расширения | заменить Ruby-настройками; не переносить слепо |
| runtime/generated `node_modules/`, `.next/`, `.next-mock/`, `coverage/` | сборочные артефакты | процессы старого приложения остановлены, архив не требует артефактов |

Пустой исторический каталог `app/`, если снова появится, удаляется как не-runtime остаток только после проверки, что он не содержит пользовательских файлов. В текущем рабочем срезе он уже был вынесен восстановимо из-за конфликта разрешения маршрутов; это не разрешает его безусловное удаление в будущем.

## Адаптировать, а не удалить целиком

| Путь/объект | Изменение для Ruby-монолита |
|---|---|
| `.devcontainer/docker-compose.yml` | заменить только сервис `app`, его build/command/healthcheck и mounted dependency cache; сохранить service names/hosts внешних mock, сети и volumes |
| `.devcontainer/Dockerfile`, `.devcontainer/devcontainer.json`, lock | сделать Ruby dev image и инструменты; не менять адреса интеграций |
| `docker-compose.yml` | заменить app, retention и reconciliation commands на команды одного Ruby-релиза; сохранить PostgreSQL/Redis readiness и volumes |
| `docker-compose.remnashop.yml` | сохранить Remnashop-сервисы и pin версии; изменить только подключение нового app при необходимости |
| `deploy/prod/docker-compose.yml` и debug override | заменить image/entrypoints/healthcheck; сохранить loopback bind, edge network, БД/Redis и worker semantics |
| `deploy.sh`, `start.sh`, `Makefile` | переписать команды под Ruby, сохранив init/up/down/restart/backup/restore/update и режимы topology |
| `.env.example`, `deploy/prod/.env.example` | сохранить совместимые внешние имена и значения; удалить только доказанно старые build-only переменные, добавляя mapping/decision |
| `.github/workflows/ci.yml` | заменить Node jobs на Ruby lint/unit/contract/integration/E2E/visual jobs |
| mock server packaging | допускается оставить минимальные JS-серверы как инфраструктурные test appliances либо перепаковать отдельно; их HTTP-поведение менять нельзя |
| PWA/assets | перенести в Ruby public/assets, сохранив URL, MIME, cache policy, размеры и checksum |

## Создать для нового проекта

- Ruby version pin, `Gemfile` и lockfile.
- Один deployable web-монолит с четырьмя логическими владельцами, без сетевых API между ними.
- Ruby migration chain и schema verification, воспроизводящие весь итог `06-data/`.
- Contract-test harness для 44 HTTP и всех внешних операций; он не должен импортировать внутренние Ruby-классы для black-box приёмки.
- DB concurrency suite и fault-injection для payment/merge/session/WebAuthn.
- Новый frontend/asset pipeline, воспроизводящий 19 страниц; автоматический screenshot/diff runner для 1440×1000 и 390×844.
- Команды одного Ruby-релиза: web, retention, reconciliation и при необходимости readiness refresh.
- Новый production validator, backup/restore/update runbook, operator README и CI.
- Prestage override, в котором реальные production URL/секреты запрещены, реальные платежи невозможны, а Mailpit закреплён digest из ADR-002.

## Безопасный порядок будущего исполнения

1. Зафиксировать Git commit/tag и отдельный архив исходного среза; сохранить checksum архива вне рабочего дерева.
2. Снять список контейнеров, images, networks и volumes; сделать логический backup обеих PostgreSQL и сохранить Redis только если он нужен для расследования активных операций.
3. Создать Ruby-реализацию рядом со старой, не удаляя старую и не переиспользуя её build-каталоги.
4. Подключить Ruby app к копии/отдельному prestage состоянию и сохранённым mock/spec-контейнерам.
5. Выполнить полную проверку из `99-llm/verification-prompt.md`, включая визуальный diff, SMTP и recovery; реальную оплату не выполнять.
6. Переключить Compose app/worker definitions на Ruby; повторить проверки после restart и backup/restore.
7. Сформировать точный `git diff --name-status` удаления и повторно получить подтверждение пользователя на этот список.
8. Удалить только подтверждённые пути одним отдельным изменением; не использовать широкие globs, корень, `$HOME` или рекурсивное удаление неразрешённых путей.
9. Проверить, что `software-spec/`, assets, mock/spec-контейнеры, данные, сети и пользовательские IDE-файлы остались.
10. Выполнить финальный чистый build/test/prestage start уже без старых исходников.

## Контроль после очистки

Проект считается чистым, если в нём нет Next.js/TypeScript/Prisma runtime-кода и Node-зависимостей приложения, но присутствуют Ruby-монолит, спецификация, визуальные эталоны, нейтральный acceptance harness, все нужные mock/spec-контейнеры, production/prestage orchestration, данные/backup и operator runbooks. Сам этот документ не является разрешением на удаление.
