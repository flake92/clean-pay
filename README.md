# Clean Pay — чистая основа новой реализации

Старая Next.js/TypeScript/Prisma-реализация удалена. Репозиторий подготовлен для создания нового Ruby-монолита без потери продуктовых, интеграционных и визуальных контрактов.

## Что является источником истины

- [`software-spec/README.md`](software-spec/README.md) — полная системная спецификация;
- [`software-spec/99-llm/master-implementation-prompt.md`](software-spec/99-llm/master-implementation-prompt.md) — порядок передачи новой реализации;
- [`software-spec/05-frontend/`](software-spec/05-frontend/) — текущий визуальный контракт, 19 экранов и эталоны;
- [`software-spec/04-integrations/`](software-spec/04-integrations/) — точные внешние интерфейсы;
- [`NEW_APPLICATION.md`](NEW_APPLICATION.md) — границы первого этапа Ruby-проекта.

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

Все контейнеры старого проекта погашены. Тома с данными и инфраструктурным состоянием сохранены; старый `node_modules` cache удалён. Новый код приложения, Ruby/Rails-зависимости и CI пока намеренно не созданы: их структура должна следовать спецификации, а не старому стеку.
