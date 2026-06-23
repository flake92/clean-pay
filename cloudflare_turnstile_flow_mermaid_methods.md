# Cloudflare Turnstile Flow с Mermaid и вызовами `метод / файл`

## Назначение

Cloudflare Turnstile используется как server-side проверка перед чувствительными действиями.

Интеграция состоит из двух частей:

```text
Frontend:
получает одноразовый turnstileToken от Cloudflare

Backend:
проверяет turnstileToken через Cloudflare siteverify API
```

---

## Основные env-переменные

```env
TURNSTILE_ENABLED="true"
NEXT_PUBLIC_TURNSTILE_SITE_KEY="..."
TURNSTILE_SECRET_KEY="..."
TURNSTILE_VERIFY_URL="https://challenges.cloudflare.com/turnstile/v0/siteverify"
```

Где читаются:

```text
getEnv()
src/lib/env.ts
```

---

# 1. Общий flow интеграции

```mermaid
flowchart TD
    U["Пользователь"] -->|"Открывает защищённую форму"| FE_PAGE["Frontend page / component"]

    FE_PAGE -->|"Рендерит компонент"| TW["TurnstileWidget()<br/>src/components/turnstile-widget.tsx"]

    TW -->|"loadTurnstileScript()"| SCRIPT["Cloudflare script<br/>https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]

    SCRIPT -->|"window.turnstile.render()"| WIDGET["Cloudflare Turnstile Widget"]

    U -->|"Проходит проверку"| WIDGET

    WIDGET -->|"callback(token)"| TOKEN["turnstileToken"]

    TOKEN -->|"onToken(token)"| FE_ACTION["Frontend action<br/>onSubmit() / onClick()"]

    FE_ACTION -->|"fetch() / redirect + token"| BE_ROUTE["Backend route<br/>POST(request) или GET(request)"]

    BE_ROUTE -->|"getTurnstileToken() / query param"| TOKEN_EXTRACT["Извлечение token<br/>src/lib/turnstile.ts"]

    BE_ROUTE -->|"getRequestIp(request)"| IP["IP пользователя<br/>cf-connecting-ip / x-real-ip / x-forwarded-for"]

    TOKEN_EXTRACT --> VERIFY["verifyTurnstileToken(token, remoteIp)<br/>src/lib/turnstile.ts"]
    IP --> VERIFY

    VERIFY -->|"fetch(env.turnstile.verifyUrl)"| CF_VERIFY["Cloudflare siteverify API<br/>POST /turnstile/v0/siteverify"]

    CF_VERIFY -->|"success=true"| OK["Backend выполняет основное действие"]
    CF_VERIFY -->|"success=false"| FAIL["Backend возвращает ошибку<br/>400 / 403"]
```

---

# 2. Frontend flow: загрузка Turnstile widget

```mermaid
flowchart TD
    A["Компонент формы<br/>src/components/auth-forms.tsx"] --> B["TurnstileWidget()<br/>src/components/turnstile-widget.tsx"]

    B --> C["hasPublicTurnstileKey()<br/>src/components/turnstile-widget.tsx"]
    C -->|"NEXT_PUBLIC_TURNSTILE_SITE_KEY есть"| D["loadTurnstileScript()<br/>src/components/turnstile-widget.tsx"]
    C -->|"NEXT_PUBLIC_TURNSTILE_SITE_KEY отсутствует"| E["Message: site key is not configured"]

    D --> F["document.createElement('script')"]
    F --> G["script.src = Cloudflare Turnstile API"]
    G --> H["document.head.appendChild(script)"]

    H --> I["window.turnstile.render(container, options)"]
    I --> J["callback(token)"]
    J --> K["onToken(token)"]
    K --> L["turnstileToken сохранён в state формы"]

    I --> M["expired-callback"]
    M --> N["onToken(null)"]

    I --> O["error-callback"]
    O --> P["onToken(null) + Message error"]
```

---

# 3. Backend flow: проверка token через Cloudflare

