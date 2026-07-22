# Промпт независимой проверки реализации

Проверь новую реализацию Clean Pay как несовместимый по умолчанию чёрный ящик. Не используй её внутренние классы как доказательство. Источник ожидаемого поведения — весь каталог `software-spec/`.

1. Построй перечень 44 HTTP-операций и для каждой проверь method/path, query/path/body, отсутствие/`null`/пустые/лишние/неверные/граничные значения, content type, source/CSRF, auth, rate limit, все статусы, headers, cookie, redirects и side effects.
2. Для каждого исходящего интерфейса проверь точный запрос, auth, parsing, timeout, retry, idempotency, partial success, degradation и mock parity. Отдельно проверь SMTP и доставку письма, Telegram Bot API и provider webhook как косвенные границы.
3. Выполни конкурентные сценарии одноразовых состояний, WebAuthn counter/delete, refresh-family, account merge, payment dispatch/history/reconciliation и worker lease.
4. Сверь итоговую PostgreSQL-схему с каждым полем, constraint и index; проверь retention, шифрование/хэширование и отсутствие секретов в логах.
5. Пройди все 19 страниц в desktop 1440×1000 и mobile 390×844, сделай снимки и perceptual/pixel сравнение с `05-frontend/reference/current/`. Проверь интеракции, клавиатуру, focus, loading/empty/error/success и отсутствие горизонтального overflow.
6. Запусти полную test/spec-топологию, E2E e-mail/Telegram/подписка/платёж без реальной оплаты, dependency failure, restart, backup/restore и reconciliation recovery.
7. Составь таблицу: всего, прошло, отклонение, доказательство. Любое необъяснённое отклонение, пропущенная ветка или зависимость от старого исходника означает `НЕ ГОТОВО`.

Не исправляй спецификацию под получившуюся реализацию. Если реализация расходится с контрактом, исправляй реализацию либо оформляй отдельное пользовательское решение об изменении продукта.
