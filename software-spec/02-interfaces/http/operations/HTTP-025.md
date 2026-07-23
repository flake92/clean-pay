# Создать продление подписки

## Идентификатор

`HTTP-025`

## Назначение

Безопасно создать ровно одно продление по подтверждённой цене.

## Владелец

Модуль платежей.

## Акторы

Вошедший пользователь с подтверждённым e-mail.

## Предусловия

Те же, что HTTP-024; актуальные предложения содержат план, у которого `recommended_purchase_type` без учёта регистра равен `renew`.

## Логический входной контракт

Поля Rails-формы: `duration_days,gateway_type,confirmed_amount`,
`confirmed_currency,offer_version,submission_token`; `plan_code`, `return_url`,
клиентский idempotency key и неизвестные поля отбрасываются.

## Текущий транспорт

`POST /extensions`; Rails form scope
`extension[duration_days,gateway_type,confirmed_amount,confirmed_currency,offer_version,submission_token]`,
CSRF и полная сессия. Идемпотентность создаётся и подписывается сервером.

## Правила валидации

Форматы и границы общих полей полностью совпадают с HTTP-024. План выбирается сервером из свежего RS-014; duration/gateway и подтверждение предложения сверяются перед dispatch.

## Нормализация

Во внешний RS-016 передаются только duration, gateway и серверный return URL; внешний ключ стабилен для локальной операции.

## Авторизация

Двойная проверка локального user и привязка upstream owner как в HTTP-024.

## Идемпотентность

Тот же state machine, UUID-key, canonical-payload constraint, лимит 10/900 секунд и replay semantics, что HTTP-024; kind операции `EXTEND`, поэтому purchase и extend не взаимозаменяемы.

## Основной сценарий

Создать/захватить operation, перечитать renewal offer, сверить цену, durable отметить dispatch, вызвать RS-016, сохранить платёж и успех, записать audit.

## Альтернативные сценарии

Все состояния выполняют `303` на авторитетный member resource; replay,
in-progress, outcome-unknown, manual-required и сохранённая ошибка не создают
повторный dispatch. Заголовки совпадают с HTTP-024.

## Ошибочные сценарии

Те же классы, что HTTP-024. Отсутствие renewal plan/duration — `400 PLAN_UNAVAILABLE`; gateway — `400 PAYMENT_GATEWAY_UNAVAILABLE`; изменившееся предложение — `409 OFFER_CHANGED`.

## Логический результат

`303 See Other` на страницу платежа/подписки либо безопасный Rails render состояния операции.

## Побочные эффекты

Rate-limit, operation, внешний платёж продления, локальная история, аудит и refresh.

## Транзакционные требования

Идентичны HTTP-024; внешняя операция не атомарна с БД и восстанавливается HTTP-038.

## Наблюдаемость

Operation kind `EXTEND`, operation ID, outcome и latency без секретов.

## Источники

Доказательства находятся в `09-traceability/`; RS-014/RS-016 и разделы 03/06.

## Статус уверенности

`требует повторной проверки после ADR-003`
