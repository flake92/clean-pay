# Ошибки и служебные заголовки Remnashop

## Внешние auth-cookie

Зафиксированный Remnashop устанавливает обе cookie со следующими свойствами:

| Cookie | Значение | HttpOnly | Secure | SameSite | Max-Age |
|---|---|---:|---:|---|---:|
| `access_token` | HS256 JWT с `sub`, `ver`, `iat`, `exp` | да | да | `lax` | 900 секунд |
| `refresh_token` | непрозрачная случайная строка | да | да | `lax` | 2 592 000 секунд |

Clean Pay извлекает только значения из `Set-Cookie`, шифрует их в своей сессии и не пробрасывает upstream cookie браузеру. Ответ auth/refresh/change-password без любой из двух cookie становится `502 UPSTREAM_ERROR`. `sub` access-token обязан существовать и используется как Remnashop user ID.

## Формат upstream-ошибки

Предпочтительный ответ:

```json
{"detail":"message"}
```

Clean Pay также принимает `detail` как массив строк/объектов с `msg`, либо object с string-полем `message`, `error` или `detail`. При неизвестной форме используется `Request failed`. Debug detail не должен раскрываться production-пользователю.

## Точное отображение статусов и условий

Правила применяются сверху вниз.

| Условие upstream | Ошибка Clean Pay | HTTP Clean Pay |
|---|---|---:|
| `401` на `/auth/login` | `AUTH_FAILED` | 401 |
| `401` на `/auth/change-password` | `CURRENT_PASSWORD_INVALID` | 401 |
| любой другой `401` | `UNAUTHORIZED` | 401 |
| любой `403` | `FORBIDDEN` | 403 |
| `404` на `/subscription/current` | `SUBSCRIPTION_NOT_FOUND` | 404 |
| `404` на `/subscription/promocode` | `PROMOCODE_NOT_FOUND` | 404 |
| promocode detail содержит `already activated`/`already used` | `PROMOCODE_ALREADY_ACTIVATED` | 409 |
| promocode detail содержит `expired` | `PROMOCODE_EXPIRED` | 409 |
| detail содержит `active subscription required` | `PROMOCODE_ACTIVE_SUBSCRIPTION_REQUIRED` | 409 |
| detail содержит `resource is already unlimited`/`already unlimited` | `PROMOCODE_RESOURCE_UNLIMITED` | 409 |
| detail содержит activation limit/new-existing-invited-only/not available | `PROMOCODE_NOT_AVAILABLE` | 409 |
| иной `404` | `NOT_FOUND` | 404 |
| `409` + detail `email must be verified`/`email not verified` | `EMAIL_NOT_VERIFIED` | 409 |
| purchase/extend `409` + `Idempotency-Key is already in progress` | `PAYMENT_OPERATION_IN_PROGRESS` | 409 |
| purchase/extend `409` + `payment outcome is unknown` | `PAYMENT_OUTCOME_UNKNOWN` | 409 |
| purchase/extend `409` + unsafe stored replay | `PAYMENT_OUTCOME_UNKNOWN` | 409 |
| purchase/extend `409` + key reused with different request | `IDEMPOTENCY_KEY_REUSED` | 409 |
| detail содержит expired verification-code pattern | `EMAIL_CODE_EXPIRED` | 400 |
| detail содержит invalid/wrong/incorrect/verification code pattern | `EMAIL_CODE_INVALID` | 400 |
| detail содержит plan unavailable pattern | `PLAN_UNAVAILABLE` | 409 |
| detail содержит gateway unavailable/payment gateway pattern | `PAYMENT_GATEWAY_UNAVAILABLE` | 409 |
| любая ошибка `/subscription/devices` | `DEVICE_DELETE_UNAVAILABLE` | исходный статус, но upstream `5xx` преобразуется в 409 |
| иной `409` | `CONFLICT` | 409 |
| `400` или `422` | `VALIDATION_ERROR` | 400 |
| `429` | `RATE_LIMITED` | 429 |
| `5xx` | `UPSTREAM_UNAVAILABLE` | 502 |
| иной non-2xx | `UPSTREAM_ERROR` | 502 |

Сопоставление строк выполняется без учёта регистра по английскому upstream detail. Изменение текстов Remnashop может изменить специализацию ошибки, поэтому стабильными внешними гарантиями являются Clean Pay code/status и описанные fallback rules.

## Ошибки транспорта и разбора

| Сбой | Результат |
|---|---|
| DNS/connect/reset/abort/timeout общего клиента | `502 UPSTREAM_UNAVAILABLE` |
| успешный HTTP с невалидным JSON | `502 UPSTREAM_ERROR` |
| ошибочный HTTP с невалидным JSON/text | text передаётся в normalizer |
| `404` при операции с `allowNotFound` | тело закрывается, возвращается `null`; нормализация не выполняется |
| невалидный строго проверяемый recovery/payment success body | `502 UPSTREAM_ERROR` |

## Заголовки повтора и идемпотентности

Общий Remnashop client не читает произвольный `Retry-After`. Delay recovery берётся из проверенного JSON `retry_after_seconds`. `Idempotency-Key` upstream обязан соответствовать pattern `[A-Za-z0-9][A-Za-z0-9._:~-]{15,127}`; Clean Pay формирует стабильное подходящее значение.

`Idempotency-Replayed` является заголовком ответа Clean Pay браузеру, а не заголовком ответа Remnashop, на который полагается клиент.
