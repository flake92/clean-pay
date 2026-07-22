# Точные исходящие операции Clean Pay → Remnashop

## Общие обозначения

- `PUBLIC` — базовый адрес Remnashop `/api/v1/public`.
- `ADMIN` — базовый адрес Remnashop `/api/v1/admin`.
- `UA` — `Cookie: access_token=<token>`.
- `UR` — `Cookie: refresh_token=<token>`.
- `AK` — `x-api-key: <REMNASHOP_API_KEY>`.
- `IK` — `Idempotency-Key: <стабильный ключ операции>`.
- Если тело присутствует, оно кодируется UTF-8 JSON.
- Если поле не указано в таблице тела, операция Clean Pay его намеренно не формирует.

## Полный перечень операций

| ID | Метод и адрес | Авторизация | Запрос | Успешный результат | Условие вызова |
|---|---|---|---|---|---|
| RS-001 | `POST PUBLIC/auth/register` | нет | `RegisterRequest` | `201`, `AuthResponse` + две auth-cookie | регистрация e-mail |
| RS-002 | `POST PUBLIC/auth/login` | нет | `LoginRequest` | `200`, `AuthResponse` + две auth-cookie | вход; также восстановление регистрации существующего e-mail |
| RS-003 | `POST PUBLIC/auth/telegram` | нет | `TelegramAuthRequest` | `200`, `AuthResponse` + две auth-cookie | вход/восстановление через проверенную Telegram-идентичность |
| RS-004 | `POST PUBLIC/auth/telegram/webapp` | нет | `TelegramWebAppAuthRequest` | `200`, `AuthResponse` + две auth-cookie | вход из Telegram WebApp |
| RS-005 | `POST PUBLIC/auth/refresh` | `UR` | тело отсутствует | `200`, `AuthResponse` + две новые auth-cookie | обновление upstream-токенов |
| RS-006 | `POST PUBLIC/auth/change-password` | `UA` | `ChangePasswordRequest` | `200`, `{success}` + две новые auth-cookie | смена пароля |
| RS-007 | `GET PUBLIC/auth/me` | `UA` | нет | `200`, `MeResponse` | профиль, проверка токена и владельца |
| RS-008 | `POST PUBLIC/auth/telegram/link` | `UA` | `TelegramAuthRequest` | `200`, `MeResponse` | привязка Telegram к e-mail-владельцу |
| RS-009 | `POST PUBLIC/auth/email/request-verification` | `UA` | `RequestEmailVerificationRequest` | `200`, `RequestEmailVerificationResponse` | отправить код подтверждения |
| RS-010 | `POST PUBLIC/auth/email/confirm` | `UA` | `{email?, code}`; upstream получает только поддерживаемые им поля | `200`, `{success,email}` | подтвердить одноразовый код |
| RS-011 | `POST PUBLIC/auth/email/change` | `UA` | `{email}` | `200`, `{success,pending_email}` | начать смену e-mail |
| RS-012 | `GET PUBLIC/plans/public` | нет | нет | `200`, `PublicPlanLandingListResponse` | публичные тарифы и readiness |
| RS-013 | `GET PUBLIC/subscription/current` | `UA` | нет | `200`, `SubscriptionInfoResponse` или JSON `null` | текущая подписка |
| RS-014 | `GET PUBLIC/subscription/offers` | `UA` | нет | `200`, `SubscriptionOffersResponse` | предложения и повторная проверка цены |
| RS-015 | `POST PUBLIC/subscription/purchase` | `UA`, `IK` | `PurchaseDispatchRequest` | `200`, `PaymentInitResponse` | создать покупку/смену тарифа |
| RS-016 | `POST PUBLIC/subscription/extend` | `UA`, `IK` | `ExtendDispatchRequest` | `200`, `PaymentInitResponse` | создать продление |
| RS-017 | `POST PUBLIC/subscription/reissue` | `UA` | тело отсутствует | `200`, `{success}` | перевыпустить ссылку подписки |
| RS-018 | `POST PUBLIC/subscription/promocode` | `UA` | `{code}` | `200`, `{success,reward_type}` | активировать промокод |
| RS-019 | `GET PUBLIC/subscription/devices` | `UA` | нет | `200`, `DevicesResponse` | получить устройства |
| RS-020 | `DELETE PUBLIC/subscription/devices` | `UA` | нет | `200`, `{success}` | удалить все устройства |
| RS-021 | `DELETE PUBLIC/subscription/devices/{hwid}` | `UA` | `hwid` кодируется как один path-сегмент | `200`, `{deleted}` | удалить одно устройство |
| RS-022 | `GET PUBLIC/subscription/capabilities` | `UA` | нет | `200`, `CapabilitiesResponse`; `404` допустим как отсутствие capability | согласовать recovery-контракт |
| RS-023 | `GET PUBLIC/subscription/transactions/page?limit={n}&cursor={cursor?}` | `UA` | `limit` 1…100; `cursor` опционален | `200`, `TransactionPageResponse` | постраничная история |
| RS-024 | `GET PUBLIC/subscription/transactions/by-id/{payment_id}` | `UA` | UUID в path | `200`, `PaymentTransactionResponse`; `404` допустим как отсутствие | точный поиск платежа |
| RS-025 | `GET PUBLIC/subscription/transactions` | `UA` | нет | `200`, массив `PaymentTransactionResponse` | legacy fallback истории |
| RS-026 | `GET PUBLIC/subscription/payment-operations/{operation}` | `UA`, `IK` | `operation`: `PURCHASE` или `EXTEND` | `200`/`202`, `PaymentRecoveryResponse`; `404` допустим | посмотреть recovery без повтора провайдера |
| RS-027 | `POST PUBLIC/subscription/payment-operations/{operation}` | `UA`, `IK` | тело отсутствует | `200`/`202`, `PaymentRecoveryResponse`; `404` допустим | разрешённый trigger recovery |
| RS-028 | `POST ADMIN/users/merge?dry_run={boolean}` | `AK` | `MergeUsersRequest` | `200`, `MergeUsersResponse` | объединить upstream-владельцев |
| RS-029 | `GET ADMIN/payment-operations/{operation}?user_id={id}` | `AK`, `IK` | `operation`: `PURCHASE`/`EXTEND`; `user_id` строковый upstream ID | `200`/`202`, `PaymentRecoveryResponse`; `404` допустим | worker: посмотреть состояние |
| RS-030 | `POST ADMIN/payment-operations/{operation}?user_id={id}` | `AK`, `IK` | тело отсутствует | `200`/`202`, `PaymentRecoveryResponse`; `404` допустим | worker: разрешённый trigger recovery |

