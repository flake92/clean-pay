# Telegram: OIDC, Login payload и Bot API

## Раздельные границы

| Граница | Прямой клиент | Назначение |
|---|---|---|
| Telegram OIDC authorization | браузер | получить одноразовый authorization code |
| Telegram OIDC token endpoint | сервер Clean Pay | обменять code на ID token |
| Telegram OIDC JWKS | сервер Clean Pay | проверить подпись ID token и готовность |
| Telegram Login payload | браузер → Clean Pay | совместимый popup/widget вход с HMAC-подписью |
| Telegram WebApp JavaScript SDK | браузер → `telegram.org` | получить `initData`, управлять WebApp и открывать внешние ссылки |
| Telegram Bot API | Remnashop | бот/WebApp; Clean Pay напрямую API не вызывает |
| Remnashop Telegram auth | Clean Pay → Remnashop | преобразовать доказанную Telegram-идентичность в upstream-сессию |

## TG-001: authorization redirect

Production endpoints фиксированы на официальном origin; переопределение допускается только не в production.

```http
GET https://oauth.telegram.org/auth
  ?response_type=code
  &client_id={TELEGRAM_OIDC_CLIENT_ID}
  &redirect_uri={APP_URL}/auth/telegram/callback
  &scope=openid%20profile
  &state={random}
  &nonce={random}
  &code_challenge={base64url-sha256(code_verifier)}
  &code_challenge_method=S256
```

`state`, `nonce` и `code_verifier` живут 10 минут. Их исходные значения сохраняются в HttpOnly cookies `clean_pay_tg_state`, `clean_pay_tg_nonce`, `clean_pay_tg_code_verifier`; в долговечном хранилище сохраняются только хэши и одноразовый статус. Cookie имеют `Path=/`, настраиваемые Secure/SameSite и max-age 600 секунд.

OIDC-сервис перенаправляет браузер на точный callback с `code` и `state`. Отсутствие любого параметра, несовпадение cookie/state, истечение или повторное потребление приводят к отказу без принятия идентичности.

## TG-002: обмен authorization code

```http
POST https://oauth.telegram.org/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

grant_type=authorization_code
code={code}
redirect_uri={exact callback}
client_id={client_id}
code_verifier={original verifier}
```

Если настроенный секрет клиента начинается с `{client_id}:`, этот префикс удаляется перед Basic auth. Таймаут 10 секунд, без повтора. Не-2xx, JSON с `error`, отсутствие `id_token` либо невалидный JSON завершают вход ошибкой.

Минимальный используемый ответ: `id_token: string`. Совместимый имитатор также возвращает `token_type`, `access_token`, `expires_in`.

## TG-003: JWKS и проверка ID token

```http
GET https://oauth.telegram.org/.well-known/jwks.json
```

Для проверки готовности ответ обязан быть 2xx JSON `{keys:[...]}` с хотя бы одним ключом; таймаут проверки 5 секунд и общий предел 8 секунд. Для проверки JWT ключ выбирается по `kid` стандартным JWKS-механизмом.

ID token обязан иметь валидную подпись/срок, точный настроенный issuer, audience равный client ID и nonce, равный одноразовой cookie. Telegram ID берётся сначала из claim `id`, затем `telegram_id`; допускается string или number, после преобразования значение должно быть положительным целым.

Используемые профильные claims:

| Claim | Использование |
|---|---|
| `preferred_username` | Telegram username или `null` |
| `name` | полное имя; имеет приоритет |
| `given_name`, `family_name` | составное имя и поля для Remnashop |
| `picture` | avatar URL и Telegram auth payload |

После криптографической проверки одноразовое OIDC-состояние атомарно помечается потреблённым до завершения привязки аккаунтов.

## TG-004: popup/widget payload

Совместимый вход принимает поля `id`, `first_name`, optional `last_name`, `username`, `photo_url`, `auth_date`, `hash`. Обязательны hash, id и auth_date. Payload старше 24 часов отклоняется.

Проверка HMAC:

1. исключить `hash`, пустые и отсутствующие значения;
2. отсортировать остальные пары по имени;
3. соединить как строки `key=value` через `\n`;
4. секретный ключ — SHA-256 от Telegram bot token;
5. ожидаемое значение — HMAC-SHA256 в hex.

Popup-start создаёт то же одноразовое серверное состояние и cookies, но возвращает JSON `{clientId,nonce,redirectUri}` вместо redirect. Полученный popup ID token проходит TG-003.

## TG-005: преобразование идентичности в Remnashop

После проверки OIDC/widget Clean Pay формирует Remnashop `POST /auth/telegram` с текущим `auth_date`, Telegram ID, именем/username/photo и новой HMAC-подписью на основе того же bot token. Успешный ответ даёт upstream access/refresh cookies. Ошибка Remnashop не отменяет факт криптографически проверенной Telegram-идентичности для всех сценариев, но при привязке к уже существующему аккаунту изменение владельца запрещено без подтверждённой upstream-проверки.

## TG-006: Telegram WebApp JavaScript SDK

Браузер динамически загружает точный URL:

```text
https://telegram.org/js/telegram-web-app.js
```

Элемент script создаётся с `async` и маркером `data-clean-pay-telegram-webapp`. Повторная загрузка не создаёт второй элемент: ожидание подписывается на уже существующий script. Ошибка загрузки переводит экран WebApp-входа в управляемую ошибку.

Используемая поверхность `window.Telegram.WebApp`: необязательные `ready()`, `expand()`, `initData: string`, `openLink(url,{try_instant_view:false})`. Для входа обязательно непустое `initData`, которое затем передаётся в Remnashop через Clean Pay. При отсутствии `openLink` используется обычная навигация браузера.

## Telegram Bot API со стороны Remnashop

Clean Pay использует bot token только для HMAC и проверки согласованности client ID; сетевых запросов Bot API не делает. Remnashop имеет отдельный `BOT_API_BASE_URL` и вызывает методы Telegram через bot path `/bot{token}/{method}`.

Dev-имитатор распознаёт любые такие методы и возвращает `{ok:true,result:...}`. Специально моделируются `getMe`, `getWebhookInfo`, `setWebhook`, `deleteWebhook`, `setMyCommands`, `getMyName`, `getChatMember` и все методы с префиксом `send`; остальные получают `true`. Это имитатор протокола Remnashop, не доказательство, что Clean Pay вызывает эти методы.

## Имитатор OIDC

`telegram-oidc-mock` предоставляет `/auth`, `/token`, `/.well-known/jwks.json`, `/.well-known/openid-configuration`, `/avatar.png`. Код одноразовый и живёт 10 минут; имитатор подписывает RS256 ID token временным ключом, включает оба claim `id` и `telegram_id`, nonce и профиль. Discovery и avatar существуют для полноты тестовой среды, но текущий Clean Pay напрямую discovery не вызывает.
