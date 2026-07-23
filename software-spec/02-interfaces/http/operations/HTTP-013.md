# Завершить вход по ключу доступа

## Идентификатор

`HTTP-013`

## Назначение

Проверить WebAuthn assertion, безопасно обновить счётчик аутентификатора и создать полную локальную сессию.

## Владелец

Модуль доступа и идентичности.

## Акторы

Гость, браузер и аутентификатор.

## Предусловия

Действующий authentication challenge и зарегистрированный credential.

## Логический входной контракт

Стандартный `AuthenticationResponseJSON`: `id`, `rawId`, `type:"public-key"`, `response.clientDataJSON`, `response.authenticatorData`, `response.signature`, optional `response.userHandle`, `clientExtensionResults`, optional `authenticatorAttachment`. Бинарные поля — base64url strings.

## Текущий транспорт

`PATCH /account/passkey_session`. Public WebAuthn JSON object up to 131072 bytes with Rails CSRF header.

ADR-003 заменяет исторический BFF/JSON transport этой операции.
## Правила валидации

Challenge извлекается из clientDataJSON, атомарно claim’ится и проверяется по типу/сроку. Credential ищется по точному `response.id`. WebAuthn verifier проверяет challenge, exact origin, RP ID, signature и user verification.

## Нормализация

Нет.

## Авторизация

Криптографическое доказательство ключом является авторизацией.

## Идемпотентность

Нет: challenge одноразовый; успешный вход создаёт новую сессию.

## Основной сценарий

1. Claim challenge.
2. Найти credential и проверить assertion.
3. Если старый и новый counters не оба нулевые, CAS-обновить запись только при совпадении старого counter; иначе для `0→0` обновить только `lastUsedAt`.
4. Создать сессию method PASSKEY, assurance FULL, access 15 минут/refresh 30 дней.
5. Audit `passkey_login`.

## Альтернативные сценарии

Аутентификаторы без счётчика поддерживаются веткой `0→0`. Параллельные assertions одного non-zero credential: только одно CAS может завершиться успехом; другое создаёт security audit и 401 до сессии.

## Ошибочные сценарии

`400 VALIDATION_ERROR` challenge/body, `401 UNAUTHORIZED` неизвестного ключа/подписи/counter conflict, `403` origin, `413`, `415`, `500`. Поглощённый challenge не восстанавливается после ошибки.

## Логический результат

`200 {"data":{"success":true}}` and Rails session cookies; browser-protocol JSON exception.
## Побочные эффекты

Потреблённый challenge, counter/lastUsedAt, новая сессия, cookie, audit.

## Транзакционные требования

Challenge claim и counter CAS независимы. Counter конфликт fail-closed предотвращает создание сессии.

## Наблюдаемость

Успех audit содержит credential ID и session ID; конфликт counter — WARN audit `passkey_counter_conflict`.

## Источники

Доказательства находятся в `09-traceability/`.

## Статус уверенности

`требует повторной проверки после ADR-003`