## Тела запросов идентичности

### `RegisterRequest`

| Поле | Тип | Обязательно | Nullable | Ограничения и нормализация |
|---|---|---:|---:|---|
| `email` | string | да | нет | пробелы по краям удаляются upstream; lower-case; максимум 255; формат `^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$` |
| `password` | string | да | нет | 8…256 символов |
| `name` | string | нет | нет | после trim 1…128 |
| `referral_code` | string | нет | нет | после trim 3…64; пустое нормализуется в отсутствие |

### `LoginRequest`

| Поле | Тип | Обязательно | Nullable | Ограничения |
|---|---|---:|---:|---|
| `email` | string | да | нет | trim, lower-case, максимум 255, e-mail pattern |
| `password` | string | да | нет | 1…256 символов |

### `TelegramAuthRequest`

| Поле | Тип | Обязательно | Nullable | Формирование |
|---|---|---:|---:|---|
| `id` | integer | да | нет | положительный Telegram ID, приводится к числу |
| `first_name` | string | да | нет | username либо `Telegram`, если имя отсутствует |
| `last_name` | string | нет | нет | из проверенного OIDC payload, если есть |
| `username` | string | нет | нет | из проверенного OIDC payload, если есть |
| `photo_url` | string | нет | нет | допускается Telegram Login payload; серверный OIDC-сценарий Clean Pay обычно не формирует |
| `auth_date` | integer | да | нет | Unix seconds времени формирования payload |
| `hash` | string | да | нет | HMAC-SHA256 Telegram Login: отсортированная строка `key=value`, ключ — SHA-256 от bot token |

### Остальные auth-тела

| Схема | Поля |
|---|---|
| `TelegramWebAppAuthRequest` | `init_data: string`, обязательно |
| `ChangePasswordRequest` | `current_password: string` 1…256; `new_password: string` 8…256 |
| `RequestEmailVerificationRequest` | `email?: string`; при наличии trim/lower-case, максимум 255, e-mail pattern |
| подтверждение e-mail | `code: string`, ровно 6 цифр; Clean Pay может вычислить целевой `email`, но upstream-схема зафиксированной версии принимает только `code`, а лишнее поле игнорирует |
| смена e-mail | `email: string`, trim/lower-case, максимум 255, e-mail pattern |

Неизвестные JSON-поля входного BFF для ряда auth-операций не очищаются Clean Pay, кроме двух имён Turnstile; зафиксированная версия Remnashop игнорирует неизвестные поля. Новая реализация не должна превращать их в бизнес-данные.

