# Clean Pay — чистая основа новой реализации

Старая Next.js/TypeScript/Prisma-реализация удалена. Репозиторий подготовлен для создания нового Ruby-монолита без потери продуктовых, интеграционных и визуальных контрактов.

## Что является источником истины

- [`software-spec/README.md`](software-spec/README.md) — полная системная спецификация;
- [`software-spec/99-llm/master-implementation-prompt.md`](software-spec/99-llm/master-implementation-prompt.md) — порядок передачи новой реализации;
- [`software-spec/05-frontend/`](software-spec/05-frontend/) — текущий визуальный контракт, 19 экранов и эталоны;
- [`software-spec/04-integrations/`](software-spec/04-integrations/) — точные внешние интерфейсы;
- [`RUBY_RAILS_RULES.md`](RUBY_RAILS_RULES.md) — обязательные правила реализации в стиле современного Ruby on Rails;
- [`TECHNICAL_IMPLEMENTATION_PLAN.md`](TECHNICAL_IMPLEMENTATION_PLAN.md) — полный file/feature backlog и статусы реализации, соответствия и работоспособности.

## Инфраструктура prestage

`docker-compose.yml` содержит только внешние зависимости и имитаторы:

- Clean Pay PostgreSQL и Redis с сохранёнными именованными томами;
- Remnashop app, worker, scheduler, PostgreSQL и cache;
- Remnawave mock;
- Telegram Bot API и OIDC mocks;
- Mailpit с закреплённым digest и webhook logger;
- Caddy в необязательном профиле `edge`.

Сервиса приложения намеренно нет. Будущий Ruby-монолит добавляется отдельным Compose override после появления его Dockerfile и health endpoint.

```bash
cp .env.example .env
make infra-config
make infra-up
```

`make infra-down` останавливает контейнеры без удаления томов. Команды сброса данных специально отсутствуют.

## Текущее состояние

Все контейнеры старого приложения погашены. Его исходники и application-level Node/Next/Prisma tooling намеренно удалены пользователем. Тома с данными, системная спецификация, визуальные эталоны, assets и интеграционная test/spec-инфраструктура сохранены.

Новый код приложения, Ruby/Rails-зависимости и CI пока не созданы. Реализация начинается с этапа 1 в `TECHNICAL_IMPLEMENTATION_PLAN.md`; общий статус остаётся `НЕ ГОТОВО`, пока все строки плана не пройдут один полный verification cycle.
