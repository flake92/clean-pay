# PAGE-017 — Поддержка

## Маршрут и данные

`GET /support`, AppShell. Контакты получает HTTP-033; гость допускается или перенаправляется согласно общей политике доступа.

## Структура

Page header `Поддержка`; introductory card; отдельные contact-card для опубликованных каналов: e-mail с `mailto:`, Telegram с `https://t.me/...`, FAQ с URL. Каждый канал имеет title, пояснение, иконку и кнопку. Если канал не опубликован, его action не создаётся. Если не опубликован ни один, показывается информационное empty-состояние.

## Состояния и безопасность

Loading skeleton/spinner; loaded contacts; empty/unpublished; fetch error с retry. URL берётся из server response; допускаются только ожидаемые схемы, внешняя ссылка не превращается в HTML. Ошибка support API не подменяется hardcoded личным контактом.

## Адаптивность и приёмка

Desktop карточки в сетке, mobile одной колонкой. Эталоны PAGE-017 фиксируют опубликованные e-mail, Telegram и FAQ. Проверить keyboard, понятный accessible name внешних ссылок, перенос длинного адреса, safe target/rel и retry.