```mermaid
flowchart TD
    A["Backend route<br/>POST(request) / GET(request)"] --> B["getTurnstileToken(body)<br/>src/lib/turnstile.ts"]

    A --> C["getRequestIp(request)<br/>src/lib/turnstile.ts"]

    B --> D["verifyTurnstileToken(token, remoteIp)<br/>src/lib/turnstile.ts"]
    C --> D

    D --> E{"env.turnstile.enabled?"}

    E -->|"false"| SKIP["Проверка отключена<br/>return"]
    E -->|"true"| SECRET{"TURNSTILE_SECRET_KEY есть?"}

    SECRET -->|"нет"| ERR503["BffError<br/>UPSTREAM_UNAVAILABLE<br/>503"]
    SECRET -->|"да"| HAS_TOKEN{"token есть?"}

    HAS_TOKEN -->|"нет"| ERR400["BffError<br/>VALIDATION_ERROR<br/>400<br/>Turnstile token is required"]
    HAS_TOKEN -->|"да"| BODY["URLSearchParams<br/>secret + response + remoteip"]

    BODY --> FETCH["fetch(env.turnstile.verifyUrl)<br/>method: POST<br/>cache: no-store"]

    FETCH --> PARSE["response.json()"]

    PARSE --> RESULT{"response.ok && result.success?"}

    RESULT -->|"да"| ALLOW["Разрешить основную бизнес-логику"]
    RESULT -->|"нет"| ERR403["BffError<br/>FORBIDDEN<br/>403<br/>Turnstile verification failed"]
```

---

# 4. Sequence diagram с методами и файлами

```mermaid
sequenceDiagram
    participant U as Пользователь
    participant FORM as Frontend form<br/>src/components/auth-forms.tsx
    participant TW as TurnstileWidget<br/>src/components/turnstile-widget.tsx
    participant CFJS as Cloudflare JS API
    participant ROUTE as Backend route<br/>src/app/.../route.ts
    participant LIB as turnstile.ts<br/>src/lib/turnstile.ts
    participant CFAPI as Cloudflare siteverify API

    U->>FORM: Открывает форму
    FORM->>TW: <TurnstileWidget onToken=... />
    TW->>CFJS: loadTurnstileScript()
    CFJS-->>TW: script loaded
    TW->>CFJS: window.turnstile.render()
    U->>CFJS: Проходит проверку
    CFJS-->>TW: callback(token)
    TW-->>FORM: onToken(turnstileToken)

    U->>FORM: Отправляет форму
    FORM->>ROUTE: fetch() / redirect + turnstileToken
    ROUTE->>LIB: getTurnstileToken()
    ROUTE->>LIB: getRequestIp()
    ROUTE->>LIB: verifyTurnstileToken(token, remoteIp)
    LIB->>CFAPI: POST /siteverify<br/>secret + response + remoteip
    CFAPI-->>LIB: success=true / false

    alt success=true
        LIB-->>ROUTE: return
        ROUTE->>ROUTE: Выполнить основное действие
        ROUTE-->>FORM: success response
    else success=false
        LIB-->>ROUTE: throw BffError 403
        ROUTE-->>FORM: error response
    end
```

---

# 5. Карта вызовов `действие → метод → файл`

| Действие | Frontend метод / файл | HTTP-вызов | Backend метод / файл | Turnstile-вызовы |
|---|---|---|---|---|
| Логин | `LoginForm.onSubmit()`<br/>`src/components/auth-forms.tsx` | `POST /api/bff/auth/login` | `POST(request)`<br/>`src/app/api/bff/auth/login/route.ts` | `getTurnstileToken()`<br/>`getRequestIp()`<br/>`verifyTurnstileToken()`<br/>`src/lib/turnstile.ts` |
| Регистрация | `RegisterForm.onSubmit()`<br/>`src/components/auth-forms.tsx` | `POST /api/bff/auth/register` | `POST(request)`<br/>`src/app/api/bff/auth/register/route.ts` | `getTurnstileToken()`<br/>`getRequestIp()`<br/>`verifyTurnstileToken()`<br/>`src/lib/turnstile.ts` |
| Telegram login/link start | `TelegramLoginButton.onClick()`<br/>`src/components/auth-forms.tsx` | `GET /auth/telegram/start?turnstile_token=...` | `GET(request)`<br/>`src/app/auth/telegram/start/route.ts` | `getRequestIp()`<br/>`verifyTurnstileToken()`<br/>`src/lib/turnstile.ts` |
| Запрос e-mail кода | `VerifyEmailPanel.requestCode()`<br/>`src/components/verify-email-panel.tsx` | `POST /api/bff/auth/email/request-verification` | `POST(request)`<br/>`src/app/api/bff/auth/email/request-verification/route.ts` | `getTurnstileToken()`<br/>`getRequestIp()`<br/>`verifyTurnstileToken()`<br/>`src/lib/turnstile.ts` |
| Подтверждение e-mail кода | `VerifyEmailPanel.confirmCode()`<br/>`src/components/verify-email-panel.tsx` | `POST /api/bff/auth/email/confirm` | `POST(request)`<br/>`src/app/api/bff/auth/email/confirm/route.ts` | `getTurnstileToken()`<br/>`getRequestIp()`<br/>`verifyTurnstileToken()`<br/>`src/lib/turnstile.ts` |

