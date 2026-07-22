# PAGE-004 — Подтверждение регистрации

## Маршрут и доступ

`GET /register/verify-email`, AuthShell. Требует bootstrap-сессию после регистрации. Полная сессия не должна повторно проходить регистрацию.

## Структура

Логотип; H1 `Подтверждение e-mail`; текст `Введите 6 цифр из письма, чтобы завершить регистрацию.`; label `Код подтверждения`; textbox placeholder `000000`; primary `Подтвердить e-mail`; outlined `Отправить код повторно`; outlined `Назад`; footer `Clean Pay`.

## Действия

Код принимает только 6 цифр, `maxLength=6`; confirm → HTTP-008. Resend → HTTP-007. Обе операции и `Назад` используют общий lock против гонки. `Назад` выполняет HTTP-005 и возвращает PAGE-002, а не оставляет bootstrap-cookie. Успех confirm → PAGE-007.

## Состояния и ошибки

Пустой код; неполный/неверный/истёкший код; rate limit; SMTP resend success; SMTP resend failure; submitting confirm; resending; logout/back; success. Ошибка кода не очищает поле автоматически; resend не объявляет, существует ли чужой e-mail.

## Приёмка

Эталоны PAGE-004 desktop/mobile. В реальном тесте письмо дошло через SMTP в Mailpit, код был введён и принят. Проверить numeric mobile keyboard, paste 6 цифр, Enter, live status и отсутствие кода в URL/логах.
