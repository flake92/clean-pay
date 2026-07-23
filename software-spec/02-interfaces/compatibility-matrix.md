# Матрица совместимости интерфейсов

| Поверхность | Неизменяемый текущий контракт | Известное расхождение декларации и факта | Требование к новой реализации |
|---|---|---|---|
| Rails-маршруты | 42 канонические resourceful операции | исторический срез содержал 44 BFF/API операции | использовать только ADR-003 baseline |
| Исторический API | `/api/me`, `/api/logout`, `/api/bff` | дублировал новый Rails transport | не восстанавливать aliases |
| Пользовательский ответ | HTML render/redirect, flash и Turbo | исторический BFF возвращал JSON envelope | Rails сам рендерит интерфейс |
| JSON-тело | WebAuthn до 128 КиБ и machine endpoints | обычные операции ранее были JSON | обычные входы переведены в Rails forms |
| Покупка/продление | белый список полей и UUID-заголовок идемпотентности | декларация допускает клиентский `return_url`, runtime его отбрасывает | URL возврата формирует только сервер |
| Сеансы | cookies access/refresh Clean Pay и зашифрованные внешние токены в БД | edge доказывает access; refresh остаётся непрозрачным кандидатом | сохранить refresh fallback и точную cookie-семантику |
| Telegram | GET code callback и POST popup/widget callback | старая карта endpoint показывает только GET | сохранить обе операции и разные семейства ответов |
| Восстановление платежа | capability v1 и ограниченный fallback старой истории | версия внешнего Remnashop хранится в инфраструктуре, не в приложении | реализовать обе наблюдаемые ветви согласования |
| UI | русские подписи/тексты, routes и состояния | исторический frontend был отдельным от BFF | Action View, I18n, Turbo и малые Stimulus controllers |
| PWA | manifest, service worker, offline и установка | build ID обязателен для `/service-worker.js` | сохранить versioning кэша и отказ при отсутствии ID |
| Конфигурация | строгий production parser/validator | root/dev/prod defaults намеренно различаются | сохранить контекстные правила проверки |
