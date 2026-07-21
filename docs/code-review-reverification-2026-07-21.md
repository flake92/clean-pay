# Повторная верификация code review Clean Pay

Дата проверки: 2026-07-21
Репозиторий: `C:\code\clean-pay`
Ветка: `new-dev`
Базовый commit проверки: `522c5736da83cbbee3e45997c4b108ab29c31fa0`
Commit реализации и тестового runtime: `b2832f4e1f95612af4369ab2b72c8da11824d77b`
Node.js: `24.18.0`
Prisma / Prisma Client: `7.8.0`

> Разделы с «Итоговой переоценки» по исторический план исправления описывают
> состояние базового commit `522c573...`, а не оставшиеся дефекты после
> реализации, если прямо не помечено обратное. Абсолютные локальные ссылки и
> номера строк в этих разделах относятся к checkout baseline; после исправлений
> строки сдвинулись, а часть исходного кода удалена. Актуальный статус, новые
> проверки и фактический rollout зафиксированы в разделе «Выполнение отчёта».

## Цель и методика

Документ повторно проверяет все 20 пунктов первоначального ревью. Для каждого
пункта зафиксированы:

1. итоговый вердикт;
2. точная цепочка выполнения;
3. воспроизводимое доказательство или безопасный план воспроизведения;
4. контраргументы и ограничения применимости;
5. пересмотренный приоритет.

Обозначения доказательств:

- **EXEC** — выполнено локальное динамическое воспроизведение;
- **CODE** — дефект детерминированно следует из текущей цепочки кода;
- **TEST** — вывод дополнительно подтверждается существующими или целевыми тестами;
- **DOC** — поведение сверено с первичным внешним источником;
- **SAFE-NOT-RUN** — разрушающий или создающий внешнее состояние PoC намеренно не
  запускался против живого Remnashop, Redis или платёжного провайдера.

## Итоговая переоценка

Эта таблица классифицирует 20 исходных тезисов на baseline. Она не означает,
что после выполнения отчёта в коде осталось 20 дефектов.

| № | Исходный тезис | Повторный вердикт | Итоговый приоритет |
|---:|---|---|---|
| 1 | Смешение `payment_id` и `operation_id` даёт ложный успех | **VERIFIED**, сценарий уточнён | **P2** |
| 2 | Relink может завершиться перед внешним payment POST | **VERIFIED**, последствия зависят от upstream | **P2**, условно P1 |
| 3 | Owner-only relink пропускает payment fencing | **PARTIAL**: дефект есть, прежние последствия завышены | **P2** |
| 4 | Смена e-mail сама возвращает `emailVerified=true` | **RETRACTED как сформулировано**; остаётся stale JWT | **P2 для остаточного дефекта** |
| 5 | 21 запрос глобально блокирует passkey login | **VERIFIED** | **P1/P2** |
| 6 | CSP ломает Telegram Mini App | **PARTIAL**: `script-src` доказан, универсальный тезис про iframe — нет | **P2** |
| 7 | Foreground payment response не валидируется | **VERIFIED**, XSS требует ошибочного/скомпрометированного upstream | **P2** |
| 8 | Dummy refresh вызывает upstream registration до auth | **VERIFIED** | **P2** |
| 9 | Refresh-only запрос обходит e-mail gate | **VERIFIED** | **P2** |
| 10 | Старый revoked JWT отзывает новые сессии | **VERIFIED** | **P2** |
| 11 | Ambient shell env подменяет `deploy.sh` | **VERIFIED / EXEC** | **P2** |
| 12 | Quoted reconciliation boolean не запускает worker | **VERIFIED** | **P2** |
| 13 | Две миграции неатомарны | **VERIFIED / EXEC на Prisma 7.8** | **P2** |
| 14 | Transport error оставляет формы loading | **VERIFIED** | **P2** |
| 15 | Readiness timeout не отменяет DB query | **VERIFIED**, pool exhaustion требует black-hole failure | **P2** |
| 16 | Status возвращает snapshot до reconciliation | **VERIFIED** | **P3** |
| 17 | Ошибка `auditLog` превращает success в 202 | **RETRACTED** | удалить |
| 18 | `/cabinet` инициирует 11 BFF GET | **VERIFIED** | **P3** |
| 19 | `pnpm-lock.yaml` устарел | **VERIFIED**, официальный pipeline использует npm | **P3 / tooling** |
| 20 | Devcontainer гарантированно unhealthy | **RETRACTED как дефект** | только ergonomics note |

Итого: 15 пунктов подтверждены, 3 подтверждены частично или в более узкой
формулировке, 2 пункта отозваны как дефекты.

---

## 1. Несвязанные payment/operation IDs дают ложный terminal success

**Вердикт: VERIFIED. Приоритет: P2. Доказательства: CODE, EXEC.**

### Цепочка

- Ответ `202` записывает только `cleanPayLastPaymentOperationId`:
  [payment-confirmation.tsx](C:/code/clean-pay/src/frontend/components/payment-confirmation.tsx:231).
- Обычный `200` записывает только `cleanPayLastPaymentId`:
  [payment-confirmation.tsx](C:/code/clean-pay/src/frontend/components/payment-confirmation.tsx:294).
- Поиск по `src` и `tests` не нашёл ни одной очистки этих ключей.
- Return page независимо подставляет оба значения:
  [payment-return-status.tsx](C:/code/clean-pay/src/frontend/components/payment-return-status.tsx:136).
- Backend выбирает явно переданный `payment_id=A`, даже если операция B уже
  содержит связанный payment record:
  [status route](C:/code/clean-pay/src/app/api/bff/payments/status/route.ts:127).
- Ответ сохраняет `operationStatus` B, но перечитывает платёж A:
  [status route](C:/code/clean-pay/src/app/api/bff/payments/status/route.ts:219).
- Старый `payment A=completed` получает приоритет над состоянием операции:
  [payment-return.ts](C:/code/clean-pay/src/frontend/lib/payment-return.ts:14).

### Terminal-сценарий

1. Старый платёж A завершён и оставлен в `cleanPayLastPaymentId`.
2. Новая операция B получает `202`; обновляется только operation key.
3. B возвращается в `READY` (`retry_ready`) после ошибки до dispatch и не имеет
   связанного PaymentRecord либо имеет незавершённый PaymentRecord B.
