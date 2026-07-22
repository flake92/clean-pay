# Выполнить внутреннюю сверку платежей

## Идентификатор

`HTTP-038`

## Назначение

Довести неопределённые платежные операции и фоновую историю до подтверждённого состояния без повторного создания платежа.

## Владелец

Модуль платежей.

## Акторы

Внутренний планировщик/оператор.

## Предусловия

Reconciliation включена; secret длиной не менее 32 символов и batch size валидны.

## Логический входной контракт

Заголовок `x-clean-pay-reconciliation-secret`; тело/query не читаются.

## Текущий транспорт

Внутренний dynamic `POST /api/internal/payments/reconcile`; пользовательская сессия, JSON Content-Type и browser Origin не требуются.

## Правила валидации

Disabled/пустой secret и неверный supplied secret одинаково дают 404; сравнение SHA-256 constant-time. Reconciliation получает configured batch limit/deadline 12 000 мс; history backfill — limit 1 и отдельные 12 000 мс.

## Нормализация

Счётчики algorithms объединяются с полем `history`; точная схема счётчиков закреплена в разделе фоновых процессов.

## Авторизация

Только внутренний secret, без cookie.

## Идемпотентность

Повтор безопасен благодаря claim/lease/CAS, owner locks и монотонной истории; каждый запуск может продвинуть работу.

## Основной сценарий

Захватить ограниченную пачку unknown/dispatching operations, проверить external transactions, settle; затем продолжить один history backfill; вернуть счётчики.

## Альтернативные сценарии

Пустая очередь — успешные нулевые счётчики. Deadline останавливает набор новой работы, сохраняя уже завершённые элементы.

## Ошибочные сценарии

`404 NOT_FOUND` для disabled/secret; нормализованные `409/502` отдельных критичных конфликтов/upstream; `500` непредвиденной ошибки. Endpoint-level catch использует стандартную BFF error envelope.

## Логический результат

`200 {"data":{<reconciliation counters>,"history":<history counters>}}`, `cache-control:no-store`.

## Побочные эффекты

External reads, operation/payment/history updates, leases, audit/technical events.

## Транзакционные требования

Каждый claim/settlement атомарен отдельно; сетевой вызов вне SQL-транзакции; ownership никогда не переносится.

## Наблюдаемость

Batch counters, operation IDs и outcome classes; secret/tokens/URL исключены.

## Источники

Доказательства находятся в `09-traceability/`; алгоритмы и exact counters — разделы 03, 06, 07.

## Статус уверенности

`подтверждено`
