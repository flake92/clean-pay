# Активировать промокод

## Идентификатор

`HTTP-027`

## Назначение

Применить внешнее вознаграждение к текущей подписке/аккаунту.

## Владелец

Модуль подписки.

## Акторы

Вошедший пользователь.

## Предусловия

Полная разрешённая сессия и Remnashop-связь.

## Логический входной контракт

Rails form scope `promocode` с полем `code:string`. Дополнительные поля отбрасываются strong parameters.

## Текущий транспорт

`POST /subscription/promocode`; Rails form scope `promocode[code]`, CSRF и полная сессия.

## Правила валидации

Наличие scope и поля проверяет Rails `params.expect`; продуктовые правила значения задаёт RS-018.

## Нормализация

Во внешний RS-018 передаётся только значение `code` без локального изменения регистра.

## Авторизация

Локальная сессия и access token Remnashop.

## Идемпотентность

Локального ключа нет; повторное применение регулирует Remnashop.

## Основной сценарий

Attempted audit, RS-018, succeeded audit и redirect на актуальный subscription resource.

## Альтернативные сценарии

`success:false` принимается как 200, если внешний контракт его возвращает.

## Ошибочные сценарии

`400 VALIDATION_ERROR`; `404 PROMOCODE_NOT_FOUND`; `409 PROMOCODE_ALREADY_ACTIVATED|EXPIRED|ACTIVE_SUBSCRIPTION_REQUIRED|RESOURCE_UNLIMITED|NOT_AVAILABLE`; `401/403/413/415/429/502/500`. Audit имеет те же partial-success окна, что HTTP-026.

## Логический результат

`303 See Other` на `/subscription` с flash-результатом и обновлённым серверным состоянием.

## Побочные эффекты

Внешнее вознаграждение и `promocode_activation_attempted|succeeded|failed`.

## Транзакционные требования

Внешняя мутация и audit не атомарны.

## Наблюдаемость

Код промокода не должен попадать в технические журналы; audit содержит только action/user/error class.

## Источники

Доказательства находятся в `09-traceability/`; RS-018.

## Статус уверенности

`требует повторной проверки после ADR-003`
