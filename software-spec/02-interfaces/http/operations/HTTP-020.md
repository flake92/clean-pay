# Связать Remnashop-аккаунт по e-mail и паролю

## Идентификатор

`HTTP-020`

## Назначение

Добавить e-mail-идентичность к текущему локальному/Telegram-пользователю, не меняя владельца без доказательств и безопасного merge.

## Владелец

Модуль доступа и идентичности.

## Акторы

Вошедший пользователь.

## Предусловия

Полная разрешённая сессия.

## Логический входной контракт

`email:string` и `password:string` по LoginRequest; дополнительные поля передаются внешней схеме и игнорируются. Turnstile-полей и отдельного антибот-вызова нет.

## Текущий транспорт

`POST /account/remnashop_link`. Rails form scope `remnashop_link[email,password]`; CSRF; password is transient and external.

ADR-003 заменяет исторический BFF/JSON transport этой операции.

Коды ошибок в нижележащем историческом анализе теперь являются доменными классификациями: браузеру Rails рендерит form errors/flash либо выполняет безопасный redirect; BFF envelope не возвращается.
## Правила валидации

Лимит `remnashop_link` 10/900 секунд по e-mail. Сначала RS-002. Только `401 AUTH_FAILED` запускает fallback RS-001. Если fallback отвечает именно email-already-exists conflict, возвращается исходная auth failure.

После внешней auth локальная session/owner snapshot повторно сравнивается по ID, user, Remnashop ID, e-mail/verified, Telegram ID/username; изменение во время запроса → 401.

## Нормализация

Wire normalization e-mail выполняет Remnashop; локальный lookup использует `body.email` как получен, что может отличаться от нормализованного внешнего profile.

## Авторизация

Текущая полная сессия плюс пароль внешней e-mail-учётной записи. Для merge с Telegram дополнительно выполняется Telegram HMAC-auth.

## Идемпотентность

Нет; повтор снова проверяет пароль, может обновлять tokens/ссылку и запрашивать письмо.

## Основной сценарий

- Verified login: под payment fence проверить/привязать Telegram, при конфликте выполнить безопасный merge; связать local user; audit; вернуть `linked:true`.
- Новый/неподтверждённый e-mail: сохранить внешние tokens; если локальный e-mail свободен/тот же owner, stage его как unverified/authPending и обновить cookie; запросить письмо; вернуть pending.

## Альтернативные сценарии

Если request-verification отвечает email-already-verified conflict и источник был login, выполняется verified linking. Если источник register, возвращается `EMAIL_LINK_REQUIRES_VERIFICATION` 409.

## Ошибочные сценарии

`400`, `401 AUTH_FAILED/UNAUTHORIZED`, `403`, `409 EMAIL_LINK_REQUIRES_VERIFICATION`, `ACCOUNT_MERGE_REQUIRED`, subscription/payment conflicts `429`, `502`, `500`.

Частичный успех: tokens и возможно unverified local e-mail сохраняются до отправки письма. Ошибка письма/audit может вернуть ошибку после уже изменённого локального состояния; компенсации нет.

## Логический результат

`303 See Other` to `/link-account` when linked or `/verify-email` when verification is pending.
## Побочные эффекты

Внешний login/register/verification/merge, локальные tokens/user/merge, payment-owner fence, cookie, rate-limit, audit.

## Транзакционные требования

Сохранение tokens и staging e-mail — одна локальная транзакция. Полный merge использует отдельные fenced транзакции; внешние операции не атомарны с ними.

## Наблюдаемость

Audit различает verified linked, verified blocked, request pending; пароль/tokens не пишутся.

## Источники

Доказательства находятся в `09-traceability/`.

## Статус уверенности

`требует повторной проверки после ADR-003`