---

# 6. Flow логина с методами и файлами

```mermaid
flowchart TD
    U["Пользователь"] --> A["LoginForm.onSubmit()<br/>src/components/auth-forms.tsx"]

    A --> B["Проверка turnstileToken в state"]
    B -->|"token отсутствует"| B_ERR["Показать ошибку:<br/>Пройдите проверку Cloudflare Turnstile"]

    B -->|"token есть"| C["fetch('/api/bff/auth/login')<br/>method: POST<br/>body: email + password + turnstileToken + cf-turnstile-response"]

    C --> D["POST(request)<br/>src/app/api/bff/auth/login/route.ts"]

    D --> E["getTurnstileToken(rawBody)<br/>src/lib/turnstile.ts"]
    D --> F["getRequestIp(request)<br/>src/lib/turnstile.ts"]

    E --> G["verifyTurnstileToken(token, remoteIp)<br/>src/lib/turnstile.ts"]
    F --> G

    G --> H["Cloudflare siteverify<br/>POST env.turnstile.verifyUrl"]

    H -->|"success=true"| I["assertRateLimit()<br/>auth_login"]
    I --> J["remnashopAuth('/auth/login', body)<br/>src/lib/remnashop/client.ts"]
    J --> K["createSessionFromRemnashopAuth()<br/>src/lib/remnashop/session.ts"]
    K --> L["bffJson(user, expiresAt)"]

    H -->|"success=false"| M["BffError FORBIDDEN 403"]
```

---

# 7. Flow регистрации с методами и файлами

```mermaid
flowchart TD
    U["Пользователь"] --> A["RegisterForm.onSubmit()<br/>src/components/auth-forms.tsx"]

    A --> B["Проверка turnstileToken в state"]
    B -->|"token отсутствует"| B_ERR["Показать ошибку:<br/>Пройдите проверку Cloudflare Turnstile"]

    B -->|"token есть"| C["fetch('/api/bff/auth/register')<br/>method: POST<br/>body: email + password + name + turnstileToken + cf-turnstile-response"]

    C --> D["POST(request)<br/>src/app/api/bff/auth/register/route.ts"]

    D --> E["getTurnstileToken(rawBody)<br/>src/lib/turnstile.ts"]
    D --> F["getRequestIp(request)<br/>src/lib/turnstile.ts"]

    E --> G["verifyTurnstileToken(token, remoteIp)<br/>src/lib/turnstile.ts"]
    F --> G

    G --> H["Cloudflare siteverify<br/>POST env.turnstile.verifyUrl"]

    H -->|"success=true"| I["assertRateLimit()<br/>auth_register"]
    I --> J["remnashopAuth('/auth/register', body)<br/>src/lib/remnashop/client.ts"]
    J --> K["createSessionFromRemnashopAuth()<br/>src/lib/remnashop/session.ts"]
    K --> L["bffJson(user, expiresAt)<br/>status: 201"]

    H -->|"success=false"| M["BffError FORBIDDEN 403"]
```

---

# 8. Flow Telegram login/link start с методами и файлами

