# Платёжные провайдеры

## Граница владения

Clean Pay не вызывает API платёжного провайдера напрямую и не принимает provider webhook. Он вызывает Remnashop, получает `payment_url`, отдаёт его браузеру и затем сверяет результат через Remnashop. Поэтому неизменяемый контракт Clean Pay — это `gateway_type`, `payment_id`, `payment_url`, суммы/валюта, статусы и recovery API Remnashop, а не приватные credentials конкретного провайдера.

```text
Clean Pay ── purchase/extend + Idempotency-Key ─► Remnashop
Remnashop ── create invoice/payment ────────────► активный провайдер
Remnashop ◄─ payment_id + payment_url ──────────┘
Clean Pay ── payment_url ─► браузер ─► провайдер
провайдер ── webhook/status ─► Remnashop
Clean Pay ── history/recovery ─► Remnashop
```

## Поддерживаемые значения `gateway_type`

Зафиксированная совместимая версия Remnashop определяет 15 вариантов:

`TELEGRAM_STARS`, `YOOKASSA`, `YOOMONEY`, `VALUTIX`, `CRYPTOMUS`, `HELEKET`, `CRYPTOPAY`, `FREEKASSA`, `MULENPAY`, `PAYMASTER`, `PLATEGA`, `ROBOKASSA`, `URLPAY`, `WATA`, `ROLLYPAY`.

В web offers не включается `TELEGRAM_STARS`; также исключаются неактивные и неполностью настроенные шлюзы. Clean Pay не должен жёстко ограничивать UI только заранее известным подмножеством, если Remnashop вернул валидное значение в offer, но runtime recovery принимает `gateway_type` по формату `[A-Z][A-Z0-9_-]{0,63}`.

## Зафиксированные provider endpoints Remnashop

Эти адреса описывают текущую внешнюю среду Remnashop и не являются прямыми вызовами Clean Pay.

| Gateway | Создание платежа / базовый endpoint |
|---|---|
| Cryptomus | `https://api.cryptomus.com` |
| Crypto Pay | `https://pay.crypt.bot/api/createInvoice` |
| FreeKassa | `https://api.fk.life/v1/orders/create` |
| Heleket | `https://api.heleket.com` |
| MulenPay | `https://mulenpay.ru/api/v2/payments` |
| PayMaster | `https://paymaster.ru/api/v2/invoices` |
| Platega | `https://app.platega.io` |
| Robokassa | `https://auth.robokassa.ru/Merchant/Index.aspx` с query-параметрами |
| RollyPay | `https://rollypay.io` |
| Telegram Stars | Telegram Bot API `createInvoiceLink` |
| UrlPay | `https://urlpay.io/api/v2/payments` |
| Valutix | `https://api.panel.valutix.kz/v1/orders` |
| Wata | `https://api.wata.pro/api/h2h/links`; дополнительный `GET public-key` |
| YooKassa | `https://api.yookassa.ru/v3/payments`; status `GET /v3/payments/{id}` |
| YooMoney | `https://yoomoney.ru` |

Точные provider payload, signature и webhook схемы принадлежат Remnashop. Они не должны переноситься внутрь новой Clean Pay без отдельного решения об изменении системной границы.

## Вебхук платёжного провайдера

В текущем окружении провайдеры направляют события в Remnashop по пути:

```text
POST {REMNASHOP_ORIGIN}/api/v1/payments/{gateway_type_lowercase}
```

Remnashop проверяет тип/настройку/signature, сохраняет валидированное событие и ставит фоновую обработку. Clean Pay webhook не принимает. Для некоторых шлюзов callback URL передаётся при создании платежа, для других настраивается в кабинете провайдера; Telegram Stars обрабатывается через Telegram API.

## Поведение Clean Pay

- Нулевая сумма обязана соответствовать `is_free=true`; `payment_url` тогда может быть `null`.
- Ненулевая pending-оплата обычно имеет HTTP(S) `payment_url`; браузер покидает Clean Pay.
- Серверный `return_url` ведёт только на pending-экран Clean Pay и содержит локальный `operation_id`.
- Возврат пользователя сам по себе не доказывает успех платежа.
- Неоднозначный dispatch сохраняется и проверяется через Remnashop; только capability-разрешённый gateway может быть автоматически retriggered. В зафиксированной версии auto-replay список содержит `YOOKASSA`.
- Пользователь не должен создавать новую оплату, пока исход предыдущей операции `IN_PROGRESS` или `UNKNOWN`.
