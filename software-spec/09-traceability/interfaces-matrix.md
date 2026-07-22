# Матрица интерфейсов

| Идентификаторы | Тип | Источник фактов | Нормативная спецификация | Текущий статус |
|---|---|---|---|---|
| HTTP-001…044 | входящий HTTP Clean Pay | 40 route-файлов, proxy, callers, тесты | HTTP-каталог и 44 карточки | описан и проверен 44 route + 104 E2E тестами |
| PAGE-001…019 | UI-маршруты | 19 страниц и компоненты | frontend-раздел, эталоны и макет | описан; 76 current/mockup снимков и browser checks проверены |
| FORM-001…010 | пользовательские действия | формы, handlers, browser API | формы, сценарии, API usage | описан; UI/E2E/visual проверен |
| RS-001…030 | исходящий HTTP Remnashop | клиенты, callers, runtime parsers, pinned upstream | каталог выходов и Remnashop operations | полностью описан и сверен |
| TG-001…006 | Telegram OIDC/popup/Login Widget/WebApp | клиент, callbacks, script loader, mocks, тесты | Telegram integration | полностью описан и сверен |
| RW-001…004 | Remnawave | клиент/readiness/mock/tests | Remnawave integration | полностью описан и сверен |
| TS-000…001 | Turnstile widget/siteverify | frontend widget, backend verifier, proxy/env/tests | Turnstile integration | полностью описан и сверен |
| MP-001…003, SMTP-001 | Mailpit/SMTP | readiness, Compose, logger, pinned Remnashop | почтовая integration | полностью описан и реальной доставкой проверен |
| PAY-001…003 | платёжный provider через Remnashop | payment runtime, pinned gateway clients/webhook | payment providers | полностью описан; безопасно проверен без реального списания |
| SUP-001…003 | support links | конфигурация/BFF/frontend | support channels | описан |
| DB/Redis/browser/proxy | технические интерфейсы состояния | schema/queries/RESP/Web APIs/deploy | data/storage/browser/proxy | полностью описан и физически проверен в применимой среде |
| JOB-001…003 | фоновые команды | worker scripts/routes/health/tests | background/operations | полностью описан; recovery/restart требования зафиксированы |
| CFG-ALL | конфигурация | env rules/Compose/harnesses | configuration | runtime/deploy/test области и фиксированные константы сверены |

Каждый интерфейс имеет единственного логического владельца и закрыт нормативной спецификацией; происхождение подтверждается перечисленными источниками и `verification-report.md`.
