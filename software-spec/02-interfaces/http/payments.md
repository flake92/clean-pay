# HTTP-контракты платежей Rails-монолита

Доказательства: TRACE-HTTP-024, 025, 031, 032, 038 и ADR-003.

## Общий контракт отправки платежа

HTTP-024 и HTTP-025 — обычные Rails form submissions с CSRF, полной
подтверждённой сессией и последующим `303 See Other`. Браузер не создаёт
idempotency key: Rails выдаёт подписанный ограниченный по времени
`submission_token`, а форма только возвращает его без изменений. Неизвестные
поля и входной `return_url` отбрасываются strong parameters.

Поля подтверждения:

- `duration_days`: безопасное целое 0…365000;
- `gateway_type`: непустая строка до 100 символов;
- `confirmed_amount`: каноническая неотрицательная decimal-строка до 64
  символов;
- `confirmed_currency`: 2…12 заглавных латинских букв или цифр;
- `offer_version`: SHA-256 канонического свежего предложения;
- `submission_token`: серверно подписанное одноразовое состояние формы.

Перед внешним dispatch Rails повторно читает RS-014 и точно сверяет план,
длительность, способ, сумму, валюту и версию. Новый submission ограничен десятью
операциями за 15 минут. Replay того же токена с тем же payload не выполняет
второй изменяющий вызов; другой payload даёт конфликт. Durable dispatch marker
всегда фиксируется до RS-015/016.

Ответ `303` ведёт на `GET /payments/:operation_id`. Диагностические заголовки:
`cache-control:no-store`, `idempotency-replayed:true|false`,
`x-payment-operation-id`. Страница состояния показывает успешный, ожидающий,
неопределённый, финально ошибочный либо требующий оператора результат. Проверенный
HTTP(S) payment URL доступен только как внешний переход с `noopener`,
`noreferrer` и запретом referrer.

## HTTP-024 — покупка

- `POST /purchases`, scope формы `purchase`.
- Дополнительное поле `plan_code` — 1…200 символов.
- Rails сам формирует return URL с локальным operation ID.
- Успех, неизвестный исход и сохранённая ошибка одинаково переходят на
  авторитетный member resource; повторная оплата при неизвестном исходе не
  предлагается.

## HTTP-025 — продление

- `POST /extensions`, scope формы `extension`.
- `plan_code` от браузера не принимается: renewal-план выбирается из свежего
  RS-014 по `recommended_purchase_type=renew`.
- Остальные правила полностью совпадают с HTTP-024.

## HTTP-031 — история

- `GET /payments`, server-rendered collection resource.
- Rails owner-fence синхронизирует одну capability/keyset-страницу размером не
  более 100 либо legacy-список и атомарно upsert-ит записи.
- Рендерятся 20 последних записей по внешнему времени и payment ID в убывающем
  порядке; чужой owner никогда не перезаписывается, более старый snapshot не
  откатывает новый.

## HTTP-032 — состояние

- `GET /payments/:id`, где `id` — локальный durable operation ID текущего
  пользователя.
- Рендерятся operation и связанный payment record; чужой ID не раскрывается.
- Terminal operation читается локально. Для `dispatching`/`outcome_unknown`
  reconciliation выполняется внутренним ограниченным worker, а страница
  предлагает безопасное обновление без нового dispatch.
- Ответ `text/html`, `cache-control:no-store`.

## HTTP-038 — внутренняя сверка

- `POST /internal/payment_reconciliations` — единственная машинная JSON-команда
  платежного модуля; cookie, browser CSRF и HTML здесь не применяются.
- Требуется `x-clean-pay-reconciliation-secret`; disabled, пустой или неверный
  secret одинаково дают пустой `404`.
- В пределах 12 секунд обрабатывается настроенная пачка expired
  dispatch/outcome claims, затем один history backfill. Сетевые вызовы находятся
  вне SQL-транзакций, а settlement защищён claim token и lease.
- JSON содержит `claimed,succeeded,deferred,manual_required,failed` и вложенные
  history-счётчики; `cache-control:no-store`.
