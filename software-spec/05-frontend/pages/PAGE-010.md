# PAGE-010 — Подтверждение покупки

## Маршрут и входные данные

`GET /payment`, AppShell. Вход — query из PAGE-009 и/или сохранённый continuity selection. URL не является источником цены: выбранный offer обязательно повторно находится в свежем HTTP-023.

## Структура

Page header `Подтверждение оплаты`; карточка выбранного тарифа с plan, duration, gateway, ценой и валютой; primary `Перейти к оплате`; outlined/link `Изменить выбор`. При отсутствии или устаревании выбора вместо submit показывается понятное Message и CTA в тарифы.

## Операция

Submit формирует стабильный idempotency key, вызывает HTTP-024 один раз и сохраняет durable operation/payment reference. При URL оплаты выполняется top-level navigation на точный provider URL. Статус `accepted/pending/manual` ведёт PAGE-014 либо остаётся с инструкцией; terminal не выводится из HTTP status без payload.

## Состояния

Loading offers; missing selection; stale/mismatched offer; ready; submitting; provider URL received; accepted/pending; manual action; public error; ambiguous network failure. После неоднозначного сбоя тот же key используется повторно; новый key до выяснения статуса запрещён.

## Приёмка

Эталон PAGE-010 фиксирует missing-selection. Fixture ready должен проверять точное совпадение server offer, блокировку двойного клика, storage continuity, safe external navigation и возврат на PAGE-009 без потери валидного выбора.