4. Return page отправляет `payment_id=A&operation_id=B`.
5. API возвращает `payment A=completed` вместе со статусом B `retry_ready`.
6. UI показывает успех и прекращает polling, хотя B ещё не оплачен.

Уточнение независимой проверки: прежняя формулировка «reconciliation уже
перевела B в `SUCCEEDED`, но PaymentRecord B ещё `PENDING`» не согласуется с
`completeReconciledPayment()`: запись транзакции и перевод операции в
`SUCCEEDED` выполняются в одной Prisma-транзакции. Для дефекта это не требуется:
`paymentReturnOutcome()` проверяет `payment.status === "completed"` раньше
статуса операции. Для `processing` polling продолжается; устойчивый terminal
эффект воспроизводится при `retry_ready`, который `shouldPollPaymentReturn()`
не опрашивает. Доказанный эффект — ложное подтверждение для
пользователя внутри одного аккаунта; поэтому P1 не обоснован без отдельного
доказательства необратимого бизнес-эффекта.

### Выполненная динамическая проверка

```powershell
node --experimental-strip-types --input-type=module -e `
  "const m=await import('./src/frontend/lib/payment-return.ts'); `
   const s={payment:{status:'completed'},operation:{status:'retry_ready'}}; `
   console.log(JSON.stringify({outcome:m.paymentReturnOutcome(s),shouldPoll:m.shouldPollPaymentReturn(s)}));"
```

Фактический результат:

```json
{"outcome":"success","shouldPoll":false}
```

### Ограничения

- API ограничивает оба ID текущим `userId`; это не IDOR между пользователями.
- Ошибка остаётся серьёзной: внутри одного аккаунта UI может устойчиво показать
  оплату B, опираясь на завершённый A.

---

## 2. Owner меняется между payment claim и внешним POST

**Вердикт: VERIFIED. Приоритет: P2; P1 только при необратимом fulfillment.
Доказательства: CODE, TEST, SAFE-NOT-RUN.**

### Цепочка

1. Токен владельца A получается до создания операции:
   [purchase route](C:/code/clean-pay/src/app/api/bff/subscription/purchase/route.ts:67).
2. Создание операции блокирует `WebUser`, но проверяет только `id`, не
   `remnashopUserId`:
   [idempotency.ts](C:/code/clean-pay/src/backend/payments/idempotency.ts:292).
3. Binding хеширует owner из уже полученного JWT A и не перечитывает WebUser:
   [idempotency.ts](C:/code/clean-pay/src/backend/payments/idempotency.ts:604).
4. После отдельного commit `DISPATCHING` выполняется внешний mutation POST:
   [purchase route](C:/code/clean-pay/src/app/api/bff/subscription/purchase/route.ts:177).
5. Текущий owner повторно проверяется только после ответа upstream:
   [idempotency.ts](C:/code/clean-pay/src/backend/payments/idempotency.ts:795).

### Допустимое interleaving

```text
T1: получает JWT аккаунта A
T1: bind(A), mark DISPATCHING, commit
T2: relink/merge A -> B, commit
T1: POST /subscription/purchase с JWT A
T1: post-response owner check видит B и запрещает local success
```

Локальная защита предотвращает запись результата A как платежа B, но не отменяет
уже выполненную внешнюю мутацию. Существующий тест
[payment-idempotency.test.ts](C:/code/clean-pay/tests/unit/backend/payment-idempotency.test.ts:754)
проверяет именно отказ local commit после смены owner, а не предотвращение POST.

### Ограничения

- Это same-user race и требует параллельного relink.
- Для обычного платного checkout подтверждённый эффект — лишний invoice на A.
- P1 оправдан только если upstream POST сразу и необратимо активирует бесплатную
  подписку или списывает сохранённый метод оплаты.
- Live PoC не запускался, чтобы не создавать реальные invoice/fulfillment.

---

## 3. Owner-only relink пропускает payment fencing

**Вердикт: PARTIAL. Приоритет: P2. Доказательства: CODE, TEST.**

### Подтверждено

- При отсутствии отдельной local user строки для нового аккаунта B список
  `sourceUserIds` остаётся пустым:
  [session.ts](C:/code/clean-pay/src/backend/integrations/remnashop/session.ts:388).
- Auth merge вызывается только при непустом списке:
  [session.ts](C:/code/clean-pay/src/backend/integrations/remnashop/session.ts:451).
- `WebUser.remnashopUserId` меняется в любом случае:
  [session.ts](C:/code/clean-pay/src/backend/integrations/remnashop/session.ts:477).
- Payment helper специально умеет обрабатывать `targetOwnerChanged` даже при
  пустом source list:
  [payments/user-merge.ts](C:/code/clean-pay/src/backend/payments/user-merge.ts:140).
- Это поведение закреплено тестом owner-only rebind:
  [payment-user-merge.test.ts](C:/code/clean-pay/tests/unit/backend/payment-user-merge.test.ts:183).

Следствие: незавершённые READY/claimed операции не получают предусмотренный
атомарный rebind/fencing; retry под B может завершиться конфликтом owner hash.

### Что снято из исходного тезиса

- Cross-user утечка не доказана: пользователь подтвердил credentials B, а local
  user остаётся тем же.
- History sync умеет лениво обнаружить нового owner и сбросить cursor/generation.
- Поэтому исходный P1 и формулировка о data-isolation были завышены.

---

## 4. Смена e-mail и `emailVerified`

**Исходный тезис: RETRACTED. Остаточный дефект stale JWT: VERIFIED, P2.
Доказательства: CODE, upstream CODE.**

### Почему исходный тезис неверен

Clean Pay записывает `emailVerified=false`:
[email-verification.ts](C:/code/clean-pay/src/backend/auth/email-verification.ts:513).

Реальная версия Remnashop одновременно записывает:

```python
actor.pending_email = data.email
actor.is_email_verified = False
```

Источник:
[Remnashop email.py](C:/code/remnashop-pr/src/application/use_cases/auth/commands/email.py:41),
строки 46–48, commit `c43f9aec2ae415b87873c16a10cd918dda39ea31`.

