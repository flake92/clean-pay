# HTTP-контракты подписки

Общие для персональных операций условия: cookie полной сессии, выполнение правила подтверждения почты, действующая внешняя связь. Обновление сессии может заменить обе cookie. Неуказанные параметры строки запроса игнорируются. Доказательства: TRACE-HTTP-021—030.

## HTTP-021 — Публичные тарифы

- Транспорт: `GET /plans`; без тела, параметров, заголовков авторизации и обязательных cookie.
- Результат: `200 text/html`; Rails рендерит каталог и его пустое состояние.
- Ошибки: нормализованные 4xx внешней системы, 502 неверный ответ/недоступность/таймаут, 500 внутренняя ошибка. `503/504` Remnashop-клиент не формирует.
- Эффекты: только внешний запрос и журнал; операция повторяема и не изменяет данные.

## HTTP-022 — Текущая подписка

- Транспорт: `GET /subscription`; тело и параметры отсутствуют.
- Пустой результат: `200 text/html` с пустым состоянием.
- Непустой результат: `200 text/html`; серверный view получает поля `user_remna_id:string`, `status:string`, `is_trial:boolean`, `traffic_limit:number`, `device_limit:number`, `traffic_limit_strategy:string`, `expire_at:string`, `url:string`, `plan_name:string`, `plan_duration_days:number`, `used_traffic_bytes:number|null`, `lifetime_used_traffic_bytes:number|null`, `online_at:string|null`.
- Правило URL: поле `url` заменяется проверенной актуальной ссылкой; отсутствие однозначной ссылки даёт 409 `SUBSCRIPTION_URL_UNAVAILABLE`.
- Ошибки: 401, 403, 404 `SUBSCRIPTION_NOT_FOUND`, 409, 502, 500. `503/504` Remnashop-клиент не формирует.
- Эффекты: возможное обновление сессии; локальная подписка не создаётся.

## HTTP-023 — Персональные предложения

- Транспорт: `GET /subscription/offers`.
- Результат — `200 text/html`; Rails рендерит:
  - `gateways`: массив `{gateway_type,currency,currency_symbol}`;
  - `plans`: массив `{id,public_code,name,description:null|string,traffic_limit,device_limit,type,recommended_purchase_type,durations}`;
  - `durations`: массив `{days,prices}`;
  - `prices`: массив `{gateway_type,currency,currency_symbol,original_amount,discount_percent,final_amount,is_free}`;
  - `has_current_subscription:boolean`, `current_subscription_status:string|null`.
- Пустые массивы допустимы; регистр и неизвестные строковые значения сохраняются.
- Ошибки: 401, 403, 502, 500. Чтение повторяемо, но цены могут измениться между запросами.

## HTTP-026 — Перевыпуск ссылки

- Транспорт: `POST /subscription/reissue`; запрос без тела, доверенный источник.
- Результат: `303 See Other` на `/subscription` с flash.
- Ошибки: 401, 403, 404, 409, 502, 500. Успешная внешняя мутация может предшествовать ошибке аудита.
- Эффекты: внешняя подписка изменяется, действие журналируется; ключ повторяемости отсутствует, повтор может перевыпустить ссылку ещё раз.

## HTTP-027 — Промокод

- Транспорт: `POST /subscription/promocode`; Rails form `promocode[code]` и CSRF.
- Объявленное поле: `code:string`; strong parameters не пропускают дополнительные поля во внешний сервис.
- Результат: `303 See Other` на `/subscription` с flash.
- Ошибки: 400 проверки внешней системы; 404 `PROMOCODE_NOT_FOUND`; 409 для уже применённого, истёкшего, неподходящего, требующего подписку или уже безлимитного ресурса; 401/403/429/502/500.
- Эффекты: внешнее вознаграждение и аудит; идемпотентность определяется внешней системой.

## HTTP-028 — Список устройств

- Транспорт: `GET /subscription/devices`.
- Результат: `200 text/html`; Rails рендерит устройства, `current_count`, `max_count` и формы удаления.
- Пустой массив допустим. Из-за path-specific mapper внешний ошибочный HTTP-ответ на devices отображается как `DEVICE_DELETE_UNAVAILABLE`, а внешний 5xx — в статус 409; сеть/таймаут дают 502. Также возможны 401/403/404/500.

## HTTP-029 — Удалить все устройства

- Транспорт: `DELETE /subscription/devices`; без тела, доверенный источник.
- Результат: `303 See Other` на `/subscription/devices` с flash.
- Ошибки: 401, 403, 404, `DEVICE_DELETE_UNAVAILABLE` (внешний 5xx становится 409), сетевой сбой 502, локальная/audit ошибка 500.
- Эффекты: изменение внешней подписки и аудит. Явного ключа повторяемости нет.

## HTTP-030 — Удалить одно устройство

- Транспорт: `DELETE /subscription/devices/{id}`; `{hwid}` — один непустой сегмент. После декодирования локально допускается любая строка, включая пробелы; перед внешним вызовом она безопасно кодируется как один сегмент.
- Результат: `303 See Other` на `/subscription/devices` с flash.
- Ошибки: 401, 403, 404, `DEVICE_DELETE_UNAVAILABLE` (внешний 5xx становится 409), сетевой сбой 502, локальная/audit ошибка 500.
- Повтор после удаления может вернуть `deleted:false` либо 404 в зависимости от внешней системы.
