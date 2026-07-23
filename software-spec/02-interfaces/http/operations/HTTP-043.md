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

Rails form принимает либо `id_token:string`, либо подписанные поля Telegram Login Widget: `id,first_name,last_name?,username?,photo_url?,auth_date,hash`. При наличии обоих доказательств приоритет имеет непустой `id_token`.

## Текущий транспорт

`POST /account/telegram_authorization/callback`; Rails form callback для подписанного Telegram Login Widget payload, с CSRF/origin policy и одноразовым state.

## Правила валидации

ID token — TG-003 и nonce. Widget — TG-004: bot token configured, hash/id/auth_date, возраст не более 24 часов, HMAC exact; затем state claim. `authData` действительно является рабочим совместимым интерфейсом, а не игнорируемым полем.

## Нормализация

Widget default `first_name="Telegram"`; ID/string conversions и профиль по TG-003/004. Redirect берётся только из сохранённой safe state.

## Авторизация

Telegram cryptographic proof и optional link-user binding state; далее те же owner/merge правила, что HTTP-042.

## Идемпотентность

State одноразовая. Повтор при существующей session получает безопасный processing redirect; прочий повтор — 400.

## Основной сценарий

Проверить одно из двух доказательств, claim state, reconcile/merge/link, создать session и выполнить Rails redirect на сохранённый safe path.

## Альтернативные сценарии

Требуется подтверждение замены e-mail — redirect на `/link-account` плюс merge cookie, без создания новой session на этой ветви. Уже поглощённый state при существующей сессии ведёт на страницу processing.

## Ошибочные сценарии

Нет обоих доказательств или обычная ошибка проверки — redirect на безопасную страницу входа с нейтральным flash `telegram_failed`. Неподходящий media type и лишние поля обрабатываются штатным Rails form parsing/strong parameters.

## Логический результат

`303 See Other` на безопасную server-rendered Rails страницу; BFF JSON envelope отсутствует.

## Побочные эффекты

State claim, Remnashop auth/link/merge, local merge/session/cookies/audit как HTTP-042.

## Транзакционные требования

Как HTTP-042; нельзя повторять внешнюю owner mutation после claim без recovery state.

## Наблюдаемость

Не журналировать idToken/authData/hash; только outcome/user ID/redirect class.

## Источники

Доказательства находятся в `09-traceability/`; TG-003—TG-005.

## Статус уверенности

`требует повторной проверки после ADR-003`
