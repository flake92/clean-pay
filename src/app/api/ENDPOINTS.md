# External HTTP controllers

Clean Pay does not expose an internal browser API. React receives query view models from Server Components and invokes explicit Server Actions for commands.

Only contracts that must be reached by infrastructure outside the React application remain as HTTP controllers:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Public process health summary |
| `GET /api/health/liveness` | Container liveness probe |
| `GET /api/health/readiness` | Public cached readiness result |
| `GET /api/internal/health/readiness` | Secret-protected detailed readiness probe |
| `GET /api/internal/metrics` | Secret-protected Prometheus operational metrics |
| `POST /api/internal/payments/reconcile` | Secret-protected reconciliation worker entrypoint |
| `GET /auth/telegram/start` | Telegram OIDC authorization redirect |
| `GET /auth/telegram/callback` | Telegram OIDC callback |
| `POST /auth/telegram/callback` | Telegram popup/login-widget callback |

Controllers decode their own concrete protocol, call a server use case, and encode their own concrete response. They are not reusable JSON transport for the UI.
