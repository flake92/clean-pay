# Отменить Telegram-merge

## Идентификатор

`HTTP-019`

## Назначение

Отменить ещё не начатое объединение аккаунтов.

## Владелец

Модуль доступа и идентичности.

## Акторы

Вошедший пользователь.

## Предусловия

Сессия, merge-cookie и confirmation в точном status `PENDING`.

## Логический входной контракт

Тело/path/query отсутствуют; token только из cookie.

## Текущий транспорт

`DELETE /account/merge_confirmation`. Bodyless Rails resource mutation with CSRF and owner-bound confirmation.

ADR-003 заменяет исторический BFF/JSON transport этой операции.

Коды ошибок в нижележащем историческом анализе теперь являются доменными классификациями: браузеру Rails рендерит form errors/flash либо выполняет безопасный redirect; BFF envelope не возвращается.
## Правила валидации

Поиск привязан к владельцу. Изменение выполняется только при состоянии `PENDING`.

## Нормализация

Нет.

## Авторизация

Session + confirmation token.

## Идемпотентность

Нет: первый успех, повтор уже не PENDING и возвращает 409, если запись ещё находится.

## Основной сценарий

Перевести PENDING → FAILED, `lastErrorCode="USER_CANCELLED"`; очистить cookie; вернуть результат.

## Альтернативные сценарии

Нет.

## Ошибочные сценарии

`401`, `404` отсутствующего token/record, `409 CONFLICT` если уже PROCESSING/COMPLETED/FAILED, `403` origin, `500`. При ошибке обработчика cookie не очищается.

## Логический результат

`303 See Other` to `/link-account`; merge cookie is cleared after cancellation.
## Побочные эффекты

Только состояние confirmation и cookie; внешние/локальные owners не изменяются. Специального audit cancel операция не создаёт.

## Транзакционные требования

Conditional update-many обеспечивает compare-and-set PENDING.

## Наблюдаемость

Общий HTTP/BFF лог; отдельного продуктового audit нет.

## Источники

Доказательства находятся в `09-traceability/`.

## Статус уверенности

`требует повторной проверки после ADR-003`