```mermaid
flowchart TD
    U["Пользователь"] --> A["TelegramLoginButton.onClick()<br/>src/components/auth-forms.tsx"]

    A --> B["Проверка turnstileToken в state"]
    B -->|"token отсутствует"| B_ERR["Показать ошибку:<br/>Пройдите проверку Cloudflare Turnstile"]

    B -->|"token есть"| C["window.location.assign('/auth/telegram/start?...')<br/>query: redirect_to + turnstile_token + cf-turnstile-response"]

    C --> D["GET(request)<br/>src/app/auth/telegram/start/route.ts"]

    D --> E["url.searchParams.get('turnstile_token')<br/>или<br/>url.searchParams.get('cf-turnstile-response')"]

    D --> F["getRequestIp(request)<br/>src/lib/turnstile.ts"]

    E --> G["verifyTurnstileToken(token, remoteIp)<br/>src/lib/turnstile.ts"]
    F --> G

    G --> H["Cloudflare siteverify<br/>POST env.turnstile.verifyUrl"]

    H -->|"success=true"| I["getCurrentUser()<br/>src/lib/session.ts"]
    I --> J["assertRateLimit()<br/>telegram_login_start / telegram_link_start"]
    J --> K["createTelegramAuthorizationResponse()<br/>src/lib/telegram-oidc.ts"]
    K --> L["Redirect в Telegram OAuth"]

    H -->|"success=false"| M["loginFailedRedirect()<br/>/login?auth=telegram_failed"]
```

---

# 9. Flow запроса e-mail кода с методами и файлами

```mermaid
flowchart TD
    U["Пользователь"] --> A["VerifyEmailPanel.requestCode()<br/>src/components/verify-email-panel.tsx"]

    A --> B["fetch('/api/bff/auth/email/request-verification')<br/>method: POST<br/>body: email"]

    B --> C["POST(request)<br/>src/app/api/bff/auth/email/request-verification/route.ts"]

    C --> D["getTurnstileToken(rawBody)<br/>src/lib/turnstile.ts"]
    C --> E["getRequestIp(request)<br/>src/lib/turnstile.ts"]

    D --> F["verifyTurnstileToken(token, remoteIp)<br/>src/lib/turnstile.ts"]
    E --> F

    F --> G["Cloudflare siteverify<br/>POST env.turnstile.verifyUrl"]

    G -->|"success=true"| H["assertCooldown()<br/>email_verification_request"]
    H --> I["assertRateLimit()<br/>email_verification_request"]
    I --> J["remnashopRequest('/auth/email/request-verification')<br/>src/lib/remnashop/client.ts"]
    J --> K["bffJson(result)"]

    G -->|"success=false / token отсутствует"| L["BffError<br/>400 или 403"]

    A -. "Текущий риск" .-> RISK["Frontend сейчас НЕ передаёт turnstileToken<br/>в VerifyEmailPanel.requestCode()"]
```

---

# 10. Flow подтверждения e-mail кода с методами и файлами

```mermaid
flowchart TD
    U["Пользователь"] --> A["VerifyEmailPanel.confirmCode()<br/>src/components/verify-email-panel.tsx"]

    A --> B["fetch('/api/bff/auth/email/confirm')<br/>method: POST<br/>body: code"]

    B --> C["POST(request)<br/>src/app/api/bff/auth/email/confirm/route.ts"]

    C --> D["getTurnstileToken(rawBody)<br/>src/lib/turnstile.ts"]
    C --> E["getRequestIp(request)<br/>src/lib/turnstile.ts"]

    D --> F["verifyTurnstileToken(token, remoteIp)<br/>src/lib/turnstile.ts"]
    E --> F

    F --> G["Cloudflare siteverify<br/>POST env.turnstile.verifyUrl"]

    G -->|"success=true"| H["assertRateLimit()<br/>email_verification_confirm"]
    H --> I["remnashopRequest('/auth/email/confirm')<br/>src/lib/remnashop/client.ts"]
    I --> J["prisma.webUser.update()<br/>src/lib/prisma.ts"]
    J --> K["bffJson(result)"]

    G -->|"success=false / token отсутствует"| L["BffError<br/>400 или 403"]

    A -. "Текущий риск" .-> RISK["Frontend сейчас НЕ передаёт turnstileToken<br/>в VerifyEmailPanel.confirmCode()"]
```

---

# 11. Внутренние функции Turnstile

## `getTurnstileToken()`

```text
Файл:
src/lib/turnstile.ts

Метод:
getTurnstileToken(body)

Назначение:
достаёт token из body.
```

Поддерживаемые поля:

```text
turnstileToken
cf-turnstile-response
```

---

## `getRequestIp()`

```text
Файл:
src/lib/turnstile.ts

Метод:
getRequestIp(request)

Назначение:
определяет IP пользователя для передачи в Cloudflare siteverify.
```

