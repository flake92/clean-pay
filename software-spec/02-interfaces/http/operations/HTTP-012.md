# Начать вход по ключу доступа

## Идентификатор

`HTTP-012`

## Назначение

Вернуть WebAuthn request options для discoverable credential и создать одноразовый challenge.

## Владелец

Модуль доступа и идентичности.

## Акторы

Гость, браузер и аутентификатор.

## Предусловия

WebAuthn поддерживается браузером; сессия не нужна.

## Логический входной контракт

Тело отсутствует. Используется только right-most валидный IP из `X-Forwarded-For`; отсутствие/невалидность даёт identity `none`.

## Текущий транспорт

`POST /account/passkey_session`. Public bodyless WebAuthn protocol endpoint with Rails CSRF/origin protection.

ADR-003 заменяет исторический BFF/JSON transport этой операции.
## Правила валидации

Лимит 20 запросов/900 секунд по HMAC IP identity; технический отказ Redis — fail-closed. RP ID — hostname публичного origin.

## Нормализация

IP проверяется стандартным IPv4/IPv6 parser после trim правого элемента списка.

## Авторизация

Публично.

## Идемпотентность

Нет: каждый успех создаёт новый challenge.

## Основной сценарий

Rate-limit → генерация options (`timeout=60000`, `userVerification="required"`, без `allowCredentials`) → сохранение challenge типа AUTHENTICATION на 5 минут → ответ.

## Альтернативные сценарии

Несколько параллельных challenges допустимы.

## Ошибочные сценарии

`403 FORBIDDEN` origin, `429 RATE_LIMITED`, `502 UPSTREAM_ERROR` при некорректном Redis response, `500` локального хранилища. 400/413/415 отсутствуют, потому что тело не читается.

## Логический результат

`200 {"data":<PublicKeyCredentialRequestOptionsJSON>}`; browser-protocol JSON exception.
## Побочные эффекты

Redis counter и новый challenge.

## Транзакционные требования

Одна атомарная вставка challenge.

## Наблюдаемость

Общие HTTP/rate-limit записи; challenge не журналируется.

## Источники

Доказательства находятся в `09-traceability/`.

## Статус уверенности

`требует повторной проверки после ADR-003`
