# Совместимость

Сохраняются upstream wire-поля, пользовательские данные форм, псевдонимы
возврата платежа, совместимость `subscriptionUrl|subscription_url` Remnawave,
server-generated return URL, OIDC-поведение и PWA assets. Исторические
`/api/bff`, `/api/me`, `/api/logout` и BFF envelopes намеренно сняты ADR-003.
Неизвестные внешние строки отображаются дословно.

Следующее изменение входной архитектуры требует нового ADR и полного сброса
verification cycle.
