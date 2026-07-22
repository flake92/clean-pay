# Отчёт о подготовке репозитория

Дата проверки: 2026-07-22.

## Итог

Репозиторий очищен от прежней реализации приложения и подготовлен как нейтральная основа будущего Ruby-монолита. Внутреннее устройство старого приложения не переносится; его наблюдаемое поведение, данные, внешние контракты и визуальный дизайн сохранены в `software-spec/`.

## Физически удалено

- исходный код Next.js/TypeScript и frontend-компоненты;
- Prisma schema и migrations;
- старые unit, integration и E2E tests;
- Node package manifests, lock-файлы и конфигурация сборки;
- старые Dockerfile, devcontainer и production entrypoints;
- stack-specific CI/editor tasks и сгенерированные каталоги.

Удалённые отслеживаемые файлы остаются восстановимыми из Git до коммита пользователя. `.idea/` не изменялась.

## Сохранено

- `REVERSE_SYSTEM_ANALYSIS_PROMPT_RU.md`;
- полная независимая от реализации спецификация `software-spec/`;
- визуальные эталоны, снимки, дизайн-контракты и статические бренд-ресурсы `public/`;
- Remnawave, Telegram Bot API, Telegram OIDC и SMTP logger mocks в `infra/test/`;
- Remnashop app/worker/scheduler и его PostgreSQL/cache;
- Mailpit, Clean Pay PostgreSQL/Redis и Caddy;
- именованные Docker volumes с данными и инфраструктурным состоянием; команды удаления данных намеренно не добавлены.

Старый том `clean-pay-dev_node-modules` и образ `clean-pay-dev-app:latest` удалены как артефакты прежнего приложения. Образы Remnashop сохранены.

## Проверки после очистки

- базовый и `edge` Compose проходят `docker compose config --quiet`;
- оба PostgreSQL принимают подключения, Redis и Valkey отвечают `PONG`;
- Remnashop отвечает на `/health`, `/docs` и `/openapi.json`, его worker и scheduler работают;
- Remnawave mock, Telegram Bot mock, Telegram OIDC JWKS и Mailpit readiness отвечают HTTP 200;
- Caddy проксирует Remnashop и Mailpit; app-upstream намеренно недоступен до создания Ruby-приложения;
- нормативные checksums спецификации и визуальных эталонов проверяются перед передачей;
- после smoke-теста все контейнеры Clean Pay останавливаются без удаления volumes.

## Точка начала новой реализации

Начинать с `NEW_APPLICATION.md`, затем выполнять `software-spec/99-llm/implementation-order.md`. Готовность новой реализации определяется только манифестом `software-spec/09-traceability/reimplementation-readiness-manifest.md` и проверкой `software-spec/99-llm/verification-prompt.md`.
