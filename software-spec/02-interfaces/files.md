# Файловые интерфейсы

## Пользовательские загрузки и скачивания

Операций upload, приёма multipart и генерации пользовательских скачиваний нет.

## Публичные статические ресурсы

| Путь | Тип | Назначение |
|---|---|---|
| `/clean-pay-logo.png` | PNG | логотип по умолчанию |
| `/clean-pay-icon-192.png` | PNG | PWA icon |
| `/clean-pay-icon-512.png` | PNG | PWA icon |
| `/clean-pay-icon-maskable-512.png` | PNG | maskable PWA icon |
| `/themes/lara-light-indigo/theme.css` | CSS | тема визуальных компонентов |
| шрифты темы | WOFF2 | переменные шрифты Inter |
| `/favicon.ico` | icon | browser favicon |

## Динамические файлы

- `/manifest.webmanifest` формируется динамически по контракту PWA и branding-конфигурации.
- `/sw.js` формируется HTTP-обработчиком из build ID; JavaScript UTF-8, `no-cache/no-store/must-revalidate`, `Service-Worker-Allowed: /`.
- Offline fallback кэшируется по `/offline`.

## Эксплуатационные файлы

- `.env`/production `.env` — секреты и конфигурация; launcher устанавливает права 600.
- `/tmp/clean-pay-retention-heartbeat` и `/tmp/clean-pay-reconciliation-heartbeat` — текст epoch-ms только для healthcheck контейнеров.
- Резервные копии PostgreSQL создаёт/восстанавливает deployment-инструмент; процедура описана в operations.
- Именованные volumes сохраняют PostgreSQL, Redis и служебные assets/logs.

## Кодировка и лимиты

JSON запроса декодируется как строгий UTF-8: недопустимая последовательность является ошибкой. Статические bytes выдаются без перекодирования. Лимита пользовательского файла нет, потому что интерфейса загрузки/скачивания не существует.
