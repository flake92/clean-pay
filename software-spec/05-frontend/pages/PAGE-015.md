# PAGE-015 — Профиль

## Маршрут и данные

`GET /profile`, AppShell, полная сессия. Текущий профиль загружается HTTP-004.

## Структура

Page header `Профиль`; карточка идентичности с e-mail, Telegram и Tag подтверждения; форма смены e-mail; форма смены password; inline Message для каждого независимого действия. Для Telegram-only пользователя вместо невозможной password-операции показывается guidance по привязке e-mail.

## Форма e-mail

Поле `Новый e-mail`, optional Turnstile, primary `Сохранить`. Тот же адрес означает запрос повторного письма HTTP-007; новый адрес — HTTP-009 и переход/инструкция PAGE-005. UI не меняет текущий e-mail до server response и явно сообщает о необходимости подтверждения.

## Форма password

`Текущий пароль`, `Новый пароль`, toggle visibility, submit → HTTP-006. Успех сообщает об изменении и отзыве sibling sessions; текущая сессия ведёт себя по HTTP-контракту. Password очищаются после результата и никогда не попадают в URL/storage.

## Состояния и приёмка

Profile loading/error; e-mail idle/pending/resend/change/error; password unavailable/idle/pending/success/error. Формы имеют отдельные locks. Mobile — одна колонка, длинный e-mail переносится. Эталоны PAGE-015; проверить autocomplete, labels, live messages, Turnstile и revoked-session поведение.
