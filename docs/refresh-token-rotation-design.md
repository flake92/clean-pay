# Refresh token rotation и reuse detection

## Модель

Одна строка `WebSession` является token family. Поле `refreshTokenHash` хранит текущий токен семьи. Новая таблица `WebRefreshToken` хранит хеш каждого уже использованного токена, зашифрованный единственный successor и окончание grace window.

Миграция `20260720233000_add_refresh_token_rotation` является обратно совместимой: существующие сессии остаются валидными и переходят на ротацию при первом refresh. Массовый logout не требуется.

## Атомарный переход

1. Транзакция находит семью по текущему или ранее использованному token hash.
2. `SELECT ... FOR UPDATE OF session` сериализует refresh одной семьи.
3. Для текущего токена создаётся ровно один successor, текущий hash заменяется, а использованный токен записывается в `WebRefreshToken`.
4. Повтор использованного токена в течение 10 секунд расшифровывает и возвращает тот же successor. Новая ветка не создаётся.
5. Повтор после grace window отзывает только эту `WebSession`/family и создаёт WARN audit `refresh_token_reuse_detected`.
6. Другие сессии пользователя не отзываются.

Successor шифруется AES-256-GCM через versioned keyring; в открытом виде в БД не хранится. Хеши остаются односторонними. Новые envelope имеют формат `v2.<key-id>.<secret-commitment>.<iv>.<tag>.<ciphertext>`. Commitment — необратимая усечённая HMAC-привязка высокоэнтропийного секрета, поэтому замена секрета с тем же id не маскируется под current ciphertext. Ключи для refresh-successor, Remnashop token bundle и durable Telegram result выводятся для разных purpose. Существующие `v1.<key-id>.<iv>.<tag>.<ciphertext>` и старые трёхчастные envelope читаются только явно разрешёнными ключами и переписываются в v2 при первом изменяющем чтении или background migration.

## Ротация ключа шифрования

`WEB_REFRESH_KEY_ID` и `WEB_REFRESH_SECRET` задают единственный write key. `WEB_REFRESH_PREVIOUS_KEYS` — JSON object из не более чем четырёх явно разрешённых read keys. Секреты должны быть уникальными. Предпочтительный протокол использует новый id для нового секрета. Для восстановления ошибочной/аварийной same-id rotation разрешена ровно одна previous entry с тем же id: v2 выбирает ключ по id+commitment, v1 пробует только явно разрешённые секреты с точно совпадающим id, а legacy — весь ограниченный keyring.

Порядок плановой или аварийной ротации:

1. Сохранить резервную копию и зафиксировать текущие key id. Не удалять текущий секрет.
2. Развернуть новый `WEB_REFRESH_KEY_ID`/`WEB_REFRESH_SECRET`, а старый id/secret поместить в `WEB_REFRESH_PREVIOUS_KEYS`. Если id вынужденно остался прежним, поместить старый секрет под тем же id в previous object до запуска приложения с новым write secret; без явно сохранённого старого секрета ciphertext fail closed как unreadable.
3. Проверить refresh grace replay, Remnashop session recovery и durable Telegram callback replay. Старые строки читаются dual-read/current-write и CAS-переписываются под новый key id; события `encrypted_session_bundle_rewrapped`, `encrypted_refresh_recovery_rewrapped`, `encrypted_refresh_successor_rewrapped` и `encrypted_telegram_callback_result_rewrapped` позволяют наблюдать online-rewrap без пользовательских идентификаторов.
4. В одноразовом контейнере с application-role environment запустить bounded report (по умолчанию команда ничего не изменяет):

   ```text
   node deploy/prod/encryption-rewrap-command.mjs --report --batch-size=100 --max-batches=10
   ```

   Затем запускать bounded CAS migration до полного прохода:

   ```text
   node deploy/prod/encryption-rewrap-command.mjs --apply --batch-size=100 --max-batches=10
   ```

   `batch-size` ограничен 1–500, `max-batches` — 1–1000 для каждого хранилища. Отчёт содержит только агрегаты: количество просмотренных/перешифрованных ciphertext, CAS conflicts, unreadable envelopes и использование non-secret key id. Строковые id, ciphertext и ключи в лог не попадают. При `unreadable` или CAS conflict команда завершается ненулевым кодом; конфликтный batch безопасно повторяется.
5. Повторять apply/report до нулевого полного прохода, затем использовать отдельный fail-closed gate:

   ```text
   node deploy/prod/encryption-rewrap-command.mjs --retirement-check --batch-size=100 --max-batches=1000
   ```

   `--retirement-check` завершается ненулевым кодом при `complete=false`, `needsRewrap>0`, `unreadable>0`, CAS conflicts или `retirementReady=false`. Обычный `--report` остаётся диагностическим bounded report и сам по себе не является retirement gate. Одновременно убедиться, что online old-key counters больше не растут.
6. Дождаться как минимум полного TTL активных grace-successor. Только после нулевого отчёта и согласованного окна удалить previous key.
7. После удаления previous key снова проверить refresh, lost-response grace replay, provider recovery, Telegram callback replay и payment-path smoke на синтетическом аккаунте.

Rollback до удаления старого ключа выполняется обратной сменой primary: прежний id/secret снова становится write key, новый переносится в previous. После удаления секрета rollback невозможен без его восстановления из одобренного secret store/backup, поэтому retirement является отдельным согласованным шагом.

## Concurrency и тесты

- Unit-тест проверяет повтор старого токена внутри grace и возврат того же successor.
- Unit-тест проверяет поздний reuse, отзыв family, очистку cookies и WARN audit.
- PostgreSQL concurrency-тест запускает два параллельных refresh: оба получают один successor, создаётся одна history row; поздний reuse отзывает только тестовую family.

## Retention

История использованных токенов живёт до удаления `WebSession` и удаляется каскадно. Это необходимо для reuse detection токенов старше одной ротации. Существующая очистка истёкших/отозванных сессий ограничивает срок хранения.

## Rollback

Старый код игнорирует новую таблицу и `refreshRotatedAt`, поэтому приложение можно откатить без немедленного отката схемы. После первой ротации cookie содержит token, чей hash находится в существующем `WebSession.refreshTokenHash`, поэтому старый код продолжит принимать его. Удалять таблицу следует только после полного rollback и истечения активных сессий.
