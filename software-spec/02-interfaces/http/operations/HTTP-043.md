# Завершить Telegram popup или Login Widget callback

## Идентификатор

`HTTP-043`

## Назначение

Завершить ту же Telegram login/link ceremony без навигационного OIDC callback.

## Владелец

Модуль доступа и идентичности.

## Акторы

Popup/widget frontend.

## Предусловия

Trusted origin, JSON body, nonce cookie и непросроченная непоглощённая state record.

## Логический входной контракт

JSON UTF-8 до 65 536 байт: либо `idToken:string`, либо `authData:object`. При наличии обоих приоритет имеет непустой строковый `idToken`. Widget object поддерживает `id,first_name,last_name?,username?,photo_url?,auth_date,hash`.

## Текущий транспорт

`POST /auth/telegram/callback`; application/json; Origin/Referer policy; временные cookies.

## Правила валидации

ID token — TG-003 и nonce. Widget — TG-004: bot token configured, hash/id/auth_date, возраст не более 24 часов, HMAC exact; затем state claim. `authData` действительно является рабочим совместимым интерфейсом, а не игнорируемым полем.

## Нормализация

Widget default `first_name="Telegram"`; ID/string conversions и профиль по TG-003/004. Redirect берётся только из сохранённой safe state.

## Авторизация

Telegram cryptographic proof и optional link-user binding state; далее те же owner/merge правила, что HTTP-042.

## Идемпотентность

State одноразовая. Повтор при существующей session получает безопасный processing redirect; прочий повтор — 400.

## Основной сценарий

Проверить один из двух proofs, claim state, reconcile/merge/link, создать session, вернуть `200 {"redirectTo":safePath}` без BFF envelope.

## Альтернативные сценарии

Требуется подтверждение e-mail replace — тот же 200 redirectTo link-account плюс merge cookie, без создания новой session на этой ветви. Already consumed + session — 200 redirectTo processing.

## Ошибочные сценарии

Нет обоих proofs или любая обычная ошибка — `400 {"error":"telegram_failed"}`. Body > limit — `413 {"error":"payload_too_large"}`. Malformed JSON/array также скрываются как telegram_failed 400. Edge может раньше вернуть стандартные `403`/`415` envelope.

## Логический результат

200 `{redirectTo:string}` и возможные session/merge cookies; ошибки — плоская `{error:string}`.

## Побочные эффекты

State claim, Remnashop auth/link/merge, local merge/session/cookies/audit как HTTP-042.

## Транзакционные требования

Как HTTP-042; нельзя повторять внешнюю owner mutation после claim без recovery state.

## Наблюдаемость

Не журналировать idToken/authData/hash; только outcome/user ID/redirect class.

## Источники

Доказательства находятся в `09-traceability/`; TG-003—TG-005.

## Статус уверенности

`подтверждено`
