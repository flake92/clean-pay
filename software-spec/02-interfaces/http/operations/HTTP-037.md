# Запустить подробную проверку готовности

## Идентификатор

`HTTP-037`

## Назначение

Проверить обязательные и настроенные зависимости, сохранить агрегированный snapshot и дать оператору детали.

## Владелец

Платформенный модуль.

## Акторы

Внутренний оркестратор/оператор.

## Предусловия

Настроен внутренний secret.

## Логический входной контракт

Заголовок `x-clean-pay-readiness-secret`; тело/query не используются.

## Текущий транспорт

Внутренний dynamic `GET /api/internal/health/readiness`, минует пользовательскую session policy.

## Правила валидации

SHA-256 supplied/expected сравниваются constant-time. Параллельно и с общим deadline 8 секунд проверяются PostgreSQL `SELECT 1`, Redis `PING`, Remnashop public plans, Telegram JWKS; Mailpit и Remnawave только если настроены. Каждый check timeout 5 секунд.

## Нормализация

Check: `{status:"ok"|"down",latencyMs:number,message?:string}`. Aggregate ok только если все включённые checks ok. Одновременные вызовы одного процесса разделяют один running promise.

## Авторизация

Неверный/отсутствующий secret неразличимо возвращает 404.

## Идемпотентность

Повтор запускает новый цикл после завершения предыдущего; snapshot overwrite безопасен.

## Основной сценарий

Выполнить checks, сохранить `{status,checkedAt}` в memory и Redis с TTL 120 секунд, вернуть подробности.

## Альтернативные сценарии

Mailpit/Remnawave отсутствуют в `checks`, если их readiness URL не настроен. Ошибка записи snapshot в Redis меняет redis check и aggregate на degraded.

## Ошибочные сценарии

Неверный secret: `404 {"error":{"code":"NOT_FOUND","message":"Not found"}}`. Check failures: управляемый 503 с деталями. Неожиданное исключение: `503 {"status":"degraded","service":"clean-pay","checkedAt":null}`.

## Логический результат

`200|503 {status,checkedAt,checks,service:"clean-pay",version}`; `cache-control:no-store` для авторизованного результата.

## Побочные эффекты

Сетевые probes, memory snapshot, Redis SET TTL.

## Транзакционные требования

Нет общей транзакции; snapshot публикуется после сбора всех checks.

## Наблюдаемость

Endpoint внутренний, потому что messages раскрывают topology/status; secret никогда не логируется.

## Источники

Доказательства находятся в `09-traceability/`; точные probes — раздел 07 и интеграции 04.

## Статус уверенности

`подтверждено`
