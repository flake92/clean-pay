# PAGE-008 — Личный кабинет

## Маршрут, shell и доступ

`GET /cabinet`, полный AppShell, только полная сессия. Неподтверждённый e-mail, bootstrap и гость перенаправляются до отрисовки данных.

## Порядок секций

1. Page header: eyebrow `Clean Pay`, H1 `Личный кабинет`, пояснение, outlined `Тарифы`.
2. Четыре metric-card: `Подписка`, `Действует до`, `Устройства`, `Трафик`, каждая с иконкой и значением.
3. Большая карточка `Текущая подписка` и правая карточка `Профиль`.
4. При активной подписке: URL подключения с copy/open, детали тарифа/периода/лимитов, reissue, promo, устройства и renew. При отсутствии — H2 `Подписка не активна`, Tag `Нет подписки`, CTA `Выбрать тариф` и `Привязать аккаунт`.
5. `История платежей`: Message и таблица с колонками `Платёж`, `Дата`, `Gateway`, `Сумма`, `Статус`.
6. `Поддержка`: e-mail, Telegram, FAQ; затем быстрые ссылки, logout и footer.

## Данные и операции

Профиль HTTP-004; текущая подписка/живой URL HTTP-022; offers HTTP-023; devices HTTP-028; payment history HTTP-031; support HTTP-033. Reissue HTTP-026; promo HTTP-027; удалить все устройства HTTP-029; удалить одно HTTP-030; logout HTTP-005. Copy меняет только clipboard; open использует полученный URL и не конструирует его.

## Независимые состояния

Каждая панель имеет loading/content/empty/error независимо. Subscription: absent/active/expired/unknown; live URL unavailable не скрывает остальные данные. Devices: desktop table и mobile cards, empty/error/mutation pending. History: empty/table/error. Promo: idle/pending/success/error. Reissue/delete: target-specific pending; в текущем поведении отдельного confirm modal нет.

## Адаптивность и приёмка

Desktop metrics 4 колонки, subscription/profile 3:1; mobile всё одной колонкой, длинный e-mail и URL переносятся, таблица не ломает viewport. Эталон — подтверждённый e-mail без подписки/Telegram/платежей. Все empty-состояния должны отличаться от error.
