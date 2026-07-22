# PAGE-002 — Вход и определение аккаунта

## Маршрут и доступ

`GET /login`, AuthShell. Гость видит форму. Полная сессия направляется в `/cabinet`; bootstrap-сессия — в `/passkey/setup`; неподтверждённый e-mail — на экран подтверждения. Допустим только безопасный локальный `redirect_to`.

## Начальная сцена

Логотип 68×68, H1 `Вход`, пояснение о вводе e-mail и выборе дальнейшей ветки, label `E-mail`, поле с placeholder `user@example.com`, primary `Продолжить`, outlined `Войти через Telegram`, footer-link `Clean Pay`.

## Ветви формы

- Начало: e-mail required, trim, lower-case для идентификации; submit → HTTP-001.
- Известный аккаунт: summary e-mail и `Изменить`; password required; `Продолжить` → HTTP-002; при доступном Passkey показывается кнопка быстрого входа → HTTP-012, WebAuthn, HTTP-013.
- Неизвестный аккаунт: password и повтор password; равенство обязательно; `Создать аккаунт` → HTTP-003.
- Telegram → HTTP-041; возврат обрабатывают HTTP-042/043. Turnstile, если включён сервером, располагается перед submit и блокирует отправку без token.

## Обратная связь

Каждый submit имеет spinner/замену label и блокирует повтор. Ошибка показывается внутри AuthShell в Message с severity `error`; rate limit сохраняет публичный текст сервера. Успешная регистрация ведёт PAGE-004; login — безопасный redirect или PAGE-008; bootstrap — PAGE-007.

## Адаптивность и приёмка

Desktop frame ≤42 rem, внутренний контент ≤34 rem. Mobile ≤480 px: frame почти на всю ширину, кнопки full-width, title 2 rem. Эталоны: PAGE-002 desktop/mobile. Проверить email keyboard, password manager, Enter-submit, focus error и отсутствие password в URL.
