# Завершить Telegram OIDC callback

## Идентификатор

`HTTP-042`

## Назначение

Принять authorization code, доказать Telegram-идентичность, безопасно связать/объединить пользователя и создать web session.

## Владелец

Модуль доступа и идентичности.

## Акторы

Браузер после Telegram OIDC.

## Предусловия

Query и три временные cookie относятся к непросроченной непоглощённой state record.

## Логический входной контракт

Обязательные query `code` и `state`; provider может добавить `error,error_description`, они используются только в metadata. Cookie state/nonce/verifier обязательны.

## Текущий транспорт

`GET /account/telegram_authorization/callback`; OIDC query callback с одноразовым локальным state и проверкой provider token.

## Правила валидации

Точное равенство state cookie/query и трёх hashes; expiry/consumed; TG-002 token exchange с exact verifier/redirect; TG-003 signature, issuer, audience, nonce, exp и положительный Telegram ID. State claim выполняется атомарно до локального reconcile.

## Нормализация

Telegram ID → decimal string; username из `preferred_username`; full name/name parts/avatar по TG-003. Redirect только ранее сохранённый safe path, иначе `/cabinet`.

## Авторизация

OIDC proof; если state содержит user ID — это link flow с payment-owner fence. В противном случае login/reconcile flow. Remnashop Telegram auth/merge выполняются по правилам идентичности.

## Идемпотентность

State одноразовая. Повтор после claim не повторяет linking: специальный recovery redirect зависит от наличия текущей сессии.

## Основной сценарий

Обменять code, проверить JWT, claim state, получить/согласовать Remnashop identity, связать/merge локальных users под fence, создать session/cookies, удалить временные cookies и 307 redirect на next path.

## Альтернативные сценарии

Требуется подтверждение замены e-mail — 307 `/link-account?auth=telegram_email_replace` и HttpOnly merge cookie. Уже consumed + session — `/link-account?auth=telegram_processing`; без session — login failure. Конфликт обеих подписок/merge-required ведёт вошедшего на link-account с reason.

## Ошибочные сценарии

Нет code/state или любая ошибка гостя — 307 `/login?auth=telegram_failed`. Для существующей сессии failure — 307 на `/link-account?auth=telegram_merge_subscriptions|telegram_merge_required|telegram_failed`. Ошибки наружу JSON не раскрываются. Возможны partial-success окна после state claim или upstream merge; они покрыты recovery/merge state.

## Логический результат

`303 See Other` на безопасную server-rendered Rails страницу; provider errors ведут на `/login` или `/link-account` с flash.

## Побочные эффекты

TG-002/TG-003, state claim, Remnashop auth/link/merge, local merge/user/tokens/session, cookies, fences и audit/logs.

## Транзакционные требования

State claim атомарен; owner-changing local work fenced/transactional; внешние merge/auth не атомарны с локальной БД и требуют recovery semantics.

## Наблюдаемость

Metadata содержит host/forwarded header presence/referer/provider error and booleans, но не code/state/token/cookie secrets.

## Источники

Доказательства находятся в `09-traceability/`; TG-001—TG-005 и merge contracts.

## Статус уверенности

`требует повторной проверки после ADR-003`
