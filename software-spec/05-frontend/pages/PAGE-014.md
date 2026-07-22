# PAGE-014 — Возврат после оплаты: pending hint

## Маршрут и принцип истины

`GET /payment/pending`. Hint `pending` запускает проверку, но не заменяет HTTP-032. Reference разрешается теми же aliases/storage, что PAGE-012.

## Структура, polling и действия

Общий PaymentReturnStatus. При известном reference сразу показывается loading/pending Message и начинается bounded polling. `Обновить` запускает немедленную одиночную проверку без параллельного цикла. `В кабинет` и `К тарифам` всегда доступны после завершения текущего запроса.

## Состояния

No reference; polling pending; accepted; manual; transient error с продолжением; terminal success/fail/expired/cancelled; unknown. Delay учитывает server retry seconds, имеет верхнюю границу и прекращается при уходе со страницы.

## Приёмка

Эталон PAGE-014 — no-reference и поэтому совпадает с PAGE-012 в данной сцене. Fixture с operation reference обязателен для visual regression spinner/status cards. Проверить один in-flight request, back/forward storage continuity и отсутствие бесконечного tight loop.
