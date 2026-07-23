# Отдать service worker PWA

## Идентификатор

`HTTP-044`

## Назначение

Установить versioned offline shell без кэширования персональных/API-ответов.

## Владелец

Платформенный/PWA-модуль.

## Акторы

Браузер.

## Предусловия

Сборка имеет непустой `CLEAN_PAY_BUILD_ID` длиной не более 200 после trim.

## Логический входной контракт

Нет; query/body не используются.

## Текущий транспорт

`GET /service-worker.js`; публичный JavaScript protocol resource, сформированный Rails и привязанный к build ID.

## Правила валидации

Отсутствующий build ID даёт управляемый 503 plain text. Пустой после trim или длиннее 200 приводит к необработанной ошибке генерации и framework 500.

## Нормализация

Cache name `clean-pay-shell-{trimmedBuildId}`; значение JSON-экранируется, `<` заменяется `\u003c`.

## Авторизация

Нет.

## Идемпотентность

Тот же build ID даёт семантически тот же JavaScript.

## Основной сценарий

Вернуть JS, который при install cache-reload получает `/offline`, `/manifest.webmanifest`, три icons и `/clean-pay-logo.png`; при activate удаляет только старые `clean-pay-shell-*`; при navigation GET сначала идёт в сеть, а только network rejection использует cached `/offline` с ignoreSearch.

## Альтернативные сценарии

Не-navigation или не-GET service worker не перехватывает. HTTP 4xx/5xx navigation не заменяются offline page, потому что fetch resolve не является network rejection.

## Ошибочные сценарии

Нет build ID — `503` body `Service worker build ID is unavailable`. Невалидный build ID — 500. Ошибка precache отклоняет install; отсутствие offline cache при network failure возвращает `Response.error()`.

## Логический результат

`200 application/javascript`; service worker shell contract с безопасным cache name и offline fallback.

## Побочные эффекты

На сервере только access log; в браузере Cache Storage/service worker lifecycle.

## Транзакционные требования

Browser `Promise.all` означает: install считается успешным только после получения и записи всех shell assets, хотя Cache API может содержать уже записанные элементы неуспешной попытки.

## Наблюдаемость

Build ID допустим в asset/version metadata, пользовательские URL/API bodies не кэшируются и не логируются worker-ом.

## Источники

Доказательства находятся в `09-traceability/`; browser/PWA interface — разделы 04 и 05.

## Статус уверенности

`требует повторной проверки после ADR-003`
