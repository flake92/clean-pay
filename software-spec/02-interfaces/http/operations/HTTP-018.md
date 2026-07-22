# Подтвердить Telegram-merge

## Идентификатор

`HTTP-018`

## Назначение

После явного согласия пользователя объединить внешних владельцев с правилами «e-mail target, Telegram source, платежи source rekey», доказать итог и связать локального владельца.

## Владелец

Модуль доступа и идентичности.

## Акторы

Вошедший пользователь.

## Предусловия

Сессия, merge-cookie и действующая confirmation. На этапе постановки уже выполнен dry-run preflight и проверено владение; перед commit всё проверяется повторно.

## Логический входной контракт

Тело отсутствует; merge token из cookie; никакого `redirectTo` в запросе нет.

## Текущий транспорт

`POST /api/bff/auth/telegram/merge-confirmation`; bodyless; доверенный origin; Content-Type не нужен.

## Правила валидации

Лимит 5/900 секунд по confirmation Telegram ID. Проверяются session/token, срок, status, локальный owner, текущая Telegram-auth owner, source profile, отсутствие pending e-mail, повторный admin dry-run, точное совпадение target и конфликтов. Payment-owner fence блокирует смену во время неоднозначных операций.

## Нормализация

E-mail trim/lower-case; все внешние owner IDs сравниваются строкой.

## Авторизация

Session + owner-bound token + повторная Telegram HMAC-auth + admin API key для merge.

## Идемпотентность

Повтор завершённой confirmation возвращает успешный replay без второго merge. Потерянный ответ внешнего commit распознаётся: если Telegram уже аутентифицирует target, deleted source повторно не вызывается, а финальное владение доказывается.

## Основной сценарий

1. Audit попытки и rate-limit.
2. Под row lock user атомарно claim confirmation в `PROCESSING`, lease 120 секунд, increment attemptCount.
3. Под payment fence повторно доказать локальное и внешнее владение.
4. Если Telegram ещё source: dry-run RS-028, затем commit RS-028 с `KEEP_TARGET`, `KEEP_SOURCE`, `REKEY_SOURCE`.
5. Повторно Telegram-auth; проверить target ID, Telegram ID, подтверждённый target e-mail, отсутствие pending e-mail и ожидаемое наличие подписки.
6. Связать локального user, инвалидировать sibling external tokens.
7. Перевести confirmation в `COMPLETED`, обновить access-cookie и audit success.

## Альтернативные сценарии

- Status COMPLETED → `{merged:true,userId}` и replay audit.
- Истёкшая lease PROCESSING может быть заново захвачена.
- Транзиентная ошибка возвращает status в PENDING и допускает retry.
- Терминальные `ACCOUNT_MERGE_REQUIRED`/`ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT` переводят запись в FAILED.

## Ошибочные сценарии

`401`, `404`, `409 ACCOUNT_MERGE_REQUIRED`, `409 ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT`, `409 ACCOUNT_MERGE_IN_PROGRESS`, `409 CONFLICT` параллельной обработки, `429`, `502` внешних сервисов, `500`. Для двух terminal merge-code ответ также очищает merge-cookie; другие ошибки cookie сохраняют для retry. Audit failure может влиять на ответ согласно месту ошибки.

## Логический результат

`200`:

```json
{"data":{"merged":true,"userId":"local-user-id"}}
```

Merge-cookie очищается (`Max-Age=0`, HttpOnly, Path `/`, config Secure/SameSite). Полей `success` и `redirectTo` нет.

## Побочные эффекты

External merge, перенос/перепривязка платежей и подписки согласно Remnashop, локальное объединение/токены, confirmation state, cookie, audits.

## Транзакционные требования

Claim и completion — отдельные локальные транзакции вокруг внешнего действия. Lease и доказательство итогового owner обеспечивают повторяемое восстановление; распределённой атомарности нет.

## Наблюдаемость

Audit attempted/succeeded/failed содержит confirmation ID, error code, retryable; секретный token не записывается.

## Источники

Доказательства находятся в `09-traceability/`.

## Статус уверенности

`подтверждено`
