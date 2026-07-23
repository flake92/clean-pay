# Неизменяемые контракты

Без отдельного согласованного решения запрещено менять:

1. Канонические resourceful Rails routes из `02-interfaces/http-api.md`; технический
   `/api/bff` и legacy aliases не восстанавливаются.
2. Поля внешних интеграций и пользовательских forms, их тип, обязательность,
   нормализация и server-rendered результат.
3. HTTP status, `content-type`, cache headers, idempotency/retry headers, cookie names/атрибуты/rotation и redirect locations.
4. Source/CSRF/media-type/rate/auth/assurance/email-verification guards и порядок, влияющий на публичный результат.
5. Одноразовость challenge/state/code/confirmation, refresh-family reuse и конкурентные гарантии.
6. Payment idempotency, server-generated return URL, pre-dispatch state, `OUTCOME_UNKNOWN` и `MANUAL_REQUIRED`.
7. Правила владельца при merge и сопоставлении Remnawave, включая запрет неоднозначного автоматического решения.
8. 30 Remnashop операций, Telegram OIDC/WebApp/Bot границы, Turnstile, SMTP, Mailpit, Remnawave, provider webhook и Redis command semantics.
9. 19 server-rendered маршрутов, русские строки, shell, дизайн-токены,
   responsive layout, loading/empty/error/success/confirmation и keyboard/focus
   поведение.
10. Итоговую физическую схему, уникальности, внешние ключи, индексы, retention-исключения и транзакционные fence.
11. Публичное сокрытие внутренних причин readiness/error и запрет логирования паролей, токенов, кодов и секретов.
12. Состав mock/spec-инфраструктуры и закреплённые решения из `10-decisions/accepted/`.

Входная архитектура зафиксирована как Rails monolith + Action View/Turbo/Stimulus.
Её нельзя снова заменить внутренним JSON API без нового явного решения.
