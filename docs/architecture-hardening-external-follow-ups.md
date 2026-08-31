# Внешние follow-up после архитектурного hardening

Эти пункты требуют полномочий вне репозитория или отдельного разрешения. Они не
являются основанием ослаблять локальные, CI, browser или container gates.

## Требуется администратор GitHub

- Создать защищённый Environment для promotion/deployment и назначить required
  reviewers, запретив self-approval.
- Включить branch protection/ruleset с обязательными CI, CodeQL, dependency
  review, secret scan и проверкой актуальности ветки перед merge.
- Ограничить право запуска promotion и изменения Environment secrets; проверить
  audit log и срок хранения workflow artifacts.

## Требуется отдельное разрешение на major GitHub Actions

- `gitleaks/gitleaks-action` закреплён на последнем `v2.3.9`
  (`ff98106e4c7b2bc287b24eaf42907196329070c7`), а `actions/upload-artifact` — на
  последнем `v4.6.2` (`ea165f8d65b6e75b540449e92b4886f43607fa02`). Обе версии объявляют
  runtime `node20`, поэтому GitHub-hosted runner выдаёт предупреждение и
  принудительно запускает их на Node.js 24.
- Same-major версий с `node24` нет. Минимальные закреплённые кандидаты —
  `gitleaks/gitleaks-action` `v3.0.0`
  (`e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e`) и
  `actions/upload-artifact` `v6.0.0`
  (`b7c566a772e6b6bfb58ed0dc250532a479d7789f`). Их обновление намеренно
  отложено из-за запрета major dependency upgrades; оно требует отдельного
  review и GitHub Actions runner версии не ниже `2.327.1`.

## Требуется отдельное разрешение владельца секретов

- Ротация внешних API-токенов, bot credentials, signing keys и production
  database credentials намеренно не выполняется в этой работе.
- После разрешённой ротации нужны staged validation, отзыв прежних значений,
  проверка отсутствия утечки в истории/artifacts и документированный rollback.

## Требуется эксплуатационная инфраструктура

- Настроить off-host availability/latency monitoring, алерты по насыщению pool,
  reconciliation backlog и ошибкам upstream с редактированными labels.
- Проверить восстановление backup на отдельном тестовом контуре и регулярно
  репетировать rollback image pair без использования production данных.
- Настроить централизованное хранение логов и метрик с retention/access policy;
  credentials, cookies, токены и пользовательские payload в telemetry запрещены.

## Граница этой работы

Production deployment не выполняется. Внешние секреты не читаются, не копируются
в repository/build context и не изменяются. Проверки со сторонними провайдерами
допустимы только на синтетических данных в одноразовых изолированных проектах.
