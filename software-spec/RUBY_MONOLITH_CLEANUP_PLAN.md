# Запись о завершённой очистке перед Ruby on Rails монолитом

## Статус

**ЗАВЕРШЕНО ПОЛЬЗОВАТЕЛЕМ.**

Старое приложение Clean Pay на Next.js/TypeScript/Prisma намеренно удалено после создания самодостаточной спецификации. Этот файл больше не является инструкцией на будущее и не разрешает дополнительные удаления.

Исходный подробный план сохранён в Git-истории до изменения этого документа. Восстанавливать или проверять удалённое приложение для новой реализации не требуется.

## Что было удалено

- application source старой Next.js/TypeScript реализации;
- корневые application-level Node manifests и Next/TypeScript/Prisma tooling;
- старые tests и build/runtime artifacts, привязанные к удалённой реализации;
- старые application Docker/deploy entrypoints.

Точный исторический перечень и его обоснования доступны в предыдущей Git-ревизии этого файла.

## Что сохранено

| Объект | Текущая роль |
|---|---|
| `software-spec/` | нормативный продуктовый, интеграционный, визуальный и эксплуатационный контракт |
| `public/clean-pay-*.png` | брендовые и PWA assets |
| `public/themes/lara-light-indigo/` | эталонная тема и Inter fonts |
| `docker-compose.yml` | PostgreSQL/Redis и сохранённая integration/mock-инфраструктура без приложения |
| `infra/test/` | Caddy, Remnawave, Telegram OIDC/Bot API и Mailpit test doubles |
| PostgreSQL/Redis и Remnashop volumes | сохранённые данные и инфраструктурное состояние |
| `LICENSE`, `.editorconfig`, `.dockerignore`, `.gitattributes`, `.gitignore` | нейтральные файлы репозитория |
| `.idea/` | пользовательские IDE-файлы вне области автоматической очистки |

## Граница новой реализации

Ruby on Rails монолит владеет четырьмя логическими областями Clean Pay в одном продукте и релизе:

1. Identity and Access;
2. Subscriptions;
3. Payments;
4. Platform and Operations.

PostgreSQL, Redis, Remnashop, Remnawave, Telegram, Turnstile, SMTP/Mailpit, платёжные провайдеры и reverse proxy остаются внешними участниками. Сохранённые mock/spec-контейнеры используются для проверки этих границ.

## Рабочие документы

- корневой `RUBY_RAILS_RULES.md` задаёт обязательный Rails Way и правила качества;
- корневой `TECHNICAL_IMPLEMENTATION_PLAN.md` содержит полный file/feature backlog, три статуса каждой строки и единый verification cycle;
- `99-llm/implementation-order.md` задаёт последовательность продуктовой реализации;
- `99-llm/verification-prompt.md` задаёт итоговую совместимостную проверку.

## Текущее ограничение

Очистка завершена, но Ruby-приложение ещё не реализовано. Нельзя считать продукт готовым, пока каждая строка `TECHNICAL_IMPLEMENTATION_PLAN.md` не имеет трёх доказанных положительных статусов в одном полном verification cycle.

Любое последующее удаление данных, volumes, networks, integration containers, спецификации, эталонов или пользовательских файлов является новым отдельным действием и требует собственного точного перечня и явного подтверждения.
