# Каталог выходных интерфейсов

## Выходы к браузеру

| ID | Тип | Наблюдаемый контракт |
|---|---|---|
| OUT-BROWSER-001 | JSON success | auth/profile, offers, subscription, devices, payments, support, health |
| OUT-BROWSER-002 | JSON error | стабильный `error.code`, публичное русское сообщение, условные metadata |
| OUT-BROWSER-003 | redirect | login, verification, passkey setup, Telegram, payment provider и возврат |
| OUT-BROWSER-004 | cookies | создание/обновление/отзыв сессии, OIDC state, доказательство merge |
| OUT-BROWSER-005 | payment idempotency | replay header, pending/retry/manual representations |
| OUT-BROWSER-006 | HTML/UI | 19 маршрутов экранов и все loading/error/success/empty/blocked состояния |
| OUT-BROWSER-007 | PWA | manifest, service worker, разрешённый offline/cache contract |
| OUT-BROWSER-008 | browser APIs | WebAuthn, clipboard, install prompt, local/session storage |
| OUT-BROWSER-009 | статический ресурс бренда | запрос браузера к безопасному корневому пути того же origin из `NEXT_PUBLIC_BRAND_LOGO_URL`; внешний URL запрещён |

## Clean Pay → Remnashop

30 операций `RS-001`…`RS-030` перечислены без объединения разных методов в `04-integrations/remnashop-operations.md`:

- 11 auth/profile/e-mail операций;
- public plans;
- current subscription и offers;
- purchase/extend/reissue/promocode;
- три операции устройств;
- capabilities, paged/exact/legacy transaction history;
- отдельные GET и POST пользовательского recovery;
- admin merge;
- отдельные GET и POST admin recovery.

Каждая операция сохраняет точный method/path, auth-cookie либо API key, JSON-поля, статусы, таймаут и условия retry/idempotency.

## Clean Pay → другие внешние HTTP-сервисы

| ID | Получатель | Метод/адрес | Назначение |
|---|---|---|---|
| TG-001 | Telegram OIDC authorization | browser `GET` configured authorization endpoint с OAuth/OIDC query | начать PKCE-вход |
| TG-002 | Telegram OIDC token | backend `POST` configured token endpoint | обмен code на ID token |
| TG-003 | Telegram OIDC JWKS | backend `GET` configured JWKS URI | проверка JWT/readiness |
| TG-006 | Telegram WebApp SDK | browser `GET https://telegram.org/js/telegram-web-app.js` | получить WebApp API и `initData` |
| RW-001 | Remnawave | `GET /api/users/{uuid}` | основной поиск живой подписки |
| RW-002 | Remnawave | `GET /api/users/by-email/{email}` | fallback по e-mail |
| RW-003 | Remnawave | `GET /api/users/by-telegram-id/{id}` | fallback по Telegram ID |
| RW-004 | Remnawave | `GET /api/system/metadata` | optional readiness |
| TS-001 | Turnstile | `POST` configured siteverify | проверка антибот-токена |
| TS-000 | Turnstile widget | browser `GET https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` | загрузить browser API виджета |
| MP-001 | Mailpit | `GET /api/v1/messages` | optional readiness тестовой почты |
| SELF-001 | Clean Pay internal | `POST /internal/payment_reconciliations` | пакетная сверка worker |

## Косвенные внешние выходы

| ID | Цепочка | Контракт |
|---|---|---|
| SMTP-001 | Clean Pay → Remnashop → SMTP | plain-text письмо с шестизначным verification code; SMTP SSL/STARTTLS/login semantics |
| MAIL-USER-001 | SMTP → почтовый ящик пользователя | доставка письма подтверждения |
| BOT-001 | Remnashop → Telegram Bot API | бот/WebApp; dev-mock поддерживает Bot API-shaped calls |
| PAY-001 | Remnashop → активный payment gateway | создание invoice/payment, получение payment URL |
| PAY-002 | Clean Pay → браузер → payment provider | HTTP(S) переход пользователя по `payment_url` |
| PAY-003 | payment provider → Remnashop | provider webhook `/api/v1/payments/{gateway}` |
| REMNA-IND-001 | Remnashop → Remnawave | управление авторитетной подпиской и устройствами |
| SUP-001…003 | браузер → e-mail client / Telegram / FAQ | внешние контакты поддержки |

## Хранилища и эксплуатационные выходы

- PostgreSQL: изменения всех физических моделей, транзакции и cleanup.
- Redis: RESP-команды, счётчики/TTL и кэш readiness.
- Audit/log output: audit records и структурированный stdout/stderr.
- Worker heartbeat: timestamp files в `/tmp`.
- Reverse proxy response: security headers, body, redirects и health semantics.
- Нет исходящей публикации webhook или message broker непосредственно из Clean Pay.

## Тестовая наблюдаемость почты

| ID | Отправитель → получатель | Контракт |
|---|---|---|
| MP-002 | Mailpit → `smtp-log` | POST JSON summary/array webhook |
| MP-003 | `smtp-log` → Mailpit | `GET /api/v1/message/{id}` для полного письма |

Это интерфейсы тестовой инфраструктуры и не входят в production runtime Clean Pay.
