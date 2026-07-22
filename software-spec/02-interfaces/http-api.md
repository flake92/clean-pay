# Реестр входных HTTP-интерфейсов

## Общие свойства

- Регистр пути и метода значим; явной версии в путях Clean Pay нет.
- Основной формат успешного ответа: `{"data": ...}`.
- Основной формат ошибки: `{"error":{"code":"...","message":"..."}}`.
- Исключения из основной оболочки явно отмечены в детальных карточках.
- Основные cookie сессии: `clean_pay_access` и `clean_pay_refresh`.
- Временные cookie Telegram: `clean_pay_tg_state`, `clean_pay_tg_nonce`, `clean_pay_tg_code_verifier`; подтверждение объединения использует отдельную cookie.
- Обычное тело JSON ограничено 65 536 байт, ответы ключа доступа — 131 072 байт.
- Изменяющие браузерные запросы проверяют источник; запрос с телом обязан иметь JSON-совместимый тип содержимого.
- Внутренние операции используют отдельные служебные секреты и не полагаются на пользовательскую сессию.

## Полный список — 44 операции

| ID | Метод и точный путь | Назначение | Владелец |
|---|---|---|---|
| HTTP-001 | `POST /api/bff/auth/identify` | определить существование адреса и ключа доступа | доступ |
| HTTP-002 | `POST /api/bff/auth/login` | войти по почте и паролю | доступ |
| HTTP-003 | `POST /api/bff/auth/register` | зарегистрироваться по почте | доступ |
| HTTP-004 | `GET /api/bff/auth/me` | получить текущий профиль | доступ |
| HTTP-005 | `POST /api/bff/auth/logout` | завершить сессии пользователя | доступ |
| HTTP-006 | `POST /api/bff/auth/change-password` | изменить пароль | доступ |
| HTTP-007 | `POST /api/bff/auth/email/request-verification` | запросить код подтверждения | доступ |
| HTTP-008 | `POST /api/bff/auth/email/confirm` | подтвердить почту | доступ |
| HTTP-009 | `POST /api/bff/auth/email/change` | изменить почту | доступ |
| HTTP-010 | `POST /api/bff/auth/passkey/register/options` | начать регистрацию ключа | доступ |
| HTTP-011 | `POST /api/bff/auth/passkey/register/verify` | завершить регистрацию ключа | доступ |
| HTTP-012 | `POST /api/bff/auth/passkey/login/options` | начать вход по ключу | доступ |
| HTTP-013 | `POST /api/bff/auth/passkey/login/verify` | завершить вход по ключу | доступ |
| HTTP-014 | `GET /api/bff/auth/passkey/credentials` | получить ключи пользователя | доступ |
| HTTP-015 | `DELETE /api/bff/auth/passkey/credentials/{id}` | удалить один ключ | доступ |
| HTTP-016 | `POST /api/bff/auth/telegram/webapp` | войти из Telegram WebApp | доступ |
| HTTP-017 | `GET /api/bff/auth/telegram/merge-confirmation` | получить ожидающее объединение | доступ |
| HTTP-018 | `POST /api/bff/auth/telegram/merge-confirmation` | подтвердить объединение | доступ |
| HTTP-019 | `DELETE /api/bff/auth/telegram/merge-confirmation` | отменить объединение | доступ |
| HTTP-020 | `POST /api/bff/link/remnashop` | связать внешнюю учётную запись | доступ |
| HTTP-021 | `GET /api/bff/plans/public` | получить публичные тарифы | подписка |
| HTTP-022 | `GET /api/bff/subscription/current` | получить текущую подписку | подписка |
| HTTP-023 | `GET /api/bff/subscription/offers` | получить персональные предложения | подписка |
| HTTP-024 | `POST /api/bff/subscription/purchase` | создать покупку | платежи |
| HTTP-025 | `POST /api/bff/subscription/extend` | создать продление | платежи |
| HTTP-026 | `POST /api/bff/subscription/reissue` | перевыпустить ссылку | подписка |
| HTTP-027 | `POST /api/bff/subscription/promocode` | активировать промокод | подписка |
| HTTP-028 | `GET /api/bff/subscription/devices` | получить устройства | подписка |
| HTTP-029 | `DELETE /api/bff/subscription/devices` | удалить все устройства | подписка |
| HTTP-030 | `DELETE /api/bff/subscription/devices/{hwid}` | удалить одно устройство | подписка |
| HTTP-031 | `GET /api/bff/payments/history` | получить последние платежи | платежи |
| HTTP-032 | `GET /api/bff/payments/status` | получить состояние платежа | платежи |
| HTTP-033 | `GET /api/bff/support` | получить контакты поддержки | эксплуатация |
| HTTP-034 | `GET /api/health` | базовая проверка жизни | эксплуатация |
| HTTP-035 | `GET /api/health/liveness` | проверка жизни | эксплуатация |
| HTTP-036 | `GET /api/health/readiness` | публичная готовность | эксплуатация |
| HTTP-037 | `GET /api/internal/health/readiness` | подробная готовность | эксплуатация |
| HTTP-038 | `POST /api/internal/payments/reconcile` | фоновая сверка платежей | платежи |
| HTTP-039 | `GET /api/me` | совместимый профиль | доступ |
| HTTP-040 | `POST /api/logout` | совместимый выход | эксплуатация |
| HTTP-041 | `GET /auth/telegram/start` | начать Telegram-вход | доступ |
| HTTP-042 | `GET /auth/telegram/callback` | принять возврат Telegram | доступ |
| HTTP-043 | `POST /auth/telegram/callback` | принять возврат всплывающего Telegram-входа | доступ |
| HTTP-044 | `GET /sw.js` | выдать служебный сценарий веб-приложения | эксплуатация |

## Зафиксированные особенности совместимости

1. HTTP-043 и HTTP-044 существуют, хотя старый ручной список интерфейсов их не содержал.
2. Объявленное в типах поле `return_url` для HTTP-024/025 фактически не принимается: система создаёт адрес сама.
3. HTTP-039/040, Telegram-входы и проверки здоровья имеют отличающиеся оболочки ответа; унифицировать их без отдельного решения нельзя.

Полные карточки по обязательному шаблону создаются в `http/operations/`; агрегированные карты областей находятся в `http/identity.md`, `http/subscription.md`, `http/payments.md`, `http/platform.md`. Доказательства текущего поведения изолированы в `09-traceability/routes-matrix.md`.
