# Визуальные компоненты

## Оболочки

- AppShell: topbar, sidebar/menu, mobile overlay, main content, footer.
- AuthShell: full-viewport центрирование, двухслойная белая frame/card, logo/title/description/content/footer.
- PageHeader: eyebrow, H1, description и optional actions.

## Примитивы

Button/link-button, card, input, password с toggle, Message, Tag, dropdown, toast, dialog, progress spinner/bar, table и responsive device-card. Их состояния и размеры заданы в `design-tokens.md`; controls обязаны иметь label, visible focus и pending/disabled состояние.

## Функциональные панели

Аутентификация; подтверждение регистрации; подтверждение e-mail; Passkey; Telegram WebApp; профиль; связь аккаунта и merge; кабинет и header actions; тарифы; подтверждение покупки; продление; статус возврата; поддержка; PWA install/iOS guide/update; требование действия аккаунта. Нормативная композиция каждой панели находится в PAGE-карточке, а не в имени старого компонента.

Общие formatters сохраняют `ru-RU` даты, byte/traffic/duration labels и явно показывают неизвестный upstream status. Cabinet использует table на desktop и cards на mobile; Auth controls full-width.
