# PAGE-012 — Возврат после оплаты: success hint

## Маршрут и принцип истины

`GET /payment/success`. Слово `success` в URL — только подсказка провайдера. Успех отображается исключительно после HTTP-032 по durable `operation_id` или `payment_id`.

## Структура

AppShell; динамический H1 и severity Message; карточки операции, платежа и подписки, если поля доступны; primary/outlined `Обновить`; переходы `В кабинет` и `К тарифам`. Reference берётся из поддержанных query aliases, затем из continuity storage.

## Машина состояний

No reference; loading; retryable pending; transient fetch error with known reference; confirmed success; confirmed fail; manual action; unknown terminal. Pending и transient error запускают bounded polling с server retry seconds; вкладка не создаёт покупку повторно. Terminal success очищает/заменяет continuity только по правилам payment helpers.

## Приёмка

Эталон фиксирует no-reference, поэтому PAGE-012 и PAGE-014 могут визуально совпадать: это ожидаемо. Fixtures обязаны различать status текстом/цветом, остановить polling на terminal/unmount, не объявлять success по pathname и корректно показывать неизвестный server status.
