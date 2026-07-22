# Контракты тестовых замен внешних сервисов

Этот документ фиксирует именно сохраняемую интеграционную инфраструктуру. Тестовые замены не определяют полный производственный контракт соответствующего сервиса: они воспроизводят только перечисленные ветви. Неуказанное поведение нельзя приписывать реальному сервису.

## `telegram-oidc-mock`

### Конфигурационные входы

| Имя | Значение по умолчанию | Назначение |
|---|---|---|
| `PORT` | `8090` | порт HTTP-сервера |
| `OIDC_ISSUER` | `http://telegram-oidc-mock:8090` | `iss` токена и внутренние endpoint discovery |
| `OIDC_PUBLIC_ISSUER` | `http://localhost:8090` | публичный authorization endpoint и URL аватара |
| `OIDC_CLIENT_ID` | `dev-telegram-client-id` | ожидаемая аудитория по умолчанию |

При каждом запуске генерируется новый RSA-ключ 2048 бит. `kid` — `clean-pay-dev-telegram-oidc-key`, алгоритм — `RS256`, назначение — подпись.

### `GET /auth`

Query: обязательный `redirect_uri`; необязательные `state`, `nonce`, `client_id`. При отсутствии `redirect_uri` — `400 text/html` с текстом `redirect_uri required`. Иначе создаётся случайный одноразовый code на 10 минут и возвращается `302 Location: {redirect_uri}?code=...&state=...`; `state` добавляется только если был непустым. Остальные OIDC-параметры имитатор не проверяет.

### `POST /token`

Тело читается полностью как `application/x-www-form-urlencoded`; фактический `Content-Type`, Basic authentication, `grant_type`, `redirect_uri`, `client_id` и `code_verifier` имитатор не проверяет. Используется только `code`.

- неизвестный или истёкший code: `400`, JSON `{"error":"invalid_grant"}`;
- действующий code атомарно удаляется и даёт `200` с `token_type:"Bearer"`, `access_token:"dev-access-token"`, `expires_in:600`, `id_token`.

ID token содержит `iss`, `aud`, `sub`, `id`, `telegram_id`, `username`, `name`, `given_name`, `family_name`, `picture`, сохранённый `nonce`, `iat`, `exp=iat+600`. Следует учитывать несовпадение с продуктивным разбором: Clean Pay использует `preferred_username`, а имитатор выдаёт `username`, поэтому username в OIDC-сценарии имитатора становится `null`.

### Служебные endpoint

| Метод и путь | Ответ |
|---|---|
| `GET /.well-known/jwks.json` | `200`, `{keys:[<public JWK>]}` |
| `GET /.well-known/openid-configuration` | `200`, issuer, authorization/token/JWKS endpoint и поддерживаемые `code`, `public`, `RS256` |
| `GET /avatar.png` | `204`, пустое тело |
| любой другой запрос | `404`, `{"error":"not_found"}` |
| необработанное исключение | `500`, `{"error":"internal_error"}` |

Discovery и avatar присутствуют в среде, но сервер Clean Pay discovery не вызывает.

## `telegram-mock`

Имитатор слушает `0.0.0.0:8080`, не проверяет HTTP-метод, bot token, заголовки или тело и всегда возвращает JSON `{ok:true,result:...}`. Имя метода извлекается из пути `/bot{любая непустая строка}/{method}`; при несовпадении используется `unknown`.

| Метод Bot API | `result` |
|---|---|
| любой с префиксом `send` | фиксированный объект сообщения с `message_id:1`, текущим Unix time, private chat и текстом `ok` |
| `getMe` | фиксированный объект dev-бота |
| `getWebhookInfo` | пустой URL, нет сертификата, очередь 0 |
| `setWebhook`, `deleteWebhook`, `setMyCommands` | `true` |
| `getMyName` | `{name:"Clean Pay Dev Bot"}` |
| `getChatMember` | фиксированный пользователь со статусом `member` |
| любой другой | `true` |

Это замена Bot API для Remnashop; Clean Pay к ней напрямую не обращается.

## `remnawave-mock`

Слушает `0.0.0.0:3000`, не проверяет метод, токен или заголовки.

| Точный URL запроса | Ответ |
|---|---|
| `/api/system/metadata` | `200 application/json`, фиксированные version/build/git metadata |
| любой другой, включая query-вариант metadata | `200 application/json`, `{response:null}` |

Таким образом, имитатор проверяет готовность и безопасное отсутствие пользователя, но не положительные сценарии поиска подписки.

## `smtp` — Mailpit

Контейнер принимает SMTP на `1025`, HTTP UI/API на `8025`, допускает любые SMTP-учётные данные и небезопасный механизм аутентификации. Readiness выполняется встроенной командой `mailpit readyz`. На каждое принятое письмо настроен webhook `POST http://smtp-log:8126/`.

Текущий локально проверенный образ имеет digest `axllent/mailpit@sha256:37a38e48e9338cd7e89dfeb487f37b02ebfcd9cb23111bed2d345e79d37d6dd6`. Существующий Compose пока использует плавающий `latest`, но сохраняемый test-prestage обязан заменить его на этот digest до удаления локального кэша образа. Переход на иной digest требует повторной проверки SMTP, `readyz`, HTTP API и webhook.

## `smtp-log`

Конфигурация: `PORT=8126`, `MAILPIT_API_URL=http://smtp:8025`, `SMTP_LOG_MAX_BODY_CHARS=12000` по умолчанию. Контракт webhook и последующего `GET /api/v1/message/{id}` описан в `mailpit-smtp.md`.

Сервер не задаёт собственный предел размера webhook-body. Любой метод кроме POST получает `405`; корректный JSON-объект или массив после последовательной обработки получает `204`; ошибка разбора или обработки — `500`.

## `remnashop` и его служебные контейнеры

`remnashop`, `remnashop-worker` и `remnashop-scheduler` используют один образ, собранный из точно закреплённого commit `b9da68a651e9ab0b7ed52d030e13754311614759`. HTTP-контракт, используемый Clean Pay, описан отдельными операциями RS-001…RS-030. Собственные PostgreSQL и Valkey Remnashop являются его внутренними хранилищами и не должны смешиваться с хранилищами Clean Pay.

Worker запускается с одним процессом и подтверждением задания при получении; scheduler использует тот же набор Taskiq-задач. Это важные участники интеграционного стенда, даже если конкретный тест обращается только к HTTP-контейнеру.

## `caddy`

Локальная тестовая маршрутизация без автоматического HTTPS:

| Порт Caddy | Получатель |
|---:|---|
| `8080` | `app:4000` |
| `8081` | `remnashop:5000` |
| `8026` | `smtp:8025` |

## Правило сохранения

Ни один из перечисленных контейнеров, их конфигурационных файлов, mock-серверов, сетей или томов не подлежит очистке вместе с реализацией Clean Pay без отдельного поимённого решения пользователя.
