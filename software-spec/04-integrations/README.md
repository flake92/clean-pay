# Внешние интеграции

## Правило описания

Внешний сервис считается отдельной границей даже тогда, когда Clean Pay достигает его косвенно через Remnashop или браузер. Для каждой границы фиксируются направление, транспорт, авторизация, операции, поля, ответы, ошибки, таймауты, повторы, идемпотентность, деградация и тестовая замена.

## Реестр границ

| Граница | Прямая связь Clean Pay | Нормативный документ |
|---|---:|---|
| Remnashop public/admin API | да | `remnashop.md`, `remnashop-operations.md`, `remnashop-errors.md` |
| Remnawave API | да | `remnawave.md` |
| Telegram OIDC | да | `telegram.md` |
| Telegram Bot API | нет, через Remnashop | `telegram.md` |
| Cloudflare Turnstile | да | `turnstile.md` |
| SMTP и почтовая доставка | нет, через Remnashop | `mailpit-smtp.md` |
| Mailpit HTTP API | да, только проверка готовности в тестовой среде | `mailpit-smtp.md` |
| Платёжные провайдеры | нет, через Remnashop и браузер | `payment-providers.md` |
| PostgreSQL и Redis | да | `storage.md` |
| Браузер, WebAuthn и PWA | да | `browser-pwa.md` |
| Reverse proxy / HTTPS | да, входящая | `reverse-proxy.md` |
| Контакты поддержки | браузерная исходящая | `support-channels.md` |
| Тестовые замены и сохраняемые контейнеры | интеграционный стенд | `mock-services.md` |

Автоматический повтор отсутствует у общего HTTP-клиента. Повторы разрешены только явно описанными сценариями: отправка письма, обновление upstream-токенов и долговечная сверка платежа.
