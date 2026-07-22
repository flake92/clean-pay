# Начало новой реализации

## Цель

Создать один Ruby-монолит Clean Pay. Remnashop, Remnawave, Telegram, SMTP/Mailpit, Turnstile, платёжные провайдеры, PostgreSQL, Redis и reverse proxy остаются внешними сервисами.

## Перед созданием кода

1. Прочитать `software-spec/99-llm/implementation-context.md` и `immutable-contracts.md`.
2. Превратить 44 карточки `software-spec/02-interfaces/http/operations/` в black-box contract tests.
3. Выбрать Ruby web-framework и ORM отдельным решением; не копировать внутреннюю архитектуру старого приложения.
4. Создать Ruby migrations, воспроизводящие итоговую схему `software-spec/06-data/`.
5. Добавить сервис приложения через отдельный `docker-compose.app.yml`, не изменяя контракты базового prestage.
6. Реализовывать модули в порядке `software-spec/99-llm/implementation-order.md`.

## Обязательная проверка перед первым релизом

Выполнить `software-spec/99-llm/verification-prompt.md`: HTTP, внешние сервисы, конкурентность, SMTP, полный mock-stack E2E, backup/restore и визуальный diff всех 19 страниц.

## Чего здесь больше нет

Нет исходного Next.js/TypeScript-кода, Prisma, Node package manifests, старых unit/E2E runners и production entrypoints. Доказательства их поведения сохранены только в `software-spec/09-traceability/`.
