# Почтовый контур: Remnashop, SMTP, Mailpit и пользователь

## Граница и направление

Почта состоит из нескольких интерфейсов, которые нельзя объединять:

```text
Clean Pay
  └─ HTTP POST ─► Remnashop email API
                    └─ SMTP ─► SMTP-провайдер ─► почтовый ящик пользователя

Clean Pay ── HTTP GET readiness ─► Mailpit API          (только при настройке)
Mailpit ── HTTP webhook ─► smtp-log ── HTTP GET ─► Mailpit API  (dev/test)
```

## MAIL-001: запрос кода через Remnashop

Clean Pay вызывает `POST /api/v1/public/auth/email/request-verification` с upstream access-cookie и JSON `{email?: string}`. Успех: `{success:boolean,target_email:string,expires_at:RFC3339}`. Именно эта операция инициирует формирование и отправку письма Remnashop.

Remnashop применяет следующие правила:

- почтовая доставка должна быть включена и полностью настроена;
- целевой адрес — `pending_email`, иначе текущий `email`;
- код состоит ровно из 6 цифр;
- срок действия настраивается, текущее dev/production-шаблонное значение — 15 минут;
- повторная отправка запрещена в течение 60 секунд;
- письмо сначала успешно передаётся SMTP, и только затем хэш кода и срок сохраняются;
- при ошибке SMTP состояние кода и cooldown не фиксируются.

Clean Pay повторяет вызов не более трёх раз только если внешняя ошибка распознана как временная ошибка отправки verification email. Задержка перед второй попыткой 300 мс, перед третьей 600 мс. Иные ошибки не повторяются.

## MAIL-002: подтверждение кода через Remnashop

`POST /api/v1/public/auth/email/confirm`, upstream access-cookie, JSON с обязательным `code` — ровно 6 цифр. Зафиксированная upstream-схема игнорирует дополнительное поле `email`, если Clean Pay его передал. Успех: `{success:true,email:string}`.

Возможные upstream-ветки: код не запрашивался; код истёк; код неверен; адрес уже занят; успешное подтверждение. При успехе одноразовый код и срок удаляются, `pending_email` переносится в `email`, признак подтверждения становится истинным.

## MAIL-003: смена адреса через Remnashop

`POST /api/v1/public/auth/email/change`, upstream access-cookie, JSON `{email}`. Адрес trim/lower-case, максимум 255, базовый e-mail pattern. Успех: `{success:true,pending_email:string}`. После этого Clean Pay отдельно выполняет MAIL-001 для нового адреса.

## SMTP-001: Remnashop → SMTP-провайдер

### Настройка

| Параметр | Тип | Default | Назначение |
|---|---|---|---|
| `EMAIL_ENABLED` | boolean | `false` | включает отправку |
| `EMAIL_HOST` | string | пусто | SMTP host |
| `EMAIL_PORT` | integer | `587` | SMTP port |
| `EMAIL_USE_TLS` | boolean | `true` | STARTTLS после EHLO |
| `EMAIL_USE_SSL` | boolean | `false` | SMTP-over-SSL с момента соединения |
| `EMAIL_USERNAME` | secret string | пусто | LOGIN user |
| `EMAIL_PASSWORD` | secret string | пусто | LOGIN password |
| `EMAIL_FROM_EMAIL` | string | пусто | envelope/header sender |
| `EMAIL_FROM_NAME` | string | пусто | отображаемое имя sender |
| `EMAIL_VERIFICATION_CODE_TTL_MINUTES` | integer | `15` | срок кода |

Доставка считается включённой только если одновременно заданы enabled, host, from address, username и password.

### SMTP-сеанс

- общий timeout соединения/операций — 20 секунд;
- при `USE_SSL=true`: соединение `SMTP_SSL`, затем LOGIN и `send_message`;
- иначе: обычный SMTP, `EHLO`; при `USE_TLS=true` — `STARTTLS`, повторный `EHLO`; затем LOGIN и `send_message`;
- автоматического SMTP retry внутри Remnashop нет;
- любое исключение превращается в ошибку доставки, которую email API возвращает как `502`.

### Сообщение подтверждения

| Header/часть | Значение |
|---|---|
| `From` | `From Name <from@example>` либо только address |
| `To` | целевой e-mail пользователя |
| `Subject` | `Your verification code` |
| Content | text/plain |
| Body | `Your verification code is: {6 digits}` + пустая строка + сообщение о сроке `{minutes}` и игнорировании незапрошенного письма |

## MP-001: Clean Pay → Mailpit readiness

Операция существует только если настроен URL Mailpit readiness.

```http
GET {MAILPIT_BASE}/api/v1/messages
```

Авторизация и тело отсутствуют; режим без кэша; таймаут отдельной проверки 5 секунд и общий deadline readiness 8 секунд. Содержимое ответа не используется: любой 2xx означает `ok`, иной статус/timeout/network error означает `down`. В production URL обычно пуст, поэтому проверка отсутствует, а не считается успешной.

## Тестовая среда Mailpit

Контейнер `smtp` принимает SMTP на 1025 и публикует HTTP UI/API на 8025. Он разрешает любые SMTP credentials и небезопасную авторизацию, что допустимо только для изолированной dev/test-среды. Remnashop использует `EMAIL_HOST=smtp`, `EMAIL_PORT=1025`, без TLS/SSL.

Проверенный образ тестового контура закрепляется как `axllent/mailpit@sha256:37a38e48e9338cd7e89dfeb487f37b02ebfcd9cb23111bed2d345e79d37d6dd6`. Плавающий `latest` не является воспроизводимым контрактом.

## MP-002 и MP-003: журнал тестовых писем

Mailpit отправляет HTTP webhook на `smtp-log:8126/`. `smtp-log` принимает только POST; JSON может быть одним summary либо массивом. На каждый элемент он извлекает `ID`/`Id`/`id`, затем выполняет:

```http
GET http://smtp:8025/api/v1/message/{url-encoded-id}
```

При успехе логируются ID, From, To, Subject и первое доступное текстовое/HTML-тело. Тело ограничивается 12000 символами с явной отметкой усечения. Webhook получает `204` при успехе, `405` для не-POST, `500` при невалидном JSON или необработанной ошибке. Это тестовая наблюдаемость, а не продуктовая отправка.

## Критические условия совместимости

- Новая реализация Clean Pay не должна пытаться самостоятельно отправлять письмо, пока архитектурным решением не изменена граница владения: текущий контракт делегирует это Remnashop.
- Ошибка после успешного подтверждения кода не должна предлагать повторно использовать уже потреблённый код; локальная синхронизация помечается ожидающей.
- Mailpit и `smtp-log` — тестовая инфраструктура, а не production-зависимость.
