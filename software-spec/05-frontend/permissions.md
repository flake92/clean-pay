# Доступность функций интерфейса

| State | Visible/allowed destination |
|---|---|
| Guest | home/login/register/tariffs(public rendering may later need offer auth), install/offline/Telegram entry |
| BOOTSTRAP | passkey setup and logout only |
| Email unverified without Telegram | registration/general verification and logout |
| Full | all app screens; actual subscription controls require upstream link/subscription |
| Telegram-only | profile shows email-link guidance; link-account offers email/Telegram/passkey methods |

Видимость меню лишь помогает пользователю; серверная политика и обработчик авторитетны. Прямая защищённая навигация перенаправляется в точности по platform HTTP-карточке. Скрытие пункта меню не считается механизмом безопасности.
