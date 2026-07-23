# Получить ожидающее подтверждение Telegram-merge

## Идентификатор

`HTTP-017`

## Назначение

Показать пользователю точное ожидающее объединение внешнего Telegram-владельца с текущим подтверждённым e-mail-владельцем.

## Владелец

Модуль доступа и идентичности.

## Акторы

Вошедший пользователь на экране связывания аккаунта.

## Предусловия

Сессия и HttpOnly cookie `clean_pay_account_merge` с непрозрачным token. Token при постановке живёт 600 секунд; в БД хранится SHA-256.

## Логический входной контракт

Полей тела/path/query нет. Cookie merge обязательна; её token должен принадлежать текущему user.

## Текущий транспорт

`GET /account/merge_confirmation`. Bodyless Rails HTML resource read; session plus owner-bound confirmation cookie.

ADR-003 заменяет исторический BFF/JSON transport этой операции.

Коды ошибок в нижележащем историческом анализе теперь являются доменными классификациями: браузеру Rails рендерит form errors/flash либо выполняет безопасный redirect; BFF envelope не возвращается.
## Правила валидации

По хэшу token и user ID ищется confirmation. `expiresAt<=now` либо status `FAILED` трактуются как 404. `PENDING`, `PROCESSING` и `COMPLETED` могут быть прочитаны, пока не истекли.

## Нормализация

Source e-mail маскируется: сохраняются первые максимум 2 символа local part, затем минимум 3 `*`, домен остаётся. `emailWillBeReplaced` сравнивает trim/lower-case source и target.

## Авторизация

Сессия + owner-bound token; знание чужого token без сессии владельца недостаточно.

## Идемпотентность

Да как чтение, кроме refresh rotation.

## Основной сценарий

Восстановить session → найти confirmation → проверить срок/status → вернуть безопасную проекцию.

## Альтернативные сценарии

`sourceEmailMasked` может быть `null`; `emailWillBeReplaced=false`, если source отсутствует или совпадает с target.

## Ошибочные сценарии

`401 UNAUTHORIZED`; `404 NOT_FOUND` при отсутствии cookie/записи/истечении/FAILED; `500` storage. Cookie при GET-ошибке автоматически не очищается.

## Логический результат

`200 text/html`; Rails renders only the masked merge evidence.
## Побочные эффекты

Только возможная refresh rotation и журналы.

## Транзакционные требования

Обычное чтение.

## Наблюдаемость

Токен и полный source e-mail не выводятся.

## Источники

Доказательства находятся в `09-traceability/`.

## Статус уверенности

`требует повторной проверки после ADR-003`
