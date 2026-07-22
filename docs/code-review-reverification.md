# Повторная верификация code review

Этот документ фиксирует методику и итог повторной проверки критичных сценариев Clean Pay без привязки к конкретному серверу, владельцу, домену или развёртыванию.

## Область проверки

Проверялись следующие классы рисков:

- соответствие `payment_id`, `operation_id` и владельца платежа;
- идемпотентность покупки и продления;
- восстановление после неоднозначного ответа платёжного провайдера;
- безопасное объединение e-mail и Telegram-аккаунтов;
- отзыв и ротация web/Remnashop-сессий;
- атомарное потребление WebAuthn challenge и Telegram state;
- CSRF, redirect policy, CSP и runtime-валидация запросов;
- rate limiting и минимизация персональных данных;
- readiness, timeouts и обработка отказов внешних сервисов;
- безопасность production-миграций и rollback-процедур.

## Методика

Каждый вывод должен подтверждаться как минимум одним из способов:

- статический анализ полной цепочки выполнения;
- воспроизводимый unit или integration-тест;
- конкурентный тест на отдельной PostgreSQL;
- безопасный fault-injection без обращения к реальным платёжным данным;
- проверка production build и валидатора конфигурации.

Разрушающие сценарии, реальные платежи, отправка писем и операции над живыми пользовательскими аккаунтами не должны использоваться для обычной проверки.

## Подтверждённые свойства

- платёжная операция привязана к локальному пользователю и upstream owner;
- один idempotency key не может подтвердить другой payload;
- неоднозначный результат переводится в восстановимое состояние, а не объявляется успехом;
- account merge требует повторной проверки итоговых e-mail, Telegram ID и владельца подписки;
- смена пароля отзывает прежние сессии и создаёт новую session family;
- refresh token rotation сериализована и обнаруживает позднее повторное использование;
- WebAuthn challenge и Telegram state потребляются одним победителем;
- browser mutations защищены origin/CSRF-политикой и ограничением размера тела;
- чувствительные identity-поля редактируются в логах и audit metadata;
- readiness завершается за ограниченное время и не публикует детали зависимостей наружу;
- production-миграции выполняются через `prisma migrate deploy` после backup и preflight.

## Обязательные проверки перед выпуском

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:route-handlers
npm run build
```

PostgreSQL concurrency и full-stack E2E выполняются только в изолированном тестовом окружении. Результаты конкретного rollout хранятся во внешнем закрытом операционном журнале и не добавляются в репозиторий.

## Ограничения документа

Здесь намеренно отсутствуют:

- реальные домены, IP-адреса и имена инфраструктуры;
- пути на production-серверах;
- commit, tree, image и container identifiers конкретного выпуска;
- имена пользователей, e-mail и внутренние account/payment IDs;
- расположение, имена и контрольные суммы резервных копий;
- содержимое `.env`, токены, ключи и authenticated health-ответы.

Для проектных деталей используйте:

- [payment idempotency recovery](payment-idempotency-recovery-design.md);
- [refresh token rotation](refresh-token-rotation-design.md);
- [production migration runbook](production-migration-runbook.md);
- [security and reliability remediation plan](security-reliability-remediation-plan.md).
