# Integration Tests

This directory is reserved for service-level integration tests that do not fit
the fast unit layer and do not require the full devcontainer stack.

The full-stack HTTP suite lives in `tests/e2e/full-stack` and is launched with
`npm run test:e2e:devcontainer`.

## Layers

```text
tests/unit                         fast tests without containers
tests/integration/route-handlers   route-handler contract tests with explicit mocks
tests/integration/services         service-level integration tests
tests/e2e/full-stack               real devcontainer-backed HTTP tests
```

Do not put full-stack tests in this directory. Tests that call the running
Next.js server, real Remnashop, Mailpit, Telegram OIDC mock, PostgreSQL, and
Redis belong under `tests/e2e/full-stack`.

## Commands

```bash
npm run test:unit
npm run test:route-handlers
npm run test:integration
npm run test:e2e:devcontainer
```