## Ответы идентичности

### `AuthResponse`

| Поле | Тип | Обязательно | Nullable | Семантика |
|---|---|---:|---:|---|
| `expires_at` | RFC3339 date-time | да | нет | окончание access-token |
| `refresh_expires_at` | RFC3339 date-time | да | нет | окончание refresh-token |

Дополнительно обязательны две `Set-Cookie`: `access_token` и `refresh_token`.

### `MeResponse`

| Поле | Тип | Обязательно | Nullable |
|---|---|---:|---:|
| `telegram_id` | integer | да | да |
| `auth_type` | string | да | нет |
| `email` | string | да | да |
| `is_email_verified` | boolean | да | нет |
| `pending_email` | string | да | да |
| `name` | string | да | нет |
| `username` | string | да | да |
| `language` | string | да | нет |

### E-mail-ответы

| Операция | Поля ответа |
|---|---|
| запрос кода | `success: boolean`, `target_email: string`, `expires_at: RFC3339 date-time` |
| подтверждение | `success: boolean`, `email: string` |
| смена адреса | `success: boolean`, `pending_email: string` |

## Тарифы и предложения

### `PublicPlanLandingListResponse`

Корень: `{plans: PublicPlanLanding[]}`.

| Поле плана | Тип | Nullable |
|---|---|---:|
| `public_code` | string | нет |
| `name` | string | нет |
| `description` | string | да |
| `traffic_limit` | integer | нет |
| `device_limit` | integer | нет |
| `monthly_from_rub` | decimal string | нет |
| `max_duration_days` | integer | нет |
| `max_duration_price_rub` | decimal string | нет |

### `SubscriptionOffersResponse`

Корень: `gateways[]`, `plans[]`, `has_current_subscription: boolean`, `current_subscription_status: string|null`.

| Объект | Поля |
|---|---|
| gateway | `gateway_type`, `currency`, `currency_symbol` — строки |
| plan | `id: integer`, `public_code`, `name`, `description|null`, `traffic_limit: integer`, `device_limit: integer`, `type`, `recommended_purchase_type`, `durations[]` |
| duration | `days: integer`, `prices[]` |
| price | `gateway_type`, `currency`, `currency_symbol`, `original_amount: decimal string`, `discount_percent: integer`, `final_amount: decimal string`, `is_free: boolean` |

## Подписка и устройства

### `SubscriptionInfoResponse`

| Поле | Тип | Nullable |
|---|---|---:|
| `user_remna_id` | string | нет |
| `status` | string | нет |
| `is_trial` | boolean | нет |
| `traffic_limit` | integer | нет |
| `device_limit` | integer | нет |
| `traffic_limit_strategy` | string | нет |
| `expire_at` | RFC3339 date-time | нет |
| `url` | string | нет |
| `plan_name` | string | нет |
| `plan_duration_days` | integer | нет |
| `used_traffic_bytes` | integer | да |
| `lifetime_used_traffic_bytes` | integer | да |
| `online_at` | RFC3339 date-time | да |

### `DevicesResponse`

Корень: `devices[]`, `current_count: integer`, `max_count: integer`. Устройство содержит обязательный `hwid: string` и nullable-поля `platform`, `device_model`, `os_version`, `user_agent`.

## Платёжные запросы и ответы

### `PurchaseDispatchRequest`

| Поле | Тип | Обязательно | Ограничения |
|---|---|---:|---|
| `plan_code` | string | да | выбранный `public_code`; upstream 3…64 после trim |
| `duration_days` | integer | да | неотрицательный; должен существовать в текущем offer |
| `gateway_type` | enum string | да | должен присутствовать в цене текущего offer |
| `return_url` | absolute HTTP(S) URL | да в Clean Pay | формируется сервером как страница pending с `operation_id`; пользовательское значение не принимается |

### `ExtendDispatchRequest`

`duration_days`, `gateway_type`, `return_url` с теми же правилами; `plan_code` отсутствует.

### `PaymentInitResponse`

| Поле | Тип | Обязательно | Nullable | Дополнительная проверка Clean Pay |
|---|---|---:|---:|---|
| `payment_id` | UUID string | да | нет | UUID |
| `payment_url` | HTTP(S) URL string | да | да | иной protocol запрещён |
| `purchase_type` | enum | да | нет | `NEW`, `RENEW`, `CHANGE` |
| `status` | enum string | да | нет | регистронезависимо: pending/completed/failed/canceled/refunded |
| `is_free` | boolean | да | нет | обязан совпадать с нулевым `final_amount` |
| `final_amount` | decimal string | да | нет | до 10 цифр целой части и до 2 дробной |
| `currency` | string | да | нет | 1…16 печатных символов без control chars |
| `return_url` | HTTP(S) URL string | нет | да | если присутствует, обязан точно совпасть с отправленным серверным URL |

