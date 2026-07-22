# PAGE-013 — Возврат после оплаты: fail hint

## Маршрут и принцип истины

`GET /payment/fail`. Pathname сообщает только provider hint. Истинный результат — HTTP-032, как на PAGE-012.

## Структура и действия

Та же композиция PaymentReturnStatus: динамический заголовок/Message; детали operation/payment/subscription; `Обновить`; `В кабинет`; `К тарифам`. В отсутствие durable reference объясняется невозможность проверить операцию; UI не предлагает создать второй платёж одной кнопкой.

## Состояния

No reference; loading; confirmed failed/cancelled/expired; server says pending despite fail hint; server says success despite fail hint; manual; transient error. Server payload всегда сильнее hint. Polling выполняется только для retryable состояния и известного reference.

## Приёмка

Эталон PAGE-013 — no-reference fail branch. Проверить конфликт hint/status в обе стороны, публичное error-сообщение, отсутствие утечки provider payload, keyboard/focus и прекращение polling.
