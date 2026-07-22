# PAGE-003 — Явная регистрация

## Маршрут и доступ

`GET /register`, AuthShell. Только гость; существующая сессия проходит те же redirects, что PAGE-002.

## Структура и поля

Логотип; H1 `Регистрация`; пояснение; поля в порядке: `E-mail`, `Пароль`, `Повторите пароль`; optional Turnstile; primary `Зарегистрироваться`; ссылка возврата к входу; footer `Clean Pay`. Password-поля имеют безопасный toggle видимости и не подставляются в query.

## Правила и операция

E-mail required и нормализуется; password required; повтор должен совпасть. Submit единожды вызывает HTTP-003. Серверная политика password и антибот-проверка авторитетны; UI не объявляет успех до ответа. Частичный успех `аккаунт создан, письмо не отправлено` ведёт на PAGE-004 с явной возможностью повторной отправки, а не создаёт второй аккаунт.

## Состояния

Пусто; invalid e-mail; mismatch; weak/server-rejected password; Turnstile unavailable; submitting; registration error; success redirect. Сообщение доступно как live region. При возврате с ошибкой введённый password очищается.

## Адаптивность и приёмка

AuthShell и full-width controls как PAGE-002. Эталоны PAGE-003 desktop/mobile. Обязательны tab-order по визуальному порядку, связанные labels, autocomplete `email/new-password`, disabled submit только на время отправки или отсутствующего обязательного anti-bot token.
