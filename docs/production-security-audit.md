# Production security audit

Обезличенная сводка требований безопасности и надёжности Clean Pay. Документ описывает проверяемые свойства продукта, а не состояние конкретного production-окружения.

## Критичные контроли

### Идентификация и аутентификация

- WebAuthn credential принимается только после серверной проверки challenge и владельца.
- Telegram OIDC использует state, nonce и PKCE с одноразовым потреблением.
- Объединение e-mail и Telegram-аккаунтов выполняется только после доказательства обеих identity.
- Смена пароля отзывает активные сессии пользователя.
- Access и refresh tokens не записываются в открытом виде в БД, логи или audit metadata.

### Платежи

- Purchase/extend требуют idempotency key и server-side fingerprint запроса.
- Цена, валюта и версия предложения повторно проверяются перед отправкой во внешний API.
- Платёж связывается с локальным пользователем и неизменившимся upstream owner.
- Потерянный или неоднозначный ответ не преобразуется в ложный успех.
- Автоматическая сверка включается только при совместимом recovery contract upstream-сервиса.

### Web security

- Cookie-auth mutations проверяют доверенный origin и тип содержимого.
- Cookies используют `HttpOnly`, подходящий `SameSite` и `Secure` в production.
- Redirect destinations ограничены локальными безопасными путями.
- CSP, `frame-ancestors`, `X-Content-Type-Options`, Referrer и Permissions policies включены централизованно.
- JSON body имеет ограниченный размер и проходит runtime-валидацию.

### Данные и журналирование

- Пароли, токены, cookies, ключи и идентификаторы пользователей редактируются перед записью в логи.
- IP хранится только в виде keyed hash для audit/rate limiting.
- Служебные auth states, verification codes, sessions, audit и rate-limit rows имеют bounded retention.
- Ошибка audit-записи не должна менять результат уже завершённой бизнес-операции.

### Эксплуатация

- Production-конфигурация проверяется до сборки/запуска и fail-closed отклоняет placeholders и слабые секреты.
- PostgreSQL и Redis не публикуются во внешнюю сеть.
- Readiness проверяет критические зависимости с ограниченными timeout.
- Deployment считается успешным только после полного healthy readiness.
- Миграции требуют backup, preflight и отдельного rollback-плана.
- Логи контейнеров имеют ограничение размера и ротацию.

## Release gates

Перед выпуском обязательны:

1. lint, typecheck, unit и route-handler tests;
2. production build с фиктивной безопасной конфигурацией;
3. PostgreSQL concurrency tests в изолированном окружении;
4. проверка миграций на непустой копии БД;
5. проверка readiness и отказов внешних зависимостей;
6. secret/PII scan итогового Git tree и Docker image;
7. подтверждение совместимой версии Remnashop и требуемого recovery contract из [`upstream PR #135`](https://github.com/snoups/remnashop/pull/135), пока изменения не вошли в официальный release.

## Где хранить операционные доказательства

Реальные результаты deployment, адреса, идентификаторы образов, backup manifests и incident notes должны храниться во внешнем закрытом журнале с контролем доступа. В Git допускаются только обезличенные шаблоны и проектные решения.

Запрещено добавлять в `docs`:

- реальные домены, IP, e-mail и usernames;
- абсолютные пути конкретных серверов или рабочих станций;
- database URLs, токены, секреты, cookies и приватные ключи;
- полные commit/tree/image/container IDs конкретного rollout;
- account, session, payment и operation IDs;
- имена файлов резервных копий и их контрольные суммы;
- сырые authenticated health/debug responses.

## Связанные документы

- [План security и reliability исправлений](security-reliability-remediation-plan.md)
- [Production migration runbook](production-migration-runbook.md)
- [Payment idempotency recovery](payment-idempotency-recovery-design.md)
- [Refresh token rotation](refresh-token-rotation-design.md)
