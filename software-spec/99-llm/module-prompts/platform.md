# Промпт модуля платформы

Реализуй эксплуатационную оболочку Ruby-монолита по `01-modules/platform/`, HTTP-033—HTTP-037, HTTP-040, HTTP-044 и разделам операций/качества. Обязательны строгий startup, безопасные liveness/readiness, structured logs/audit, retention, reconciliation worker, PWA/offline, support и graceful shutdown. Фоновые команды могут быть отдельными процессами того же релиза, но не отдельными продуктами. Проверь stale cache, dependency failure, неверный secret, просроченную аренду и восстановление после рестарта.