`/auth/me` восстанавливает local verified state только если upstream уже вернул
`is_email_verified=true`:
[profile.ts](C:/code/clean-pay/src/backend/auth/profile.ts:67).
Следовательно, новый адрес не становится verified без кода.

### Реальный остаточный дефект

`changeEmail()` после DB update не вызывает `refreshCurrentAccessCookie()` и
заканчивается на
[email-verification.ts](C:/code/clean-pay/src/backend/auth/email-verification.ts:524).
Старый access JWT остаётся с `ev:true`, а proxy доверяет snapshot до его `exp`:
[proxy.ts](C:/code/clean-pay/src/proxy.ts:143).

Максимальное окно — 15 минут:
[policy.ts](C:/code/clean-pay/src/backend/security/policy.ts:1).

Итог: постоянного обхода подтверждения нет, но email-only пользователь может до
истечения старого JWT проходить proxy-gate, если конкретный backend handler не
повторяет проверку.

---

## 5. Глобальный passkey rate-limit bucket

**Вердикт: VERIFIED. Приоритет: P1 для passkey-only пользователей, иначе P2.
Доказательства: CODE, TEST, SAFE-NOT-RUN.**

- Endpoint публичный:
  [proxy.ts](C:/code/clean-pay/src/proxy.ts:50), запись на строке 59.
- `beginPasskeyLogin` передаёт только action, без identity/IP:
  [passkeys.ts](C:/code/clean-pay/src/backend/auth/passkeys.ts:298).
- Пустые identity преобразуются в `none`:
  [rate-limit.ts](C:/code/clean-pay/src/backend/limits/rate-limit.ts:27).
- Итоговый ключ для всех клиентов один:

```text
clean-pay:rate-limit:v2:passkey_login_options:email:none:tgid:none
```

- `limit=20`, поэтому запрос №21 получает 429 на 900 секунд.

Существующие тесты подтверждают обе половины цепочки:

- [rate-limit-and-payments.test.ts](C:/code/clean-pay/tests/unit/backend/rate-limit-and-payments.test.ts:50)
  закрепляет `email:none:tgid:none`;
- [passkeys.test.ts](C:/code/clean-pay/tests/unit/backend/passkeys.test.ts:339)
  подтверждает вызов limiter только с action.

Origin check блокирует обычный cross-site JavaScript, но не прямой HTTP-клиент,
который задаёт допустимый `Origin`. Реальные 21 запрос не отправлялись, чтобы не
блокировать общий dev Redis.

---

## 6. Telegram CSP

**Вердикт: PARTIAL. Приоритет: P2. Доказательства: CODE, EXEC, DOC.**

### Подтверждённая часть

- Глобальный CSP разрешает внешние скрипты только с Cloudflare:
  [next.config.ts](C:/code/clean-pay/next.config.ts:17).
- Telegram loader использует
  `https://telegram.org/js/telegram-web-app.js`:
  [telegram-webapp.ts](C:/code/clean-pay/src/frontend/lib/telegram-webapp.ts:32).
