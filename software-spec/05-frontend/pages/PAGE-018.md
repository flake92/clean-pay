# PAGE-018 — Установка PWA

## Маршрут и shell

`GET /install`, AuthShell, доступен без сети после cache и без сессии. Регистрация service worker использует HTTP-044.

## Структура

Логотип; H1 `Установить Clean Pay`; пояснение преимуществ; primary install/open action; platform-specific guidance; footer. Уже установленное приложение показывает `Открыть кабинет`, а не повторную установку.

## Ветви

- `beforeinstallprompt` доступен: primary запускает native prompt, результат accepted/dismissed обрабатывается один раз.
- iOS Safari: modal с `aria-modal`, кнопкой `Закрыть инструкцию`, тремя иллюстрированными шагами Share → Add to Home Screen → Add, финальная `Понятно`.
- Android без prompt: dialog с инструкцией через меню браузера, `Понятно`.
- Embedded browser: dialog просит открыть во внешнем браузере.
- Installed/standalone: переход PAGE-008.

## Состояния и приёмка

Detecting; installable; prompting; accepted; dismissed; iOS; Android fallback; embedded; installed; service-worker unavailable/error. Dialog trap-focus, Escape/close и возврат focus обязательны. Эталоны PAGE-018; отдельные browser fixtures для каждой ветви и проверки update/offline.
