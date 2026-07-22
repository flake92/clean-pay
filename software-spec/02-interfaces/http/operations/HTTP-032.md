# Получить состояние платежа

## Идентификатор

`HTTP-032`

## Назначение

Без создания нового платежа определить состояние операции, локальной записи и подписки после возврата от провайдера.

## Владелец

Модуль платежей.

## Акторы

Вошедший пользователь с подтверждённым e-mail.

## Предусловия

Полная сессия; для внешней сверки — Remnashop-связь и совпадающий owner.

## Логический входной контракт

Query: необязательный `payment_id` — UUID version 1…8/variant RFC; необязательный `operation_id` — 1…191 символов `[A-Za-z0-9_-]`. Повторяющиеся query-поля читаются как первое значение стандартного `get`; прочие игнорируются.

## Текущий транспорт

`GET /api/bff/payments/status?payment_id=...&operation_id=...`; session cookie.

## Правила валидации

Переданное пустое или неверное значение — 400. Operation ищется только с `userId` текущего пользователя. Если relation операции содержит иной payment ID, совместная пара даёт 409.

## Нормализация

Состояния операции: `processing|succeeded|failed|retry_ready|outcome_unknown|manual_required`; повтор через 5 секунд только для `processing`/`outcome_unknown`; ручное состояние выставляет поддержку/действие оператора. Платёж сериализуется как HTTP-031.

## Авторизация

Сессия/e-mail; все локальные queries ограничены user ID; внешняя ветка дополнительно проверяет upstream owner.

## Идемпотентность

Логическое чтение; может выполнить ровно одну reconciliation и upsert истории.

## Основной сценарий

Сначала прочитать авторитетную локальную operation. Если она не terminal — сверить exact payment либо одну страницу, reconciliation limit 1, перечитать operation, затем RS-013 и локальную payment record.

## Альтернативные сценарии

Terminal manual/failure/success возвращается без Remnashop с `source=local_terminal_payment_operation`. При upstream-сбое уже успешная operation также возвращается локально. `SUBSCRIPTION_NOT_FOUND` означает `subscription:null`, а не ошибку. Без IDs выбираются свежая незавершённая operation и/или последний payment.

## Ошибочные сценарии

`400 VALIDATION_ERROR`, `401`, `403`, `409 CONFLICT`, `502` upstream/contract, `500`. Чужой/неизвестный operation ID не раскрывается: `operation:null`.

## Логический результат

`200 {"data":{"payment":object|null,"operation":object|null,"subscription":object|null,"source":"local_terminal_payment_operation"|"local_payment_record_and_current_subscription"}}`.

## Побочные эффекты

Sync/reconciliation, история, operation settlement и refresh; нового dispatch нет.

## Транзакционные требования

Правила owner lock/CAS из модели платежей; reread обязателен после reconciliation.

## Наблюдаемость

Operation ID и режим источника допустимы; URL/токены/секреты запрещены.

## Источники

Доказательства находятся в `09-traceability/`; HTTP-031, HTTP-038 и модель 03.

## Статус уверенности

`подтверждено`
