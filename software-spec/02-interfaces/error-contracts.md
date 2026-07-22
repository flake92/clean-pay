# Контракты ошибок

## Оболочка BFF

Все handlers, использующие `bffError`, возвращают JSON:

```json
{"error":{"code":"<CODE>","message":"<public-or-debug-message>"}}
```

В development добавляется `error.debug` с исходным `message` и доступными `upstreamStatus`, `upstreamPath`, `upstreamDetail`, `retryAfterSeconds`, `cause`. В production `debug` отсутствует и для нормализованной ошибки используется фиксированное русское публичное сообщение. Неизвестная ошибка становится HTTP 500 `INTERNAL_ERROR`.

## Ошибки пограничной политики

| Status | Body | Condition |
|---:|---|---|
| 403 | `{"error":{"code":"FORBIDDEN","message":"Источник запроса не разрешён."}}` | mutation Origin/Referer не равен trusted public origin |
| 415 | `{"error":{"code":"VALIDATION_ERROR","message":"Для этого запроса требуется application/json."}}` | body-bearing protected mutation с неподдерживаемым Content-Type |
| 403 | `{"error":{"code":"EMAIL_NOT_VERIFIED","message":"Подтвердите e-mail, чтобы продолжить."}}` | authenticated unverified e-mail обращается к blocked API |
| 401 | framework/proxy API response, точный body описывается в access policy | protected API без session candidate |


## Ошибки разбора JSON

| Status | Code | Development message | Condition |
|---:|---|---|---|
| 413 | `VALIDATION_ERROR` | `Request body is too large` | Content-Length или фактический UTF-8 body больше лимита |
| 400 | `VALIDATION_ERROR` | `Request body must be valid JSON` | invalid JSON, invalid UTF-8, empty body |
| 400 | `VALIDATION_ERROR` | `Request body must be a JSON object` | parsed value null, array или primitive |

Лимит по умолчанию 65536 байт; для WebAuthn verify — 131072 байт. Неизвестные поля общий parser сам не запрещает.

## Стабильные коды BFF

| Code | Typical HTTP status | Production message / meaning |
|---|---:|---|
| `UNAUTHORIZED` | 401 | Войдите в аккаунт, чтобы продолжить. |
| `AUTH_FAILED` | 401 | Не удалось войти. Проверьте данные. |
| `CURRENT_PASSWORD_INVALID` | 401 | Текущий пароль неверный. |
| `FORBIDDEN` | 403 | Действие недоступно. |
| `NOT_FOUND` | 404 | Данные не найдены. |
| `VALIDATION_ERROR` | 400 или 413 | Проверьте введённые данные. |
| `EMAIL_REQUIRED` | 409/403 по caller | Привяжите e-mail к Telegram-аккаунту, чтобы продолжить. |
| `EMAIL_NOT_VERIFIED` | 403 или upstream-normalized 409 | Подтвердите e-mail, чтобы продолжить. |
| `EMAIL_LINK_REQUIRES_VERIFICATION` | 409 | Новый e-mail должен быть подтверждён перед связыванием. |
| `EMAIL_CODE_INVALID` | 400 | Код не подошёл. |
| `EMAIL_CODE_EXPIRED` | 400 | Код истёк. |
| `RATE_LIMITED` | 429 | Слишком много попыток. |
| `CONFLICT` | 409 | Операция конфликтует с текущими данными. |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Idempotency key обязателен для безопасной оплаты. |
| `IDEMPOTENCY_KEY_INVALID` | 400 | Невалидный UUID key. |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Key привязан к другому normalized request/snapshot. |
| `PAYMENT_OPERATION_IN_PROGRESS` | 409 upstream; BFF чаще преобразует в 202 | Платёж создаётся. |
| `PAYMENT_OUTCOME_UNKNOWN` | 409 upstream; BFF чаще преобразует в 202 | Результат уточняется. |
| `OFFER_CHANGED` | 409 | Confirmed snapshot не совпал с текущим offer. |
| `ACCOUNT_MERGE_REQUIRED` | 409 | Требуется отдельное объединение аккаунтов. |
| `ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT` | 409 | У обеих учётных записей есть подписки. |
| `ACCOUNT_MERGE_IN_PROGRESS` | 409 | Payment/merge fence блокирует merge. |
| `PLAN_UNAVAILABLE` | 400 local или 409 normalized upstream | План/duration недоступен. |
| `PAYMENT_GATEWAY_UNAVAILABLE` | 400 local или 409 normalized upstream | Gateway недоступен. |
| `PROMOCODE_ACTIVE_SUBSCRIPTION_REQUIRED` | 409 | Требуется активная подписка. |
| `PROMOCODE_ALREADY_ACTIVATED` | 409 | Уже активирован. |
| `PROMOCODE_EXPIRED` | 409 | Истёк. |
| `PROMOCODE_NOT_AVAILABLE` | 409 | Недоступен аккаунту/исчерпан лимит. |
| `PROMOCODE_NOT_FOUND` | 404 | Не найден/отключён. |
| `PROMOCODE_RESOURCE_UNLIMITED` | 409 | Соответствующий ресурс уже безлимитный. |
| `SUBSCRIPTION_NOT_FOUND` | 404 | Активная подписка не найдена. |
| `SUBSCRIPTION_URL_UNAVAILABLE` | 409 | Remnawave не дал однозначный live URL. |
| `DEVICE_DELETE_UNAVAILABLE` | upstream 4xx либо 409 для upstream 5xx | Device mutation не выполнена. |
| `UPSTREAM_UNAVAILABLE` | 502 или Turnstile/Redis 503 | Dependency/network/timeout unavailable. |
| `UPSTREAM_ERROR` | 502 | Invalid/unmapped upstream response. |
| `INTERNAL_ERROR` | 500 | Необработанная внутренняя ошибка/configuration omission. |

## Приоритет нормализации ошибок Remnashop

1. 401 login → `AUTH_FAILED`; 401 change-password → `CURRENT_PASSWORD_INVALID`; другой 401 → `UNAUTHORIZED`.
2. 403 → `FORBIDDEN`.
3. 404 current subscription → `SUBSCRIPTION_NOT_FOUND`; promo 404 → `PROMOCODE_NOT_FOUND`; другой 404 → `NOT_FOUND`.
4. Promo message patterns map to the six promo codes.
5. Payment 409 message patterns map to in-progress/outcome-unknown/key-reused.
6. Verification, plan/gateway and device patterns apply next.
7. generic 409 → `CONFLICT`; 400/422 → `VALIDATION_ERROR`; 429 → `RATE_LIMITED`; 5xx → `UPSTREAM_UNAVAILABLE` with BFF status 502; remaining → `UPSTREAM_ERROR` 502.

Invalid upstream JSON on success or failure maps to `UPSTREAM_ERROR` 502; fetch exception/timeout maps to `UPSTREAM_UNAVAILABLE` 502.

## Исключительные контракты вне BFF

- `POST /auth/telegram/callback`: flat `{error:"telegram_failed"}` 400 or `{error:"payload_too_large"}` 413.
- `GET /auth/telegram/callback`: failures are 307 redirects, not JSON.
- `GET /api/internal/health/readiness`: invalid secret returns literal NOT_FOUND envelope; unexpected execution error returns degraded body 503.
- `GET /sw.js`: missing build ID returns plain text 503.
- UI/network-ошибки отображаются по правилам карточек экранов и frontend-раздела; текст внутреннего исключения не показывается пользователю.
