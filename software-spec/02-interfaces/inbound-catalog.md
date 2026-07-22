# Каталог входных интерфейсов

## Входы HTTP и браузера

В системе существуют 44 HTTP-операции и 19 навигационных страниц. Точный транспортный реестр: [`http-api.md`](http-api.md).

### Заголовки

`Content-Type`, `Content-Length`, `Origin`, `Referer`, `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Port`, `X-Real-IP`, `X-Forwarded-For`, `User-Agent`, `Idempotency-Key`, `X-Clean-Pay-Readiness-Secret`, `X-Clean-Pay-Reconciliation-Secret`.

### Cookie

`clean_pay_access`, `clean_pay_refresh`, `clean_pay_tg_state`, `clean_pay_tg_nonce`, `clean_pay_tg_code_verifier` и cookie подтверждения объединения Telegram. Точные параметры, TTL и условия установки/удаления заданы детальными карточками.

### Параметры запроса и пути

`redirect_to`, `turnstile_token`, `cf-turnstile-response`, `mode`, `code`, `state`, `error`, `error_description`, `payment_id`, `operation_id`; параметры пути `id` и `hwid`; параметры выбора предложения/возврата платежа перечислены в карточках.

### Входные JSON

| ID | Операция | Поля |
|---|---|---|
| IN-JSON-001 | identify | `email`, Turnstile aliases |
| IN-JSON-002 | login/link | `email`, `password`, Turnstile aliases для login |
| IN-JSON-003 | register | `email`, `password`, optional `name`, `referral_code`, Turnstile aliases |
| IN-JSON-004 | e-mail verification | optional `email`, `code`, optional `registrationFlow`, Turnstile aliases |
| IN-JSON-005 | profile mutation | new `email`; `current_password`, `new_password` |
| IN-JSON-006 | passkey verify | WebAuthn registration/authentication response, optional credential `name` |
| IN-JSON-007 | Telegram WebApp/popup | `initData`, optional `redirectTo`; callback `idToken` |
| IN-JSON-008 | purchase | `plan_code`, `duration_days`, `gateway_type`, `confirmed_amount`, `confirmed_currency`, `offer_version` |
| IN-JSON-009 | extend | `duration_days`, `gateway_type`, `confirmed_amount`, `confirmed_currency`, `offer_version` |
| IN-JSON-010 | promo | `code` |

## Действия пользователя

Пользовательские входы включают навигацию, отправку формы, нажатие, выбор plan/duration/gateway, браузерную WebAuthn-церемонию, запрос установки PWA, обновление возврата платежа и состояние браузерного хранилища. Каждая форма трассируется в `05-frontend/` и матрице frontend.

## Ответы внешних систем как входы

- HTTP-ответы/ошибки/cookies Remnashop public/admin.
- Ответы пользователя/metadata Remnawave.
- Callback авторизации Telegram, token response, JWKS и JWT claims.
- Подписанные init data Telegram WebApp.
- Ответ проверки Turnstile.
- Строки и конкурентное состояние PostgreSQL.
- Ответы/ошибки протокола Redis.
- Readiness и письма Mailpit в тестах.

## Входы конфигурации, времени и состояния

Переменные окружения перечислены в [`configuration.md`](configuration.md). Неявные входы: текущее время, версии строк, состояние аренды/истечения, конкурентные запросы, число повторов, кэш и клиентское браузерное хранилище.

## Не обнаружено

Входящих webhooks, загрузки файлов, multipart-форм и потребителей брокера сообщений нет. Добавление любого из них требует отдельного решения, а не считается переносом текущего поведения.
