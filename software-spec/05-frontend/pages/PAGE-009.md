# PAGE-009 — Тарифы

## Маршрут и назначение

`GET /tariffs`, AppShell. Страница показывает доступные планы и точные purchasable offers. Защитные redirects следуют состоянию сессии.

## Структура

Page header `Тарифы`; зона loading/error; сетка plan-card. В каждой карточке: название/описание плана, характеристики, selector длительности, selector gateway, цена/валюта выбранного offer и primary `Выбрать` либо `Изменить тариф` для действующей подписки. Не существующие комбинации длительности и gateway не синтезируются.

## Данные и переходы

Публичное описание планов — HTTP-021, предложения текущего пользователя — HTTP-023. Выбор сохраняет точные идентификаторы plan/offer/duration/gateway в query и browser continuity storage, затем переходит PAGE-010. Для renewal действующей подписки переход PAGE-011. Страница не создаёт платёж.

## Состояния

Loading; offers loaded; no plans; no matching offers; upstream error; authentication/link required; selector changed; current offer stale. При изменении plan сбрасываются несовместимые duration/gateway. Цена форматируется из server amount/currency и не вычисляется из рекламного текста.

## Адаптивность и приёмка

Desktop cards сеткой, mobile одной колонкой; dropdown overlay не выходит за viewport. Проверить keyboard для dropdown, focus, disabled только при отсутствии точного offer, повторное открытие URL и корректное восстановление выбора. Эталоны PAGE-009.
