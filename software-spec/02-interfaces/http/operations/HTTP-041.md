# Начать Telegram OIDC или popup-вход

## Идентификатор

`HTTP-041`

## Назначение

Создать одноразовую Telegram authentication ceremony для входа либо привязки к текущему пользователю.

## Владелец

Модуль доступа и идентичности.

## Акторы

Гость или вошедший пользователь.

## Предусловия

Для гостя source guard не требуется; при наличии session cookies требуется trusted source. Turnstile policy применяется в handler.

## Логический входной контракт

Query: `redirect_to?`, `turnstile_token?`, `cf-turnstile-response?`, `mode?`. Только точное `mode=popup` выбирает JSON; прочие значения — redirect. Redirect допускает только root-relative same-origin URL, не `//`, без credentials и не `/login`, `/register`, `/auth/*`.

## Текущий транспорт

Публичный `GET /auth/telegram/start`.

## Правила валидации

Проверяется Turnstile token/IP. Для текущего user действует `telegram_link_start` 10/900 секунд по e-mail/Telegram. Создаются random state, nonce, 64-byte verifier и SHA-256 PKCE challenge; server record хранит только hashes, user/redirect, expiry 600 секунд.

## Нормализация

OIDC query строго: `response_type=code`, configured client/redirect, `scope=openid profile`, state, nonce, S256 challenge. Unsafe redirect становится отсутствующим.

## Авторизация

Гостевой login публичен; link ceremony привязана к текущему user ID.

## Идемпотентность

Каждый вызов создаёт новую независимую state record и заменяет три временные cookie.

## Основной сценарий

Обычный режим возвращает 307 на TG-001; popup — 200 `{clientId,nonce,redirectUri}`. Оба устанавливают HttpOnly `clean_pay_tg_state`, `clean_pay_tg_nonce`, `clean_pay_tg_code_verifier`, Path `/`, max-age 600, configured Secure/SameSite.

## Альтернативные сценарии

Пустой/unsafe redirect приводит после callback к `/cabinet`.

## Ошибочные сценарии

Любая ошибка, включая Turnstile/rate/БД/config, скрывается как `307` на абсолютный `${publicAppUrl}/login?auth=telegram_failed`; JSON error не возвращается.

## Логический результат

307 OIDC redirect либо 200 popup JSON; оба с тремя cookies.

## Побочные эффекты

Одноразовая DB state, cookies, Turnstile call/rate counter и technical log.

## Транзакционные требования

State должна быть durable до отдачи cookies/redirect; при сбое формирования ответа запись может остаться недостижимой до expiry.

## Наблюдаемость

Логируются наличие параметров и link user, но не state/nonce/verifier/token.

## Источники

Доказательства находятся в `09-traceability/`; точный внешний интерфейс TG-001.

## Статус уверенности

`подтверждено`
