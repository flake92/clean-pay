# PAGE-006 — Вход из Telegram WebApp

## Маршрут и внешний контекст

`GET /auth/telegram/webapp`, AuthShell. Страница допустима без обычной сессии, но успешная операция требует подписанное `Telegram.WebApp.initData`, полученное только внутри Telegram. Query/самодельный JSON не заменяет init data.

## SSR-состояние

Логотип; H1 `Вход через Telegram`; пояснение `Открываем личный кабинет из Telegram.`; progressbar с accessible name; Message `Входим через Telegram...`; footer `Clean Pay`. Именно это состояние зафиксировано в PAGE-006 desktop/mobile.

## Клиентская машина состояний

После готовности Telegram SDK страница получает init data и один раз вызывает HTTP-016. Успех использует только безопасный локальный redirect из ответа и `location.replace`. Ошибка показывает публичное сообщение, кнопку повторить Telegram-вход и ссылку на обычный PAGE-002. Пустой init data даёт guard на `/auth`; наблюдаемый ответ `bot_id_required` не должен отображаться как нормальный экран приложения.

## Безопасность и приёмка

Нельзя логировать init data, hash или пользовательский payload. Повтор не запускает параллельные запросы. Проверить реальные подписи mock Telegram, просрочку, replay, неверный bot token, safe redirect, progressbar/live region и обе responsive-сцены.