### `PaymentTransactionResponse`

| Поле | Тип | Nullable |
|---|---|---:|
| `payment_id` | UUID string | нет |
| `purchase_type` | `NEW`/`RENEW`/`CHANGE` | нет |
| `status` | pending/completed/failed/canceled/refunded, любой регистр | нет |
| `gateway_type` | `[A-Z][A-Z0-9_-]{0,63}` | нет |
| `final_amount` | decimal string | нет |
| `currency` | печатная string 1…16 | нет |
| `plan_name` | string | да |
| `duration_days` | non-negative integer | да |
| `device_limit` | non-negative integer | да |
| `traffic_limit` | non-negative integer | да |
| `created_at` | валидный RFC3339 date-time | нет |
| `updated_at` | валидный RFC3339 date-time | нет; не раньше `created_at` |

### Capability и recovery

`CapabilitiesResponse` обязан иметь `contract_version: 1`; transaction flags `keyset_pagination: true`, `exact_lookup: true`, `max_page_size` 1…100; reconciliation flags `operation_lookup`, `user_reconcile`, `admin_reconcile` равны `true`; states содержат ровно `SUCCEEDED`, `IN_PROGRESS`, `UNKNOWN`, `MANUAL_REQUIRED`; `auto_replay_gateways` — массив непустых строк до 100 символов.

`TransactionPageResponse`: `{items: PaymentTransactionResponse[], next_cursor: string|null}`; cursor максимум 8192 на стороне Clean Pay, upstream-запрос ограничивает его 2048.

`PaymentRecoveryResponse`:

| Состояние | HTTP | `payment`/`transaction` | `retry_after_seconds` |
|---|---:|---|---|
| `SUCCEEDED` | 200 | оба объекта обязательны и согласованы | `null` |
| `IN_PROGRESS` | 202 | оба `null` | non-negative integer обязателен |
| `UNKNOWN` | 202 | оба `null` | non-negative integer обязателен |
| `MANUAL_REQUIRED` | 202 | оба `null` | `null` |

`operation` в ответе обязан точно совпасть с запрошенным `PURCHASE` либо `EXTEND`. В успешном состоянии payment и transaction должны иметь одинаковый `payment_id` и согласованные status/purchase_type/amount/currency.

## Объединение upstream-владельцев

### `MergeUsersRequest`

| Поле | Тип | Обязательно | Default/ограничение |
|---|---|---:|---|
| `source_user_id` | positive integer | да | безопасное целое |
| `target_user_id` | positive integer | да | безопасное целое; отличается от source |
| `reason` | string | да | 1…1024 после trim |
| `email_resolution` | enum | да | Clean Pay задаёт `REJECT` либо `KEEP_TARGET`; default `REJECT` |
| `telegram_resolution` | enum | да | `REJECT` либо `KEEP_SOURCE`; default `REJECT` |
| `payment_resolution` | enum | да | `REJECT` либо `REKEY_SOURCE`; default `REJECT` |

Query `dry_run` всегда передаётся как точная строка `true` или `false`.

### `MergeUsersResponse`

`dry_run`, `source_user_id`, `target_user_id`, `target`, `moved`, `conflicts`, `requires_relogin`. `target` содержит `id`, nullable `email`, nullable `telegram_id`, `is_email_verified`, nullable `current_subscription_id`; `moved` — отображение string→integer; `conflicts` — массив строк. Для фактического merge Clean Pay дополнительно требует совпадения source/target, `dry_run=false`, пустого `conflicts` и `requires_relogin=true`.

## Ошибочные ответы

Ожидаемый upstream-формат ошибки — JSON `{detail: ...}`; `detail` может быть строкой, массивом сообщений/объектов `msg` либо объектом с `message`, `error` или `detail`. Существенные статусы: `400`/`422` validation, `401` auth, `403` forbidden, `404` resource/capability/operation отсутствует, `409` conflict/idempotency/email/gateway, `429` rate limit, `5xx` недоступность. Для recovery только явно отмеченный `404` превращается в `null`; прочие ошибки нормализуются и завершают соответствующую ветку.

## Уверенность

Контракты подтверждены одновременно клиентом Clean Pay, его runtime-проверками, тестами и схемами зафиксированной совместимой версии Remnashop. Источники перечисляются только в матрице трассируемости, чтобы нормативный контракт не зависел от сохранения исходных файлов.
