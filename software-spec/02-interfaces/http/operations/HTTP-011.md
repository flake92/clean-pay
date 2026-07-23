# Завершить регистрацию ключа доступа

## Идентификатор

`HTTP-011`

## Назначение

Проверить WebAuthn attestation, сохранить либо безопасно обновить принадлежащий тому же владельцу ключ и повысить `BOOTSTRAP`-сессию до `FULL`.

## Владелец

Модуль доступа и идентичности.

## Акторы

WebAuthn-браузер и пользователь.

## Предусловия

Действующий неиспользованный registration challenge не старше 5 минут и сессия его владельца.

## Логический входной контракт

Стандартный `RegistrationResponseJSON`:

| Поле | Обязательно | Тип/роль |
|---|---:|---|
| `id`, `rawId` | да | base64url credential ID |
| `type` | да | точное `public-key` |
| `response.clientDataJSON` | да | base64url JSON с challenge/origin/type |
| `response.attestationObject` | да | base64url CBOR attestation |
| `response.transports` | нет | массив WebAuthn transport strings; отсутствие сохраняется как `[]` |
| `clientExtensionResults` | да по стандартной сериализации | object |
| `authenticatorAttachment` | нет | стандартное значение |
| `name` | нет | пользовательская подпись ключа |

Дополнительные стандартные поля принимает WebAuthn verifier версии контракта SimpleWebAuthn 13.3.2; продуктовая логика читает перечисленные поля.

## Текущий транспорт

`PATCH /account/passkey_registration`. WebAuthn JSON object up to 131072 bytes; Rails session and CSRF header.

ADR-003 заменяет исторический BFF/JSON transport этой операции.
## Правила валидации

`clientDataJSON` обязан быть base64url-кодированным JSON с непустым строковым challenge. Запись challenge должна иметь тип REGISTRATION, быть неистёкшей/непотреблённой и принадлежать текущему user. Проверяются expected challenge, точный origin, RP ID, подпись/attestation и обязательное user verification.

Challenge атомарно помечается потреблённым **до** криптографической проверки; неудачный verify требует начать новую ceremony.

## Нормализация

`name`: только string; trim, все последовательности whitespace → один пробел, затем обрезка до первых 80 символов; пустое/нестроковое → имя из `User-Agent`: платформа `iPhone|iPad|Android|Windows|macOS|Linux|Устройство` + браузер `Edge|Firefox|Chrome|Safari|браузер`.

## Авторизация

Как HTTP-010: `FULL` с политикой e-mail/Telegram или `BOOTSTRAP`.

## Идемпотентность

Challenge одноразовый. Уже принадлежащий тому же user credential с тем же ID **и тем же public key** обновляет metadata/name, не создавая дубль. Тот же ID другого владельца либо с другим ключом → 409.

## Основной сценарий

1. Восстановить сессию, извлечь и атомарно claim challenge.
2. Проверить владельца и WebAuthn response.
3. Сохранить credential ID, public key, counter, transports, AAGUID, device type, backup flag, name и `lastUsedAt=now`.
4. Обновить `lastLoginAt`; очистить `authPending`, только если нет pending Remnashop evidence.
5. Для bootstrap изменить текущую сессию на method `PASSKEY`, assurance `FULL` и переиздать access-cookie; refresh остаётся тем же.
6. Audit `passkey_registered`.

## Альтернативные сценарии

Concurrent create с unique conflict повторно проверяет owner+credential+publicKey. Совпадение превращается в успешное обновление; несовпадение — конфликт.

## Ошибочные сценарии

`400 VALIDATION_ERROR` для тела/challenge/ceremony, `401`, `403` origin/e-mail/чужой challenge, `409 CONFLICT` чужого credential, `413`, `415`, `500`. Внешних HTTP-вызовов нет.

## Логический результат

`200 {"data":{"success":true}}`; bootstrap access may be promoted. This is a browser-protocol exception.
## Побочные эффекты

Потреблённый challenge, ключ, пользовательское состояние, возможный upgrade сессии, cookie, audit.

## Транзакционные требования

Claim challenge атомарен. Credential create/update и user/session изменения последовательны, но не объединены одной общей транзакцией; при поздней ошибке challenge остаётся потреблённым, а уже сохранённый credential может существовать.

## Наблюдаемость

Audit содержит credential ID и признак upgrade; public key и attestation не журналируются.

## Источники

Доказательства находятся в `09-traceability/`.

## Статус уверенности

`требует повторной проверки после ADR-003`
