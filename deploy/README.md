# Clean Pay: deploy и recovery

Этот комплект запускает один Rails-релиз тремя процессами: `app`, обязательный
`retention` и опциональный профиль `reconciliation`. PostgreSQL, Redis,
Remnashop, Remnawave, Telegram, Mailpit и Caddy остаются внешними сервисами из
`docker-compose.yml`. Ни одна штатная команда ниже не удаляет volumes.

## Prestage

1. Скопировать `.env.example` в `.env` и заменить только безопасные локальные
   значения, затем задать `CLEAN_PAY_ENV_FILE=.env`. Без этого override Compose
   использует безопасный `.env.example`. Общая сеть `CLEAN_PAY_EDGE_NETWORK`
   должна уже существовать.
2. Проверить конфигурацию: `make infra-config app-config`.
3. Поднять внешние зависимости: `make infra-up`.
4. Собрать и запустить Rails: `make app-up`.
5. Проверить liveness, структуру routes/schema/плана: `make app-verify`.
6. Остановить только процессы Rails: `make app-down`.
7. Остановить общую инфраструктуру без удаления данных: `make infra-down`.

Порт `4000` проверяется до запуска. Второй процесс поверх занятого порта не
запускается. `docker compose down -v`, `db:drop`, `db:reset` и неявное создание
неизвестной production edge-сети запрещены.

## Production

Production `.env` не включается в image и проверяется до deploy:

```bash
mise exec -- scripts/validate-env.rb /secure/path/clean-pay.production.env
docker compose -f docker-compose.yml -f docker-compose.app.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.app.yml up -d app retention
```

`bin/docker-entrypoint` выполняет сериализованные advisory-lock миграции до
Puma, когда `RUN_MIGRATIONS=true`. Ошибка конфигурации, ожидания зависимости или
миграции запрещает старт HTTP. После обновления проверяются публичная liveness и
защищённая readiness.

Для включённой сверки задаются отдельный
`PAYMENT_RECONCILIATION_SECRET`, точный внутренний URL и профиль:

```bash
docker compose -f docker-compose.yml -f docker-compose.app.yml \
  --profile reconciliation up -d reconciliation
```

## Backup перед обновлением

Writers останавливаются или переводятся в maintenance. Backup создаётся без
передачи пароля дочерним `psql`/`pg_dump` в аргументах процесса. Команда
выполняется внутри immutable release image (там уже есть Ruby 4 и PostgreSQL 17
client) либо на операторском host с теми же инструментами; каталог backup
монтируется отдельно с mode `0700`:

```bash
mise exec -- scripts/backup.rb \
  --database-url "$DATABASE_URL" \
  --output-dir /secure/backups \
  --image-id "$CLEAN_PAY_IMAGE" \
  --refresh-key-id "$WEB_REFRESH_KEY_ID"
```

Результат — custom-format `pg_dump` и JSON manifest с SHA-256, schema version,
row counts всех 15 таблиц, image ID и идентификатором refresh-key. Оба файла
имеют mode `0600`.

## Учебное и аварийное восстановление

Создаётся отдельная пустая БД той же PostgreSQL major-версии. Restore требует
явного имени цели, отказывается от непустой БД и от имени исходной БД. Как и
backup, команда запускается в release image либо на host с Ruby 4 и
PostgreSQL 17 client:

```bash
mise exec -- scripts/restore.rb \
  --database-url "$RESTORE_DATABASE_URL" \
  --expect-database clean_pay_restore_rehearsal \
  --manifest /secure/backups/clean-pay-YYYYMMDDTHHMMSSZ.json
```

После checksum/restore скрипт сравнивает migration version и row counts.
Затем на восстановленной БД выполняются pending migrations, internal readiness,
выборочные login/history/`OUTCOME_UNKNOWN`/merge/worker-claim проверки без
создания внешнего платежа. Трафик возвращается только после проверки heartbeat
и очереди ручных платежей.

## Rollback

Откат приложения означает возврат на предыдущий immutable image. Миграции не
откатываются автоматически. Перед переключением проверяется, что предыдущий
image совместим с уже применённой схемой; иначе восстанавливается заранее
проверенный backup в новую БД и меняется `DATABASE_URL`. Redis можно построить
заново, PostgreSQL и ключ шифрования token bundles терять нельзя.
