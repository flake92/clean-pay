# PAGE-011 — Продление подписки

## Маршрут и предусловие

`GET /extend`, AppShell. Требует полную сессию, связанную текущую подписку и renewal offers. Текущие данные — HTTP-022, предложения — HTTP-023.

## Структура

Page header `Продление подписки`; summary текущей подписки; selectors duration и gateway; выбранная цена; primary `Продлить`; переход назад в кабинет/тарифы. Без подписки показывается самостоятельное no-subscription состояние и CTA `Выбрать тариф`, а не пустая форма.

## Операция

Только точный renewal offer отправляется HTTP-025 со стабильным idempotency key. Ответ обрабатывается как PAGE-010: provider redirect, accepted/pending/manual/error; durable reference сохраняется для PAGE-012…014.

## Состояния

Loading current/offers; no subscription; no renewal offer; offer changed; ready; submitting; ambiguous failure; provider redirect; pending/manual. Изменение selector сбрасывает несовместимый gateway. Текущая дата окончания не меняется локально до server-confirmed результата.

## Адаптивность и приёмка

На mobile summary и controls одной колонкой. Эталон PAGE-011 фиксирует отсутствие активной подписки. Отдельные fixtures обязаны покрыть ready и stale offer, double click, retry с тем же key и точную сумму/валюту.
