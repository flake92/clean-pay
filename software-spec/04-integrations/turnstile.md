# Cloudflare Turnstile

## Участники

Браузер получает site key и виджет, а затем передаёт токен Clean Pay под именем `turnstileToken` либо `cf-turnstile-response`. Сервер Clean Pay проверяет токен у внешнего siteverify API. При отключённом Turnstile проверка явно не выполняется.

## TS-000: API виджета в браузере

При наличии site key браузер загружает:

```text
https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit
```

Элемент script имеет фиксированный DOM id, `async` и `defer`; параллельные компоненты разделяют одно Promise загрузки. После события load интерфейс `window.turnstile.render` ожидается до 5 секунд с интервалом 50 мс.

Виджет создаётся с `sitekey`, `size: flexible` и callback-функциями. Успех передаёт токен; истечение и ошибка обнуляют токен; ошибка показывает русское сообщение. При reset токен обнуляется, при удалении компонента виджет уничтожается. Если site key отсутствует при ожидаемом включённом виджете, показывается конфигурационная ошибка.

## TS-001: server-side verification

```http
POST {TURNSTILE_VERIFY_URL}
Content-Type: application/x-www-form-urlencoded

secret=<TURNSTILE_SECRET_KEY>&response=<token>[&remoteip=<ip>]
```

| Поле | Обязательно | Источник |
|---|---:|---|
| `secret` | да | server-only secret |
| `response` | да | сначала `turnstileToken`, затем совместимое `cf-turnstile-response` |
| `remoteip` | нет | только валидный IP из правого крайнего элемента `X-Forwarded-For` |

Таймаут 10 секунд, без повтора, без кэширования. Успешный транспортный ответ должен быть 2xx JSON с `success:true` и `hostname`, который без учёта регистра точно равен hostname публичного `APP_URL`.

Используемые поля ответа: `success?: boolean`, `hostname?: string`, `error-codes?: string[]`.

## Ошибки

| Условие | Результат Clean Pay |
|---|---|
| Turnstile включён, но secret отсутствует | `503 UPSTREAM_UNAVAILABLE` |
| токен отсутствует | `403 FORBIDDEN` |
| сетевая ошибка/таймаут | `503 UPSTREAM_UNAVAILABLE` |
| ответ не JSON | `503 UPSTREAM_UNAVAILABLE` |
| non-2xx | `503 UPSTREAM_UNAVAILABLE` |
| `success` не true | `403 FORBIDDEN` |
| hostname не совпал | `403 FORBIDDEN` |

Vendor-specific IP headers игнорируются. Доверие к правому `X-Forwarded-For` основано на production-инварианте: приложение опубликовано только через локальный доверенный reverse proxy.

## Тестовый режим

В dev Turnstile отключён. Для одноразового внешнего стенда допускаются официальные тестовые ключи, но production bypass отсутствует. Произвольная замена verify URL разрешена конфигурацией только в пределах правил окружения.
