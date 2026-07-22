# PAGE-007 — Необязательная настройка Passkey

## Маршрут и доступ

`GET /passkey/setup`, AuthShell. Основной вход — bootstrap-сессия после подтверждения регистрации; полная сессия может открыть экран повторно только по разрешённой навигации.

## Структура

Логотип; H1 `Быстрый вход`; пояснение о Face ID, отпечатке или PIN; info-card с icon/title и разъяснением необязательности; label `Название ключа`; optional textbox `Например: Android Chrome или ноутбук`; primary `Настроить быстрый вход`; outlined `Продолжить без него`; info Message `Быстрый вход можно настроить позже в профиле.`; footer.

## Операции

Настройка: HTTP-010 → WebAuthn `navigator.credentials.create` → HTTP-011. Название optional, максимум 80 символов по серверному контракту. Успех показывает success и переход в PAGE-008. `Продолжить без него` завершает bootstrap-переход без создания credential и ведёт в кабинет. WebAuthn cancel не считается фатальной ошибкой и оставляет skip доступным.

## Состояния и приёмка

Unsupported; idle; requesting options; native prompt; verifying; success; user cancel; server/replay/origin error; skipping. Кнопки блокируются на время одной операции. Эталоны PAGE-007 desktop/mobile; фактически проверен skip → cabinet. Не обещать Face ID, если платформа предлагает иной authenticator.
