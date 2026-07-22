# Матрица внешних интеграций

| IDs | Граница | Количество прямых операций | Нормативная спецификация | Источники подтверждения | Статус |
|---|---|---:|---|---|---|
| RS-001…030 | Remnashop public/admin | 30 | `04-integrations/remnashop*.md` | клиент/callers/runtime parsers; зафиксированный commit Remnashop; unit/integration/e2e | полностью описан и сверен |
| TG-001…006 | Telegram OIDC/popup/Login Widget/WebApp SDK | 6 | `04-integrations/telegram.md` | OIDC client/callback/env; WebApp loader; mocks; Telegram tests | полностью описан и сверен |
| RW-001…004 | Remnawave | 4 | `04-integrations/remnawave.md` | client/readiness; mock; tests | описан |
| TS-000…001 | Turnstile widget/siteverify | 2 | `04-integrations/turnstile.md` | widget/verifier/env/proxy; tests | описан |
| MP-001 | Mailpit readiness | 1 | `04-integrations/mailpit-smtp.md` | readiness check/compose/tests | описан |
| SELF-001 | reconciliation worker → Clean Pay | 1 | operations/payment interface docs | worker script/route/tests | описан |
| DB | PostgreSQL Clean Pay | SQL/physical model | `04-integrations/storage.md`, `06-data/` | schema/migrations/queries/integration tests | полностью описан; 15 миграций и 58 integration tests проверены |
| REDIS | Redis Clean Pay | RESP operations | `04-integrations/storage.md` | Redis client/rate limit/readiness/tests | точная command/timeout/limit семантика описана и проверена |
| BR-001…011 | браузер: навигация, WebAuthn, PWA, storage, clipboard, локальный логотип, системные обработчики | 11 групп операций | `04-integrations/browser-pwa.md`, `05-frontend/` | клиентские сценарии, ключи доступа, Service Worker, branding и тесты | полностью описан; 76 снимков и browser checks проверены |
| Proxy | reverse proxy/HTTPS | входящая HTTP-граница | `04-integrations/reverse-proxy.md` | Compose/Caddy/deploy/env/proxy | описан |

## Косвенные границы

| IDs | Граница | Спецификация | Источники | Статус |
|---|---|---|---|---|
| SMTP-001, MAIL-USER-001 | Remnashop → SMTP → пользователь | `04-integrations/mailpit-smtp.md` | pinned Remnashop config/sender/email use case; dev Compose/Mailpit | описан |
| MP-002…003 | Mailpit webhook/logger API | `04-integrations/mailpit-smtp.md` | Mailpit logger server/Compose | описан |
| BOT-001 | Remnashop → Telegram Bot API | `04-integrations/telegram.md` | pinned Remnashop bot config; Telegram mock/Compose | граница и mock описаны; полный Bot API Remnashop не является контрактом Clean Pay |
| PAY-001…003 | Remnashop/browser/provider/webhook | `04-integrations/payment-providers.md` | pinned Remnashop gateway enum/clients/webhook; Clean Pay payment response/recovery | граница, gateway set и наблюдаемый контракт описаны |
| REMNA-IND-001 | Remnashop → Remnawave | system context/Remnashop/Remnawave docs | Remnashop config/full-stack topology | описан как внешнее владение Remnashop |
| SUP-001…003 | e-mail client, Telegram support, FAQ | `04-integrations/support-channels.md` | support configuration/BFF/frontend links | описан |

## Тестовые контейнеры

| Контейнер | Подтверждённый интерфейс | Статус |
|---|---|---|
| `remnashop`, `remnashop-worker`, `remnashop-scheduler` | совместимый public/admin API и фоновые процессы | описан |
| `remnashop-postgres`, `remnashop-cache` | отдельные хранилища Remnashop | описан |
| `remnawave-mock` | metadata + `{response:null}` fallback | полностью описан в `04-integrations/mock-services.md` |
| `telegram-mock` | Bot API-shaped `/bot{token}/{method}` | полностью описан в `04-integrations/mock-services.md` |
| `telegram-oidc-mock` | auth/token/JWKS/discovery/avatar | полностью описан в `04-integrations/mock-services.md` |
| `smtp` | SMTP 1025 + Mailpit HTTP 8025 | описан; проверенный digest `sha256:37a38e…d6dd6` закреплён для prestage |
| `smtp-log` | webhook 8126 + Mailpit message lookup | полностью описан в `04-integrations/mock-services.md` |
| `caddy` | reverse proxy 8080/8081/8026 | полностью описан в `04-integrations/mock-services.md` |

Полевая сверка матрицы завершена. Разрешение на удаление определяется отдельным отчётом и всё равно требует явного подтверждения пользователя.
