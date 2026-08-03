# Кабинет статистики рекламодателей

Кабинет запускается отдельным контейнером `advertiser-cabinet` и публикуется
через основной домен Clean Pay по пути `/partners/`. Он не вызывает admin API
RemnaShop и использует только PostgreSQL-роль `advertiser_stats_ro` с
`default_transaction_read_only=on`.

## Определения показателей

- регистрация — пользователь, которому бот при первом запуске сохранил
  настроенную штатную рекламную ссылку в `users.ad_link_id`;
- успешная оплата — нетестовая `COMPLETED` transaction с положительной
  `final_amount`;
- атрибуция оплаты — не позднее 7 дней после регистрации;
- первая оплата — самая ранняя атрибутированная успешная оплата пользователя;
- месяц и день рассчитываются в `Europe/Moscow`;
- суммы никогда не смешиваются между валютами.

Кабинет не выводит e-mail, Telegram ID, имена или идентификаторы покупателей.

## Первичная настройка

1. В базе RemnaShop выполнить `deploy/advertiser/create-stats-role.sql`, передав
   случайный пароль через psql-переменную `stats_password`.
2. Скопировать `deploy/advertiser/.env.example` в
   `deploy/advertiser/.env`.
3. Создать пароль и scrypt-хеш командой из каталога `advertiser-cabinet`:
   `npm run credentials -- <login> <admin|advertiser> [campaign-id]`.
4. Заполнить JSON-массивы аккаунтов и кампаний. Администратор видит все
   кампании; рекламодатель — только перечисленные в `campaignIds`.
5. Проверить конфигурацию из `deploy/advertiser` командой
   `docker compose --env-file .env config`.
6. Собрать и запустить отдельный Compose-проект командой
   `docker compose --env-file .env up -d`.

## Caddy

Маршрут кабинета должен находиться перед общим маршрутом Clean Pay:

```caddyfile
handle /partners* {
    reverse_proxy advertiser-cabinet:4100
}

handle {
    reverse_proxy clean-pay:4000
}
```

Перед reload обязательно выполнить `caddy validate`, сохранить предыдущую
конфигурацию и после reload проверить `/partners/health` и readiness основного
Clean Pay.
