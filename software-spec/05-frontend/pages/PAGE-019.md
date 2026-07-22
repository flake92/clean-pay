# PAGE-019 — Нет подключения

## Маршрут и назначение

`GET /offline`, AuthShell. Статический navigation fallback service worker; не требует API, cookies или JavaScript для основного сообщения.

## Структура

Логотип; H1 `Нет подключения`; короткое объяснение, что страницу нельзя открыть без сети; действие повторить/вернуться, если оно предусмотрено текущей сценой; footer `Clean Pay`. Никакие сохранённые персональные данные не выводятся.

## Поведение

HTTP-044 cache-first/network-fallback направляет failed navigation сюда. После восстановления сети обычная reload/navigation возвращает запрошенную страницу; offline fallback не объявляет logout и не очищает continuity storage.

## Адаптивность и приёмка

AuthShell центрирован на desktop и сверху на mobile; текст не выходит за 320 px. Эталоны PAGE-019. Проверить cold offline после установленного worker, отсутствие uncached assets, readable message без JS, focus и восстановление online.
