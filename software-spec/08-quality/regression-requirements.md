# Требования к регрессии

До готовности необходимо сохранить и проверить:

- 44 HTTP-операции Clean Pay с точным регистром method/path, query, headers, cookies, content types, bodies, статусами, redirect и побочными эффектами;
- 30 отдельных HTTP-операций Remnashop без объединения GET/POST recovery;
- Telegram OIDC, WebApp SDK, Remnawave, Turnstile, SMTP/Mailpit, платёжные и support-границы;
- все контейнеры integration/mock-среды и их порты/маршруты;
- 19 frontend-маршрутов, подписи, формы, действия и все состояния;
- физическую схему из 15 моделей, 9 перечислений и 15 миграций;
- background worker, readiness, retention, proxy, security и PWA privacy behavior.

Высокорисковые обязательные наборы: refresh race/reuse; одноразовость/счётчик/удаление passkey; Telegram state/merge/recovery; e-mail partial success; payment idempotency/owner/reconciliation/history/return URL; proxy CSRF/access; logger redaction; production env/network/migrations/retention; service worker privacy.

Статус этого документа — требование к будущей проверке, а не подтверждение, что регрессия уже пройдена.
