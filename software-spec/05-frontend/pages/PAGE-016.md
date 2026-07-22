# PAGE-016 — Способы входа и связь аккаунта

## Маршрут и назначение

`GET /link-account`, AppShell, полная сессия. Экран связывает Remnashop e-mail, Telegram, merge confirmation и Passkey; это четыре разные операции, а не одна форма.

## Порядок секций

1. Page header `Способы входа`/`Связать аккаунт`.
2. Если существует merge evidence: high-severity inline panel с данными сторон и `Объединить аккаунты`/`Отмена`.
3. E-mail link-card: `E-mail`, `Пароль`, submit `Привязать e-mail`.
4. Telegram link-card: текущий статус, `Привязать Telegram` или повторная проверка.
5. Passkey card: optional name, `Настроить быстрый вход`, список credentials с именем/датой и delete.

## Операции

Merge read/confirm/cancel → HTTP-017/018/019. Remnashop link → HTTP-020. Telegram start/callback → HTTP-041/042/043. Passkey create → HTTP-010/011; list → HTTP-014; delete exact credential → HTTP-015.

## Правила и состояния

Merge owner-fenced и одноразовый; cancel очищает evidence. E-mail/password required и не сохраняются. Telegram collision не связывается молча, а создаёт merge panel. Passkey delete блокируется для последнего допустимого ключа, если политика запрещает лишить аккаунт способа входа. Loading/error/empty отделены для каждой секции; кнопка текущей мутации блокируется без заморозки остальных.

## Приёмка

Эталон PAGE-016: e-mail-сессия, Telegram/merge/Passkey отсутствуют. Нужны fixtures merge, linked Telegram, credentials list и last-key disabled. Проверить destructive-action отсутствие modal как совместимость, accessible name каждого delete и отсутствие credential raw data в UI.