Порядок чтения заголовков:

```text
1. cf-connecting-ip
2. x-real-ip
3. x-forwarded-for
```

---

## `verifyTurnstileToken()`

```text
Файл:
src/lib/turnstile.ts

Метод:
verifyTurnstileToken(token, remoteIp)
```

Что делает:

```text
1. Читает env через getEnv()
2. Если TURNSTILE_ENABLED=false — пропускает проверку
3. Проверяет наличие TURNSTILE_SECRET_KEY
4. Проверяет наличие token
5. Формирует URLSearchParams:
   - secret
   - response
   - remoteip
6. Делает fetch(env.turnstile.verifyUrl)
7. Проверяет response.ok и result.success
8. При ошибке выбрасывает BffError
```

---

# 12. Cloudflare API вызов

```mermaid
flowchart LR
    VERIFY["verifyTurnstileToken()<br/>src/lib/turnstile.ts"] --> REQ["POST env.turnstile.verifyUrl"]

    REQ --> BODY["Body:<br/>secret=TURNSTILE_SECRET_KEY<br/>response=turnstileToken<br/>remoteip=user_ip"]

    BODY --> CF["Cloudflare Turnstile<br/>/siteverify"]

    CF -->|"success: true"| PASS["return"]
    CF -->|"success: false"| BLOCK["throw BffError FORBIDDEN 403"]
```

Фактический endpoint по умолчанию:

```text
https://challenges.cloudflare.com/turnstile/v0/siteverify
```

---

# 13. Текущие проблемы / замечания по реализации

## 13.1. E-mail verification backend защищён Turnstile, но frontend не отправляет token

Backend routes требуют Turnstile:

```text
src/app/api/bff/auth/email/request-verification/route.ts
src/app/api/bff/auth/email/confirm/route.ts
```

В них вызывается:

```text
getTurnstileToken()
verifyTurnstileToken()
```

Но frontend-компонент:

```text
src/components/verify-email-panel.tsx
```

сейчас отправляет только:

```json
{
  "email": "user@example.com"
}
```

и:

```json
{
  "code": "000000"
}
```

Без:

```text
turnstileToken
cf-turnstile-response
```

### Последствие

Если:

```env
TURNSTILE_ENABLED="true"
```

то запросы:

```text
POST /api/bff/auth/email/request-verification
POST /api/bff/auth/email/confirm
```

могут возвращать ошибку:

```text
400 Turnstile token is required
```

### Что нужно доработать

В `src/components/verify-email-panel.tsx` нужно добавить:

```text
TurnstileWidget
turnstileToken state
передачу turnstileToken в requestCode()
передачу turnstileToken в confirmCode()
reset widget при ошибке
```

---

## 13.2. Покупка и продление подписки сейчас не защищены Turnstile

В текущем коде Turnstile не вызывается в:

```text
src/app/api/bff/subscription/purchase/route.ts
src/app/api/bff/subscription/extend/route.ts
```

Там нет вызовов:

```text
getTurnstileToken()
verifyTurnstileToken()
```

Если требуется защищать покупку и продление подписки через Cloudflare Turnstile, нужно отдельно добавить token на frontend и проверку на backend.

---

# 14. Итоговая схема покрытия

| Функция | Frontend token есть | Backend проверка есть | Статус |
|---|---:|---:|---|
| Логин | Да | Да | Рабочая интеграция |
| Регистрация | Да | Да | Рабочая интеграция |
| Telegram login/link start | Да | Да | Рабочая интеграция |
| Запрос e-mail кода | Нет | Да | Требует доработки frontend |
| Подтверждение e-mail кода | Нет | Да | Требует доработки frontend |
| Покупка подписки | Нет | Нет | Turnstile не подключён |
| Продление подписки | Нет | Нет | Turnstile не подключён |

---

# 15. Краткий итог

```text
TurnstileWidget
src/components/turnstile-widget.tsx
   ↓
получает token от Cloudflare
   ↓
Frontend forms
src/components/auth-forms.tsx
   ↓
передают token в BFF routes
   ↓
BFF routes
src/app/.../route.ts
   ↓
verifyTurnstileToken()
src/lib/turnstile.ts
   ↓
Cloudflare siteverify API
   ↓
success=true → выполнить действие
success=false → отклонить запрос
```
