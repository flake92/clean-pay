# Clean Pay

Ruby on Rails 8.1 монолит, восстанавливаемый по полной продуктовой
спецификации. Старое приложение удалено намеренно; его код не используется как
источник реализации.

## Что является источником истины

- [`software-spec/README.md`](software-spec/README.md) — полная системная спецификация;
- [`software-spec/99-llm/master-implementation-prompt.md`](software-spec/99-llm/master-implementation-prompt.md) — порядок передачи новой реализации;
- [`software-spec/05-frontend/`](software-spec/05-frontend/) — текущий визуальный контракт, 19 экранов и эталоны;
- [`software-spec/04-integrations/`](software-spec/04-integrations/) — точные внешние интерфейсы;
- [`RUBY_RAILS_RULES.md`](RUBY_RAILS_RULES.md) — обязательные правила реализации в стиле современного Ruby on Rails;
- [`TECHNICAL_IMPLEMENTATION_PLAN.md`](TECHNICAL_IMPLEMENTATION_PLAN.md) — полный file/feature backlog и статусы реализации, соответствия и работоспособности.

## Локальная разработка

Требуются `mise`, Docker и Docker Compose. Первый этап использует Ruby `4.0.6`,
Rails `8.1.3` и отдельную базу `clean_pay_test`.

```bash
mise install
bundle install
docker compose up -d postgres redis
mise exec -- bin/ci
mise exec -- bin/dev
```

Приложение слушает `http://localhost:4000`. Продуктовые routes добавляются
контрактными блоками, поэтому после первого этапа корневого маршрута ещё нет.

`bin/setup` подготавливает development-базу и будет основным setup entrypoint
после реализации нормативных миграций. Пока сохранённая база `clean_pay` не
мигрируется и не сбрасывается. Для проверок используется только
`clean_pay_test`; команды `db:drop`, `db:reset` и удаление Compose volumes
запрещены.

## Prestage-инфраструктура

`docker-compose.yml` содержит только внешние зависимости и имитаторы:

- Clean Pay PostgreSQL и Redis с сохранёнными именованными томами;
- Remnashop app, worker, scheduler, PostgreSQL и cache;
- Remnawave mock;
- Telegram Bot API и OIDC mocks;
- Mailpit с закреплённым digest и webhook logger;
- Caddy в необязательном профиле `edge`.

Сервиса приложения пока нет. Он добавляется отдельным Compose override на этапе
контейнеризации после появления health endpoint.

```bash
cp .env.example .env
make infra-config
make infra-up
```

`make infra-down` останавливает контейнеры без удаления томов. Команды сброса данных специально отсутствуют.

## Состояние реализации

Этап 1 — минимальный Rails skeleton — реализован и локально проверен. В проекте
нет демонстрационных controllers, routes, credentials и заранее созданных
архитектурных каталогов. Новые файлы добавляются только вместе с конкретной
обязанностью в `TECHNICAL_IMPLEMENTATION_PLAN.md`.

Общий статус остаётся `НЕ ГОТОВО`, пока все строки плана не пройдут один полный
verification cycle.
