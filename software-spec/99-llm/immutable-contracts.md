# Неизменяемые контракты

Без отдельного согласованного решения запрещено менять:

1. Любую из 44 пар method/path, включая legacy `/api/me`, `/api/logout`, callback GET/POST и service worker.
2. Поля запросов/ответов, их регистр, тип, обязательность, `null`, default, дополнительные поля и формат envelope.
3. HTTP status, `content-type`, cache headers, idempotency/retry headers, cookie names/атрибуты/rotation и redirect locations.
4. Source/CSRF/media-type/rate/auth/assurance/email-verification guards и порядок, влияющий на публичный результат.
5. Одноразовость challenge/state/code/confirmation, refresh-family reuse и конкурентные гарантии.
6. Payment idempotency, server-generated return URL, pre-dispatch state, `OUTCOME_UNKNOWN` и `MANUAL_REQUIRED`.
7. Правила владельца при merge и сопоставлении Remnawave, включая запрет неоднозначного автоматического решения.
8. 30 Remnashop операций, Telegram OIDC/WebApp/Bot границы, Turnstile, SMTP, Mailpit, Remnawave, provider webhook и Redis command semantics.
9. 19 маршрутов, русские строки, shell, дизайн-токены, responsive layout, loading/empty/error/success/confirmation и keyboard/focus поведение.
10. Итоговую физическую схему, уникальности, внешние ключи, индексы, retention-исключения и транзакционные fence.
11. Публичное сокрытие внутренних причин readiness/error и запрет логирования паролей, токенов, кодов и секретов.
12. Состав mock/spec-инфраструктуры и закреплённые решения из `10-decisions/accepted/`.

Допустимо менять внутренние Ruby-классы, каталоги, ORM, web-фреймворк, способ серверного рендера и организацию процессов, если перечисленное поведение остаётся доказанно тем же.
