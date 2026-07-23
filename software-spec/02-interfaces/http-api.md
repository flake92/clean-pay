# Реестр входных Rails-интерфейсов

## Общие свойства

- Браузер обращается непосредственно к одному server-rendered Rails-монолиту.
- Маршруты resourceful; технического `/api/bff` namespace и отдельного BFF нет.
- Обычные операции принимают Rails forms и отвечают HTML redirect/render либо
  Turbo. JSON остаётся только у WebAuthn и машинных health/internal интерфейсов.
- Ошибки пользовательских форм выводятся Rails views/flash через I18n.
- Основные cookie сессии: `clean_pay_access` и `clean_pay_refresh`.
- Временные cookie Telegram: `clean_pay_tg_state`, `clean_pay_tg_nonce`, `clean_pay_tg_code_verifier`; подтверждение объединения использует отдельную cookie.
- WebAuthn JSON ограничен 131 072 байт. Обычные формы используют стандартный
  Rack/Rails request limit.
- Изменяющие браузерные запросы защищены Rails CSRF и origin check.
- Внутренние операции используют отдельные служебные секреты и не полагаются на пользовательскую сессию.

## Полный список — 42 канонических операции

| ID | Метод и точный путь | Назначение | Владелец |
|---|---|---|---|
| HTTP-001 | `POST /account/identity` | определить следующий Rails form flow | доступ |
| HTTP-002 | `POST /account/session` | войти по почте и паролю | доступ |
| HTTP-003 | `POST /account/registration` | зарегистрироваться по почте | доступ |
| HTTP-004 | `GET /account/session` | текущая server-rendered сессия | доступ |
| HTTP-005 | `DELETE /account/session` | завершить сессии пользователя | доступ |
| HTTP-006 | `PATCH /account/password` | изменить пароль | доступ |
| HTTP-007 | `POST /account/email_verification` | запросить код подтверждения | доступ |
| HTTP-008 | `PATCH /account/email_verification` | подтвердить почту | доступ |
| HTTP-009 | `PATCH /account/email` | изменить почту | доступ |
| HTTP-010 | `POST /account/passkey_registration` | WebAuthn registration options | доступ |
| HTTP-011 | `PATCH /account/passkey_registration` | WebAuthn registration verify | доступ |
| HTTP-012 | `POST /account/passkey_session` | WebAuthn authentication options | доступ |
| HTTP-013 | `PATCH /account/passkey_session` | WebAuthn authentication verify | доступ |
| HTTP-014 | `GET /account/passkeys` | отрендерить ключи пользователя | доступ |
| HTTP-015 | `DELETE /account/passkeys/{id}` | удалить один ключ | доступ |
| HTTP-016 | `POST /account/telegram_session` | войти из Telegram WebApp | доступ |
| HTTP-017 | `GET /account/merge_confirmation` | показать ожидающее объединение | доступ |
| HTTP-018 | `PATCH /account/merge_confirmation` | подтвердить объединение | доступ |
| HTTP-019 | `DELETE /account/merge_confirmation` | отменить объединение | доступ |
| HTTP-020 | `POST /account/remnashop_link` | связать внешнюю учётную запись | доступ |
| HTTP-021 | `GET /plans` | отрендерить публичные тарифы | подписка |
| HTTP-022 | `GET /subscription` | отрендерить текущую подписку | подписка |
| HTTP-023 | `GET /subscription/offers` | отрендерить персональные предложения | подписка |
| HTTP-024 | `POST /purchases` | создать покупку | платежи |
| HTTP-025 | `POST /extensions` | создать продление | платежи |
| HTTP-026 | `POST /subscription/reissue` | перевыпустить ссылку | подписка |
| HTTP-027 | `POST /subscription/promocode` | активировать промокод | подписка |
| HTTP-028 | `GET /subscription/devices` | отрендерить устройства | подписка |
| HTTP-029 | `DELETE /subscription/devices` | удалить все устройства | подписка |
| HTTP-030 | `DELETE /subscription/devices/{id}` | удалить одно устройство | подписка |
| HTTP-031 | `GET /payments` | отрендерить последние платежи | платежи |
| HTTP-032 | `GET /payments/{id}` | отрендерить состояние платежа | платежи |
| HTTP-033 | `GET /support` | отрендерить поддержку | эксплуатация |
| HTTP-034 | `GET /health` | базовая машинная проверка жизни | эксплуатация |
| HTTP-035 | `GET /health/liveness` | машинная проверка жизни | эксплуатация |
| HTTP-036 | `GET /health/readiness` | публичная готовность | эксплуатация |
| HTTP-037 | `GET /internal/health/readiness` | подробная готовность | эксплуатация |
| HTTP-038 | `POST /internal/payment_reconciliations` | фоновая сверка платежей | платежи |
| HTTP-041 | `GET /account/telegram_authorization/new` | начать Telegram-вход | доступ |
| HTTP-042 | `GET /account/telegram_authorization/callback` | принять OIDC callback | доступ |
| HTTP-043 | `POST /account/telegram_authorization/callback` | принять popup callback | доступ |
| HTTP-044 | `GET /service-worker.js` | выдать service worker | эксплуатация |

## Зафиксированные особенности совместимости

1. HTTP-039/040 сняты: их поведение принадлежит единственному Rails resource
   `/account/session`, отдельные compatibility aliases запрещены.
2. HTTP-010…013 остаются JSON только из-за browser WebAuthn API.
3. HTTP-034…038 и HTTP-044 остаются машинными интерфейсами.
4. Внешние Remnashop/Telegram/Remnawave paths не меняются этой маршрутизацией.

Полные карточки по обязательному шаблону создаются в `http/operations/`; агрегированные карты областей находятся в `http/identity.md`, `http/subscription.md`, `http/payments.md`, `http/platform.md`. Доказательства текущего поведения изолированы в `09-traceability/routes-matrix.md`.
