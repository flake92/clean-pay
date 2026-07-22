# Требования безопасности

## Входящие запросы

- Все browser-мутации проверяют доверенный Origin/Host и ожидаемый JSON media type; исключения перечислены в карточке операции.
- Внутренние операции используют независимые высокоэнтропийные секреты и недоступны через публичный reverse proxy.
- Размер JSON по умолчанию не более 65536 байт; WebAuthn verify — 131072 байт.
- Безопасный redirect проверяется сервером; клиентский `return_url` не выбирает платёжную или внешнюю цель.

## Сеанс и идентичность

- Cookies: `HttpOnly`, production `Secure`, явный `SameSite`, путь `/`, фиксированные сроки; access подписан и короток, refresh непрозрачен и ротируется.
- Повтор refresh после grace отзывает сеанс.
- WebAuthn проверяет challenge, тип церемонии, RP ID, origin, user verification, подпись и монотонный counter.
- Telegram OIDC проверяет state, nonce, PKCE, JWT signature/issuer/audience/age; WebApp init data — HMAC и возраст.
- Последний passkey не удаляется; bootstrap-сеанс не получает полный доступ до завершения настройки/разрешённого пропуска.

## Внешние эффекты и данные

- Turnstile и rate limits применяются на указанных auth/payment операциях.
- Внешние токены шифруются; refresh/idempotency/state/challenge доказательства хэшируются; владелец и IP используют отдельные keyed hashes.
- Row locks, claims, leases и owner fences запрещают takeover и двойной платёж.
- После возможной отправки платежа неизвестность сохраняется, а повторная покупка не выполняется.

## Выход и наблюдаемость

- Structured logs рекурсивно редактируют секреты и не содержат query string.
- Публичная готовность скрывает внутренние сообщения/адреса.
- Service worker никогда не кэширует API, HTML защищённых страниц, ответы с `Set-Cookie`, `Cache-Control: private/no-store` или запросы с credentials.
- Security headers/CSP reverse proxy и приложения не должны противоречить WebAuthn, Telegram SDK и обязательным внешним origin; расширение allowlist требует решения и теста.
