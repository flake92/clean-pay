# Clean Pay — системная и архитектурная спецификация

Критерии полного завершения и физическая отметка самодостаточности определены в `00-system/completion-gates.md` и итоговом манифесте. Спецификация предназначена для новой реализации; удаление исходников остаётся отдельным действием только после явного подтверждения пользователя.

Цель каталога — сохранить наблюдаемое поведение Clean Pay так, чтобы продукт можно было повторно реализовать без обращения к текущему исходному проекту. Язык, framework и внутренняя структура будущей реализации на этом этапе не выбираются.

## Состояние работы

- исходный срез: 2026-07-22;
- текущий этап: анализ и проверка полноты завершены;
- исходники: сохранены и не изменяются;
- готовность спецификации: подтверждена итоговым манифестом;
- удаление исходников: не выполнялось и требует отдельного подтверждения;
- материалы `99-llm/`: созданы после завершения и проверки этапов 1–9;
- переход на Ruby-монолит: отдельный неисполненный план `RUBY_MONOLITH_CLEANUP_PLAN.md`.

Итоговая статистика: частично описанных, неописанных, конфликтных и требующих уточнения значимых элементов — 0. Физические результаты проверок находятся в `09-traceability/verification-report.md`.

## Обнаруженные продуктовые области

1. Web-аутентификация: e-mail/password, Telegram OIDC, Telegram WebApp и WebAuthn passkeys.
2. Локальные сессии, rotation refresh token, assurance levels и политика подтверждения e-mail.
3. Профиль, изменение e-mail/пароля, привязка и объединение аккаунтов.
4. Тарифы, предложения, текущая подписка, устройства, промокоды и перевыпуск ссылки.
5. Покупка/продление, идемпотентность, локальные платежные записи, history sync и reconciliation.
6. PWA/offline/install, поддержка, health/readiness.
7. PostgreSQL, Redis, Remnashop public/admin, Remnawave, Telegram OIDC/WebApp/Bot API, Turnstile, SMTP, Mailpit, платёжные провайдеры, reverse proxy и support-каналы.
8. Аудит, structured logging, rate limiting, security headers, retention и deployment.

## Навигация по доказательствам

- [`09-traceability/source-tree-manifest.md`](09-traceability/source-tree-manifest.md) — полный перечень исходных каталогов и файлов.
- [`09-traceability/source-inventory.md`](09-traceability/source-inventory.md) — классифицированная инвентаризация.
- [`02-interfaces/inbound-catalog.md`](02-interfaces/inbound-catalog.md) — первичный каталог входов.
- [`02-interfaces/outbound-catalog.md`](02-interfaces/outbound-catalog.md) — первичный каталог выходов.
- [`02-interfaces/http-api.md`](02-interfaces/http-api.md) — реестр 44 HTTP-операций.
- [`02-interfaces/configuration.md`](02-interfaces/configuration.md) — первичный реестр конфигурации.
- [`09-traceability/interfaces-matrix.md`](09-traceability/interfaces-matrix.md) — первичная трассировка интерфейсов.
- [`00-system/open-questions.md`](00-system/open-questions.md) — реестр закрытых вопросов и принятых решений.
- [`09-traceability/verification-report.md`](09-traceability/verification-report.md) — автоматические, интеграционные, визуальные и clean-room проверки.
- [`09-traceability/deletion-readiness-report.md`](09-traceability/deletion-readiness-report.md) — статистика и ограничение разрешения на удаление.
- [`RUBY_MONOLITH_CLEANUP_PLAN.md`](RUBY_MONOLITH_CLEANUP_PLAN.md) — что сохранить, адаптировать, создать и удалить только после подтверждения.
- [`99-llm/master-implementation-prompt.md`](99-llm/master-implementation-prompt.md) — передача новой реализации без обращения к старому коду.

## Источники фактов

Приоритет отдаётся фактическим route handlers, runtime validation, state transitions и тестам. Типы и документация используются как дополнительные источники и сверяются с исполняемым поведением.