- Официальная инструкция Telegram требует именно этот script URL:
  [Telegram Mini Apps — Initializing Mini Apps](https://core.telegram.org/bots/webapps#initializing-mini-apps).

Выполненная проверка текущего `next.config.ts`:

```text
telegram_script_allowed=false
frame_ancestors_none=true
```

По [CSP source-list rules](https://www.w3.org/TR/CSP/#source-lists) отсутствующий
host блокируется. Loader отклоняет Promise и не доходит до чтения `initData`.

### Уточнения

- Если клиент заранее внедрил полный `window.Telegram.WebApp`, loader не нужен.
- UI предлагает ручной OIDC fallback; это не отказ всех Telegram-методов.
- `frame-ancestors 'none'` точно запрещает iframe, но Telegram использует разные
  webview-механизмы. Универсальный прежний тезис «ломает все клиенты из-за iframe»
  не доказан и снят.

---

## 7. Нет runtime-валидации foreground payment response

**Вердикт: VERIFIED. Приоритет: P2; условный trust-boundary defect.
Доказательства: CODE, DOC, SAFE-NOT-RUN.**

- Generic client только парсит JSON и применяет TypeScript cast:
  [client.ts](C:/code/clean-pay/src/backend/integrations/remnashop/client.ts:64).
- Purchase/extend вызывают `remnashopRequest<PaymentInitResponse>`:
  [purchase route](C:/code/clean-pay/src/app/api/bff/subscription/purchase/route.ts:183).
- Строгий UUID/status/amount/http(s)-parser существует, но используется только
  recovery:
  [payment-recovery.ts](C:/code/clean-pay/src/backend/integrations/remnashop/payment-recovery.ts:246).
- Direct response сохраняется как есть:
  [idempotency.ts](C:/code/clean-pay/src/backend/payments/idempotency.ts:697).
- Frontend проверяет только строковый `payment_id` и передаёт `payment_url` в
  `location.assign`:
  [payment-confirmation.tsx](C:/code/clean-pay/src/frontend/components/payment-confirmation.tsx:283).

Условный upstream response:

```json
{
  "payment_id": "11111111-1111-4111-8111-111111111111",
  "payment_url": "javascript:document.body.dataset.poc='executed'",
  "purchase_type": "NEW",
  "status": "pending",
  "is_free": false,
  "final_amount": "100.00",
  "currency": "RUB"
}
```

`javascript:` является navigation URL по
[WHATWG Location.assign](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-assign-dev),
а CSP проекта содержит `'unsafe-inline'`.

Ограничение существенно: пользователь не контролирует response напрямую;
требуется ошибка или компрометация Remnashop/интеграции. Live PoC не выполнялся.
Даже без XSS malformed URL может оставить форму в submitting-state после того,
как `paymentConfirmed=true` уже установлен.

---

## 8. Dummy refresh вызывает upstream registration до local auth

**Вердикт: VERIFIED. Приоритет: P2. Доказательства: CODE, upstream CODE, SAFE-NOT-RUN.**

1. Proxy считает любое непустое refresh-cookie session candidate:
   [proxy.ts](C:/code/clean-pay/src/proxy.ts:128), затем `isAuthenticated` на строке 280.
2. `/api/bff/link/remnashop` проходит к handler.
3. Handler сначала выполняет upstream login и fallback register:
   [remnashop-link.ts](C:/code/clean-pay/src/backend/auth/remnashop-link.ts:213).
4. Только после успешного внешнего register вызывается `getCurrentSession()`:
   [remnashop-link.ts](C:/code/clean-pay/src/backend/auth/remnashop-link.ts:242).
5. Dummy refresh даёт итоговый 401, но upstream user уже сохранён.

Upstream register действительно сохраняет пользователя до ответа:
[Remnashop register.py](C:/code/remnashop-pr/src/application/use_cases/auth/commands/register.py:42).

Безопасная mock-матрица для regression test:

```text
remnashopAuth(login)    -> AUTH_FAILED
remnashopAuth(register) -> success
getCurrentSession()     -> null

current result: 401, register was called
safe result:    401, no upstream call
```

Предпосылки: JSON, допустимый `Origin`, любое `clean_pay_refresh=x`, новый e-mail
и upstream-valid password. Turnstile штатной публичной регистрации обходится;
лимит `remnashop_link` разделён по выбранному e-mail. Live register не выполнялся,
чтобы не создавать orphan account.

---

## 9. Refresh-only request обходит email-verification gate

**Вердикт: VERIFIED. Приоритет: P2. Доказательства: CODE, TEST.**

- Без access JWT proxy не знает `ev`, но видит наличие refresh cookie:
  [proxy.ts](C:/code/clean-pay/src/proxy.ts:128).
- `isAuthenticated=true`, а `emailVerificationRequired=false`, поэтому текущий
  запрос пропускается.
- Handler уже после proxy валидирует/ротирует refresh и ставит новый access cookie
  с реальным DB-флагом:
  [web-session.ts](C:/code/clean-pay/src/backend/sessions/web-session.ts:187).
- Это не отменяет уже выполняющийся handler.

Конкретный пример: `listPasskeys()` проверяет только FULL session, но не
`emailVerified`:
[passkeys.ts](C:/code/clean-pay/src/backend/auth/passkeys.ts:415).

Существующий тест
[proxy.test.ts](C:/code/clean-pay/tests/unit/backend/proxy.test.ts:90)
прямо закрепляет пропуск любого refresh candidate, но не покрывает unverified
policy.

Это не обход аутентификации: нужен валидный refresh token. Обычный браузер будет
заблокирован следующим `ev:false` access JWT, но прямой клиент может каждый раз
отбрасывать access cookie и использовать rotated refresh successor.

---

## 10. Revoked access JWT отзывает replacement sessions

**Вердикт: VERIFIED. Приоритет: P2. Доказательства: CODE, TEST PLAN.**

- Password change отзывает старые DB sessions и создаёт новую:
  [web-session.ts](C:/code/clean-pay/src/backend/sessions/web-session.ts:727).
- Старый JWT сохраняет свой первоначальный `exp`.
- `verifyAccessToken()` проверяет HMAC и token `exp`, но не DB session state:
  [web-session.ts](C:/code/clean-pay/src/backend/sessions/web-session.ts:88).
- `clearWebSession()` по старому `sid` загружает даже revoked row и затем отзывает
  все активные sessions её `userId`:
  [web-session.ts](C:/code/clean-pay/src/backend/sessions/web-session.ts:852).

Воспроизводимый DB-тест:

1. создать S1 и сохранить access JWT;
2. выполнить password-change replacement, получить S2, S1 становится revoked;
3. вызвать logout со старым JWT S1;
4. текущее поведение: `S2.revokedAt != null`;
5. безопасное поведение: S2 остаётся активной.

Окно ограничено остатком 15-минутного TTL; нужен ранее украденный HttpOnly access
JWT. Это forced-logout DoS, не account takeover.

---

## 11. Ambient environment подменяет `deploy.sh`

**Вердикт: VERIFIED. Приоритет: P2. Доказательства: EXEC, CODE, DOC.**

- [deploy.sh](C:/code/clean-pay/deploy.sh:18) передаёт текущий shell environment
  в Compose без очистки.
- Build arg интерполируется из Compose environment:
  [docker-compose.yml](C:/code/clean-pay/deploy/prod/docker-compose.yml:9).
- Runtime app отдельно получает `deploy/prod/.env` через `env_file`:
  [docker-compose.yml](C:/code/clean-pay/deploy/prod/docker-compose.yml:16).
- PostgreSQL credentials также интерполируются:
  [docker-compose.yml](C:/code/clean-pay/deploy/prod/docker-compose.yml:104).

Выполненная безопасная проверка:

```powershell
$env:NEXT_PUBLIC_APP_URL='https://ambient-override.invalid'
docker compose --env-file deploy/prod/.env `
  -f deploy/prod/docker-compose.yml config --format json
```

Из результата извлечено:

```json
{
  "build_arg": "https://ambient-override.invalid",
  "runtime_env": "<значение из deploy/prod/.env>",
  "mismatch": true
}
```

Официальный приоритет: shell environment выше `--env-file` —
[Docker Compose interpolation precedence](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/#ways-to-set-variables-with-interpolation).

`prod.mjs` уже удаляет ambient Compose variables:
[prod.mjs](C:/code/clean-pay/deploy/prod/prod.mjs:62), но README рекомендует
`./deploy.sh` как основной production entrypoint.

---

## 12. Quoted reconciliation flag не запускает worker

**Вердикт: VERIFIED. Приоритет: P2. Доказательства: CODE, EXEC, DOC.**

- `env_value()` в [deploy.sh](C:/code/clean-pay/deploy.sh:16) снимает только
  `NAME=`, но не внешние кавычки.
- На строке 20 выполняется строгое сравнение с `true`.
- Поэтому `PAYMENT_RECONCILIATION_ENABLED="true"` даёт shell value `"true"` и
  не добавляет профиль.
- Собственный production parser, напротив, снимает кавычки:
  [production-env-rules.mjs](C:/code/clean-pay/deploy/prod/production-env-rules.mjs:86).

Выполненная parser-проверка:

```json
{"PAYMENT_RECONCILIATION_ENABLED":"true"}
```

Docker также определяет `VAR="VAL"` как значение `VAL`:
[Docker env-file syntax](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/#env-file-syntax).

Итог: runtime включает reconciliation endpoint, но Compose profile и worker не
создаются. При unquoted значении из README дефект не проявляется.

---

## 13. Prisma migration неатомарна

**Вердикт: VERIFIED. Приоритет: P2. Доказательства: EXEC, CODE, DOC.**

Проверяемая миграция
[20260718000000_add_payment_reconciliation](C:/code/clean-pay/prisma/migrations/20260718000000_add_payment_reconciliation/migration.sql:1)
содержит 73 строки ALTER/backfill/CREATE/constraints без `BEGIN/COMMIT`.

### Выполненный isolated probe

На временной PostgreSQL DB была применена миграция из двух statements:

```sql
CREATE TABLE "AtomicityProbe" ("id" INTEGER PRIMARY KEY);
SELECT deliberately_missing_review_probe_function();
```

Команда: `prisma migrate deploy`, версия Prisma 7.8.0.

Фактический результат:

```text
prisma_version=7.8.0
migration_exit=1
first_statement_persisted=t
failed_migration_rows=1
Error: P3018
```

Временная БД после проверки удалена.

Для реальной migration поздняя ошибка оставит уже добавленные колонки/таблицы,
а простой retry столкнётся с существующими объектами. Cleanup migration
[20260718141000_drop_redundant_indexes](C:/code/clean-pay/prisma/migrations/20260718141000_drop_redundant_indexes/migration.sql:1)
также не имеет transaction, несмотря на противоположный комментарий. Её SQL
идемпотентен через `IF EXISTS`, но failed Prisma row всё равно требует resolve.

Источники:

- [PostgreSQL transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html);
- [Prisma confirmed issue: transaction добавляется вручную](https://github.com/prisma/prisma/issues/15295).

Если migration уже применена в production, исторический файл нельзя бесконтрольно
редактировать: нужен отдельный rollout/resolve-план с учётом checksum.

---

## 14. Transport error оставляет формы loading

**Вердикт: VERIFIED. Приоритет: P2. Доказательства: CODE.**

В трёх компонентах state включается до `await fetch`, а reset расположен только
после успешного разрешения Promise:

- регистрация:
  [auth-forms.tsx](C:/code/clean-pay/src/frontend/components/auth-forms.tsx:458),
  `loading=true` на 476, fetch на 478, disabled button на 555;
- resend/confirm e-mail:
  [register-email-confirm-form.tsx](C:/code/clean-pay/src/frontend/components/register-email-confirm-form.tsx:59),
  fetch до reset на строках 69/75 и 103/112;
- link e-mail:
  [link-account-panel.tsx](C:/code/clean-pay/src/frontend/components/link-account-panel.tsx:344),
  fetch на 351, reset на 360.

Rejected `fetch` не достигает reset; `catch/finally` отсутствует. Соседний
`deletePasskey` в том же файле показывает правильный `try/finally` образец.

Уточнение: это отказ формы до reload/remount, а не постоянная блокировка аккаунта.

---

## 15. Readiness timeout не отменяет Prisma query

**Вердикт: VERIFIED. Приоритет: P2 для black-hole DB failure.
Доказательства: CODE, TEST, EXEC.**

- `measure()` возвращает результат через `Promise.race`:
  [checks.ts](C:/code/clean-pay/src/backend/health/checks.ts:13).
- `checkDatabase()` игнорирует переданный `AbortSignal`:
  [checks.ts](C:/code/clean-pay/src/backend/health/checks.ts:53).
- Prisma `$queryRaw` не принимает signal.
- Существующий тест
  [health.test.ts](C:/code/clean-pay/tests/unit/backend/health.test.ts:50)
  возвращает outer `down`, хотя mock `$queryRaw` создан как никогда не
  завершающийся Promise. Отменяется ожидание, не запрос.

Probe с `pg.Pool` и TCP server, который принимает соединения и не отвечает, дал:

```json
{
  "queries_started": 5,
  "pool_max": 3,
  "totalCount": 3,
  "idleCount": 0,
  "waitingCount": 2,
  "server_open_sockets": 3
}
```

Single-flight readiness уменьшает частоту, а connection-refused завершается
быстро. Исчерпание требует зависшего/black-hole соединения, но механизм накопления
подтверждён.

---

## 16. Status возвращает pre-reconciliation snapshot

**Вердикт: VERIFIED. Приоритет: P3. Доказательства: CODE.**

- Operation и `operationStatus` читаются до внешней работы:
  [status route](C:/code/clean-pay/src/app/api/bff/payments/status/route.ts:106).
- Затем вызывается reconciliation:
  [status route](C:/code/clean-pay/src/app/api/bff/payments/status/route.ts:185).
- После него PaymentOperation не перечитывается.
- Ответ использует ранее вычисленный `operationStatus`:
  [status route](C:/code/clean-pay/src/app/api/bff/payments/status/route.ts:237).
- Если до reconcile relation отсутствовала, `operation?.paymentRecord` также
  остаётся старой ссылкой.

БД уже корректна; следующий poll исправляет UI. Поэтому это P3 latency/staleness,
а не потеря платежа.

---

## 17. Audit failure превращает payment success в 202

**Вердикт: RETRACTED.**

Первоначальное заключение было ошибочным. `auditLog()` имеет собственный
`try/catch`, логирует ошибку и не пробрасывает её:
[audit.ts](C:/code/clean-pay/src/backend/observability/audit.ts:51).

Это прямо закреплено тестом:
[audit.test.ts](C:/code/clean-pay/tests/unit/backend/audit.test.ts:66).

Тест задаёт `prisma.auditLog.create -> Error("db down")`, после чего
`auditLog(...)` успешно resolves. Следовательно, обычный сбой AuditLog не попадает
в payment catch и не меняет `200` на `202`. Пункт удаляется из списка дефектов.

---

## 18. Cabinet инициирует 11 BFF GET

**Вердикт: VERIFIED. Приоритет: P3. Доказательства: CODE.**

Production mount аутентифицированного `/cabinet`:

```text
CabinetPanel:          auth/me + current + offers + devices + history + support = 6
AppTopbar hook:        auth/me + offers                                  = 2
AppMenu hook:          auth/me + offers                                  = 2
CabinetHeaderActions:  offers                                            = 1
Итого                                                                    = 11
```

Источники:

- [cabinet-panel.tsx](C:/code/clean-pay/src/frontend/components/cabinet-panel.tsx:201);
- [useCleanPayMenu.ts](C:/code/clean-pay/src/frontend/layout/useCleanPayMenu.ts:21);
- [layout.tsx](C:/code/clean-pay/src/frontend/layout/layout.tsx:123);
- [cabinet-header-actions.tsx](C:/code/clean-pay/src/frontend/components/cabinet-header-actions.tsx:13).

Шесть запросов CabinetPanel дополнительно выполняются последовательно. HTTP cache
теоретически может сократить wire transfers, но в коде нет общего client cache или
deduplication. Число development-effect вызовов может отличаться из-за Strict Mode;
оценка относится к production mount.

---

## 19. `pnpm-lock.yaml` не соответствует manifest

**Вердикт: VERIFIED. Приоритет: P3 / tooling only. Доказательство: EXEC.**

Выполнено:

```powershell
corepack pnpm install --frozen-lockfile --lockfile-only
```

Результат:

```text
ERR_PNPM_OUTDATED_LOCKFILE
3 dependencies were added:
@vitest/coverage-v8@^4.1.9
jsdom@^29.1.1
vitest@^4.1.9
```

Текущие Dockerfile, devcontainer и CI используют `npm ci`, поэтому production/CI
не ломаются. Пункт касается только заявленной наличием lockfile поддержки pnpm.

---

## 20. Devcontainer гарантированно unhealthy

**Вердикт как функционального дефекта: RETRACTED.**

Подтверждённые факты:

- command заканчивается `sleep infinity`:
  [.devcontainer/docker-compose.yml](C:/code/clean-pay/.devcontainer/docker-compose.yml:127);
- healthcheck ожидает Next readiness на порту 4000:
  [.devcontainer/docker-compose.yml](C:/code/clean-pay/.devcontainer/docker-compose.yml:165);
- devcontainer не стартует Next автоматически;
- текущий контейнер действительно имеет Docker status `unhealthy`.

Однако это интерактивная среда: разработчик запускает сервер вручную, а E2E runner
делает это явно. При запущенном и ready Next healthcheck может стать healthy.
Следовательно, «гарантированно unhealthy» было слишком сильным утверждением.

Остаётся только ergonomics note: idle devcontainer помечается Docker как unhealthy,
хотя терминальная среда готова. Это не production и не подтверждённый
функциональный дефект.

---

## Дополнительная проверка зависимостей на baseline

Повторный `npm audit --omit=dev --json`:

```json
{
  "total": 5,
  "moderate": 5,
  "high": 0,
  "critical": 0,
  "packages": "@hono/node-server,@prisma/dev,next,postcss,prisma"
}
```

Практическая применимость различается: Prisma/Hono цепочка относится главным
образом к tooling; PostCSS advisory через Next требует отдельной проверки наличия
обработки недоверенного CSS. High/critical advisory нет.

После реализации и публикации commit повторный audit по текущему
`package-lock.json` (`npm audit --omit=dev --json`, 21 июля 2026 года) уже
возвращает 8 advisory:
6 moderate, 2 high, 0 critical. Два high относятся к транзитивным `fast-uri`
(цепочка Prisma/AJV) и `immutable` (Sass); прямых импортов этих библиотек кодом
Clean Pay нет, и удалённо достижимый сценарий в приложении не подтверждён.
Однако production image содержит общий `node_modules`, поэтому этот результат
нельзя скрывать формулировкой «только dev dependency». Это отдельный остаточный
dependency/image-hardening риск: перед production rollout следует обновить
исправляемые транзитивные версии либо отделить build/tooling dependencies от
runtime и повторить audit. Для текущего тестового rollout это не было признано
блокером, но audit не является чистым.

## Выполненные проверки baseline (до изменений)

- auth/security: 5 test files, 113 tests passed;
- payments: 5 профильных unit files, 43 tests passed;
- BFF route tests: 42 passed;
- audit tests: 4 passed;
- Prisma atomicity probe: P3018 + первый statement сохранился;
- Compose ambient-env probe: build/runtime mismatch подтверждён;
- CSP config probe: Telegram host отсутствует;
- pnpm frozen-lockfile probe: воспроизводимый failure;
- исходные файлы приложения во время повторной проверки не изменялись.

## Исторический рекомендуемый порядок исправления

Этот порядок был составлен до реализации. Он выполнен в commit `b2832f4...`,
кроме осознанно оставленного пункта №13; пункты №17 и №20 были отозваны, а не
«исправлены».

1. №1 — связать `payment_id` с `operation_id` и хранить одну атомарную пару.
2. №5 — добавить per-client/IP/WAF identity для public passkey options.
3. №2, №3 — ввести owner epoch/barrier до внешнего payment POST и вызывать
   payment rebind для owner-only relink.
4. №8, №9, №10 — перенести auth/policy checks в handlers до side effects и
   проверять DB-state старой session при logout.
5. №7 — использовать существующий `parsePaymentInit` в foreground path.
6. №6 — разрешить Telegram SDK точечно в CSP и проверить CSP в реальном Mini App.
7. №11–15 — унифицировать deployment entrypoint, parser, migration transactions,
   loading cleanup и DB query timeout/cancellation.
8. №16, №18, №19 — исправлять как reliability/performance/tooling debt.

Пункты №17 и №20 не следует включать в backlog как подтверждённые дефекты.

---

## Независимая проверка логики и поиск неиспользуемого кода на baseline

Проверка выполнена 2026-07-21 по рабочему дереву базового commit до реализации.
Запущены
`npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run test:unit`,
`npm.cmd run test:route-handlers` и `npm.cmd run test:integration`.
Результаты: typecheck успешно; 454 unit-теста успешно; 42 route-handler-теста
успешно; integration: 43 успешно, 11 пропущено. ESLint не нашёл ошибок, но
выдал одно предупреждение в сгенерированном `coverage/block-navigation.js`.

### Проверка логики исходных пунктов

- Итоговая арифметика отчёта корректна: 15 подтверждённых, 3 частично
  подтверждённых/суженных и 2 отозванных пункта дают все 20 исходных тезисов.
- Пункты №2–20 логически согласованы с указанными в них ограничениями. В
  частности, №2, №5, №7–№10, №13 и №15 не следует трактовать как уже
  совершённые атаки: для них явно нужны указанные в тексте race, доверенный или
  скомпрометированный upstream, валидный refresh-token, аварийный сценарий БД
  либо другая предпосылка.
- Пункт №1 подтверждён, но его исходный terminal-сценарий был внутренне
  противоречив: reconciliation не может сначала записать `SUCCEEDED`, оставив
  PaymentRecord той же операции `PENDING`. Сценарий и приоритет исправлены
  выше; реальная причина ложного успеха — независимое смешение A и B и
  приоритет `payment A=completed` над незавершённой B.
- В отчёте корректно отозваны как функциональные дефекты пункты №17 и №20;
  оставлять их можно только как исторические/ergonomics notes.

### Подтверждённый на baseline неиспользуемый код

В `src/frontend/types/layout.d.ts` были обнаружены экспортируемые объявления,
которые не импортируются и не используются ни в `src`, ни в `tests`:

- `AppBreadcrumbProps`;
- `Breadcrumb`;
- `BreadcrumbItem`;
- `NodeRef`;
- `MenuProps`.

Это были небольшие остатки шаблонного layout-кода: на runtime они не влияли, но
увеличивали неактуальную поверхность типов. В commit реализации они удалены
вместе с неиспользуемым импортом `ReactNode`, относившимся только к `NodeRef`.

### Проверка кандидатов на удаление

- `vitest.workspace.ts` **используется** настройкой `vitest.rootConfig` в
  `.vscode/settings.json` и удалению не подлежит. Первоначальный вывод о нём как
  о неиспользуемом файле был ошибочным.
- `deploy/prod/docker-compose.proxy.yml` действительно не упоминается ни одним
  скриптом, compose-файлом или README; его функции уже покрывает основный
  production compose. Файл удалён после повторной проверки ссылок.

### Генерируемые и рабочие артефакты вне Git

На момент поиска в корне были найдены неотслеживаемые рабочие артефакты:

- `.codex-clean-pay-9c5c819.tar`;
- `.codex-clean-pay-9c5c819.tar.gz`;
- `.codex-clean-pay-deploy/`;
- `.codex-prod-compat-hotfix/`.

Два архива `.codex-clean-pay-9c5c819.tar*` удалены через корзину. Каталоги
`.codex-clean-pay-deploy/` и `.codex-prod-compat-hotfix/` сохранены: повторный
аудит показал, что это уникальные операционные rebuild/rollback-рецепты, а не
безусловный мусор.

Также на момент поиска присутствовали игнорируемые результаты локальной работы: `coverage/`,
`.next/`, `tsconfig.tsbuildinfo` и `tsconfig.typecheck.tsbuildinfo`. Из них
только `coverage/` был заметен инструментам: корневой ESLint обходил его и
выдавал предупреждение. Исправление добавило `coverage/` в `globalIgnores`
ESLint. `coverage/`,
`.next/` и пустой migration probe удалены через корзину; `*.tsbuildinfo`
удалены как воспроизводимые артефакты (typecheck при необходимости создаёт их
снова). Все эти удаления восстановимы либо полностью воспроизводимы.

---

## Выполнение отчёта

Дата реализации: 2026-07-21. Базовый commit проверки: `522c5736da83cbbee3e45997c4b108ab29c31fa0`.

Исправлены пункты №1–№12, №14–№16, №18 и №19:

- браузер хранит одну versioned payment-reference и не смешивает ID разных
  попыток; backend считает relation операции авторитетной, отклоняет доказанную
  несовпадающую пару и перечитывает результат reconciliation до зависимого
  запроса подписки;
- payment claim и все owner-changing merge/relink пути сериализованы единым
  PostgreSQL advisory fence. Fence проверяет `DISPATCHING` и claimed `READY` до
  внешней мутации, охватывает Telegram callback и сам примитив локального merge,
  а создание/claim операции повторно сверяет локального owner. Ограничение
  транзакции 180 секунд превышает суммарный 120-секундный сетевой deadline
  наиболее длинного merge-сценария;
- смена e-mail немедленно фиксирует local `emailVerified=false`; DB-policy
  применяется до Remnashop token refresh/recovery, payment replay, passkey и
  payment-history/status действий. Telegram-backed и BOOTSTRAP сценарии
  сохранены;
- public passkey options ограничиваются по HMAC IP identity без сохранения
  исходного IP; identity строится только по валидному правому
  `X-Forwarded-For` hop от локального reverse proxy, подменяемые клиентом
  vendor headers игнорируются;
- Telegram SDK разрешён только в `script-src`; foreground payment response
  проходит runtime parser с сохранением и проверкой `return_url`;
- Remnashop link проверяет активную session и неизменность owner/Telegram
  snapshot до side effects;
- logout со stale/revoked JWT не отзывает replacement sessions, а refresh-only
  logout распознаёт также предыдущий token внутри grace-window;
- `deploy.sh` использует `.env` как авторитетный источник Compose interpolation
  и понимает quoted boolean;
- формы восстанавливают loading после transport/malformed-response ошибок;
- readiness использует отдельный DB pool (`max: 1`) с 4-секундными connect,
  query и statement timeout; обычный Prisma client этими таймаутами не ограничен;
- cabinet GET выполняются параллельно, а одинаковые auth/offers запросы только
  coalesce во время выполнения без долговременного кэша профиля;
- `pnpm-lock.yaml` актуализирован и проходит frozen-lockfile проверку.

### Осознанно не изменённый пункт №13

Два исторических migration-файла действительно неатомарны. Они не изменены:
их редактирование после возможного применения на существующих базах меняет
checksum и без отдельного production rollout/resolve-плана опаснее исходного
дефекта. На первом тестовом развёртывании migration status и фактическое
применение уже проверены отдельно: 15 migrations завершены, незавершённых нет.
Любое исправление исторических SQL должно идти
отдельным изменением с инвентаризацией `_prisma_migrations`, backup и проверенным
rollback/resolve runbook.

### Удалённый код и артефакты

- удалён неиспользуемый `deploy/prod/docker-compose.proxy.yml`;
- удалены `AppBreadcrumbProps`, `Breadcrumb`, `BreadcrumbItem`, `NodeRef` и
  `MenuProps` вместе с их неиспользуемыми imports;
- старые `.codex-clean-pay-9c5c819.tar*`, `.next/`, `coverage/` и пустой
  migration probe перемещены в корзину; `*.tsbuildinfo` удалены как
  воспроизводимые;
- `vitest.workspace.ts`, `.codex-clean-pay-deploy/` и
  `.codex-prod-compat-hotfix/` сохранены как используемая настройка и уникальные
  операционные материалы соответственно.

### Проверки реализации после изменений

- `npm.cmd run lint` — 0 ошибок, 0 предупреждений;
- `npm.cmd run typecheck` — успешно;
- unit: 66 файлов, 471 тест успешно;
- route handlers: 2 файла, 44 теста успешно;
- integration без внешней БД: 45 успешно, 13 ожидаемо пропущены;
- PostgreSQL owner-fence/account-merge: 4 теста успешно на PostgreSQL 17;
- production build с CI-набором фиктивных env — успешно;
- `corepack pnpm install --frozen-lockfile` — успешно.

### Commit и push реализации

- реализация зафиксирована commit
  `b2832f4e1f95612af4369ab2b72c8da11824d77b` с сообщением
  `fix: harden payment and authentication flows`;
- перед commit проверены diff, whitespace и staged secret scan;
- ветка `new-dev` отправлена в origin; remote SHA после push совпал с локальным;
- последующие изменения README и этого отчёта являются documentation-only и не
  меняют SHA фактически развёрнутого runtime.

### Фактическое тестовое развёртывание 21 июля 2026 года

- исходники Clean Pay доставлены в `/opt/clean-pay` как проверенный `git archive`
  ровно commit `b2832f4...`; размер и SHA-256 локального и удалённого архива
  совпали. На сервере намеренно нет `.git`;
- собран `clean-pay-prod-app:b2832f4e1f95`, Docker image ID
  `sha256:6f5979e160f73b4f5bca0973a929bcc028c01f76bce8284eb6f2fc9343bc44d7`;
- Compose project `clean-pay-prod-restore` публикует приложение только на
  `127.0.0.1:4000` и подключает alias `clean-pay` к `remnawave-network`;
- app, PostgreSQL, Redis и retention worker healthy. Все 15 Prisma migrations
  завершены, незавершённых нет; public и authenticated internal readiness
  успешны, включая Remnashop, Redis, Telegram OIDC и Remnawave;
- `PAYMENT_RECONCILIATION_ENABLED=false` сохранён намеренно: совместимость
  upstream проверена, но платёжный fault-injection/end-to-end сценарий на
  disposable provider не выполнялся.

Remnashop обновлён отдельным согласованным maintenance rollout:

- точный commit `b9da68a651e9ab0b7ed52d030e13754311614759`, tag
  `clean-pay-remnashop:b9da68a651e9`, Docker image ID
  `sha256:304191d9e27eee1a92a3ae7ffe3bb23586f4adbb80808d2759ee4bf9ec2926c6`;
- preflight dump восстановлен в отдельную rehearsal-БД; цепочка Alembic
  `0040` → `0050` прошла до единственного head `0050`;
- во время live cutover остановлены только HTTP/Taskiq worker/scheduler.
  Remnashop PostgreSQL и Redis не пересоздавались и сохранили container IDs;
- после cutover все три роли работают из одного target image с нулевым числом
  рестартов; capability contract v1 и безопасный admin merge dry-run вернули
  ожидаемый результат, а строки пользователей до/после dry-run совпали;
- SMTP прошёл TLS и authentication без отправки письма;
- `payment_runtime_control.legacy_rollout_gate_active` очищен в `false` только
  после прохождения всех gates;
- preflight/cutover dump и архив assets проверены и находятся в
  `/opt/deployment-backups/clean-pay-first-20260721T183616Z`, режим каталога
  `0700`. Rollback не запускался, потому что forward rollout завершился успешно.

Caddy route `oplata.clear-vpn.org` применён, временный maintenance для смежных
маршрутов снят после валидации и smoke checks, а исходный
`fallback_policy reject` не менялся. С внешней машины подтверждены:

- валидный сертификат Let’s Encrypt с SAN `oplata.clear-vpn.org`, срок
  `2026-07-21 17:51:23 UTC` — `2026-10-19 17:51:22 UTC`;
- `/api/health/liveness` и `/api/health/readiness` — `200`, readiness не stale;
- `/` — `307` на login, конечная login-страница — `200`;
- HSTS `max-age=31536000` и enforcing CSP.

### Остаточные ограничения и наблюдения

- пункт №13 остаётся реальным, но осознанно не исправленным историческим риском;
- реальный merge пользователей, отправка SMTP-письма и платёжный end-to-end не
  выполнялись: проверены только dry-run, SMTP TLS/auth и health/contracts;
- публичный TLS `panel2.clear-vpn.org` завершает handshake до выдачи сертификата.
  Это наблюдалось до и после rollout; внутренний Caddy route возвращает `200`,
  поэтому проблема локализована во внешнем SNI/TLS слое и не вызвана Clean Pay;
- `/login` раскрывает стандартный `X-Powered-By: Next.js`. Это информационный
  fingerprinting note, не исходный finding и не блокер тестового rollout;
- после очистки в рабочем дереве намеренно сохранены два untracked каталога
  `.codex-clean-pay-deploy/` и `.codex-prod-compat-hotfix/` с уникальными
  операционными материалами. В Git они не добавляются;
- актуальный dependency audit содержит описанные выше 2 high и 6 moderate
  advisory; это отдельный незакрытый dependency/image-hardening долг.

Итог: подтверждённые и подлежащие безопасному исправлению пункты отчёта
реализованы и проверены на тестовом стенде. Нельзя формулировать результат как
«исправлены все 20 дефектов»: два исходных тезиса были отозваны, один
исторический migration-риск №13 оставлен по checksum/rollout причинам, а
dependency advisories и внешний TLS `panel2` зафиксированы как отдельные риски.
