# Создать покупку подписки

## Идентификатор

`HTTP-024`

## Назначение

Безопасно создать ровно одну внешнюю покупку по явно подтверждённому пользователем актуальному предложению.

## Владелец

Модуль платежей.

## Акторы

Вошедший пользователь с подтверждённым e-mail.

## Предусловия

Полная разрешённая сессия, Remnashop-связь, отсутствие запрещающего payment/merge fence.

## Логический входной контракт

JSON: `plan_code:string`, `duration_days:number`, `gateway_type:string`, `confirmed_amount:string`, `confirmed_currency:string`, `offer_version:string`. Клиентский `return_url` и неизвестные поля не используются.

## Текущий транспорт

`POST /api/bff/subscription/purchase`; JSON UTF-8 до 65 536 байт; доверенный origin; session cookie; обязательный `Idempotency-Key` UUID.

## Правила валидации

`plan_code` 1…200; duration — safe integer 0…365000; gateway 1…100; amount `^(?:0|[1-9]\d*)(?:\.\d{1,8})?$`, максимум 64; currency `^[A-Z0-9]{2,12}$`; offer version 1…2048. Trim отсутствует. Перед dispatch повторно читается RS-014 и точно проверяются plan, duration, gateway, amount, currency и версия.

## Нормализация

Во внешний запрос уходят только `plan_code,duration_days,gateway_type` и серверный return URL с `operation_id`; внешний ключ является стабильным производным локальной операции.

## Авторизация

Сессия проверяется до создания операции и повторно после внешней авторизации; смена user ID даёт 401. Upstream owner фиксируется и сверяется.

## Идемпотентность

Один ключ + тот же канонический payload возвращает сохранённый успех/ошибку либо состояние исполнения. Тот же ключ с иным payload — `409 IDEMPOTENCY_KEY_REUSED`. Новый ключ ограничен 10 операциями/900 секунд. Dispatch выполняется только после durable отметки.

## Основной сценарий

Захватить/создать durable operation; привязать upstream owner; перечитать предложение; отметить dispatch; вызвать RS-015; проверить/допустить отсутствующий echoed return URL; атомарно сохранить платёж и успех; записать audit; вернуть 200.

## Альтернативные сценарии

Сохранённый успех возвращается с `idempotency-replayed:true`. Конкурирующая обработка — 202 `processing`. Неопределённый внешний исход — 202 `outcome_unknown`. Требование оператора — 409 `manual_required`. Сохранённая финальная ошибка воспроизводится без dispatch.

## Ошибочные сценарии

`400 VALIDATION_ERROR/PLAN_UNAVAILABLE/PAYMENT_GATEWAY_UNAVAILABLE`; `401`; `403`; `409 OFFER_CHANGED/IDEMPOTENCY_KEY_*` и fences; `413`; `415`; `429`; внешние/контрактные ошибки `502`; локальная `500`. После dispatch транспортный или неоднозначный сбой не выдаётся как безопасная финальная ошибка: возвращается 202 до сверки.

## Логический результат

Успех `200 {"data":{"payment_id":string,"payment_url":string|null,"purchase_type":string,"status":string,"is_free":boolean,"final_amount":string,"currency":string,"return_url"?:string|null}}`; pending/manual — точные схемы из `payments.md`. Всегда `cache-control:no-store`, `idempotency-replayed`, `x-payment-operation-id`; для 202 также `retry-after`.

## Побочные эффекты

Rate-limit, durable operation, внешний платёж, локальная запись платежа, аудит и возможный refresh сессии.

## Транзакционные требования

Захват, dispatch marker и settlement используют блокировки/CAS. Внешний вызов не входит в SQL-транзакцию; crash windows закрываются состояниями outcome_unknown/manual_required и сверкой HTTP-038.

## Наблюдаемость

Во всех технических событиях есть operation ID/kind, но нет токенов, payment URL и секретов; отдельно логируется ошибка settlement.

## Источники

Доказательства находятся в `09-traceability/`; внешние RS-014/RS-015, модель данных и алгоритм идемпотентности — в разделах 03/06.

## Статус уверенности

`подтверждено`
