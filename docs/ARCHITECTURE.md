# Clean Pay architecture

## Dependency rule

Dependencies point inward:

1. `src/shared/domain` — entities, value objects, domain errors and policies.
2. `src/application` — commands, queries, ports and application results.
3. `src/backend` — infrastructure and adapters implementing application ports; provider contracts stay inside this outer layer.
4. `src/app` — composition root and server presentation (Server Components, Server Actions and external HTTP controllers).
5. `src/frontend` — view-only React components receiving serializable props and invoking Server Actions.

Domain and application code must not import Next.js, Prisma, Redis, HTTP clients, cookies, provider SDK types or concrete integrations.

## UI boundary

React components are views. They may own ephemeral presentation state such as an open dialog or a selected tariff, but they must not:

- call `fetch`;
- know API paths, HTTP methods, headers or response envelopes;
- import database, integration or application implementations;
- orchestrate business workflows.

Server Components load query view models. Server Actions accept explicit command DTOs, invoke application use cases and return explicit action results.

## Application boundary

Each scenario has an explicit input and output. Application use cases depend on ports. Concrete Prisma, Redis, Remnashop, Remnawave, WebAuthn and Telegram implementations live outside the application layer and are wired in `src/app` composition roots. Provider-neutral DTOs in `src/application/models` may be imported as types by the React presentation layer.

Every application port must be consumed by an application use case. Technical helpers that merely forward a call to one concrete repository are not use cases and must stay in the outer adapter layer. Backend adapters may import application ports and models, but never an application use-case implementation; production use cases are composed only in `src/app`.

Authentication policy belongs to `src/application/auth`: human verification and rate-limit ordering, registration fallback, session establishment, verification dispatch, password-reset session replacement and success auditing are application decisions. The backend authentication gateway exposes granular provider and persistence operations and translates provider failures into application-owned errors.

Telegram callback and WebApp authentication follow the same rule: account-link/merge/recovery branching, redirect selection, identity-verification ordering and session-recovery decisions live in application use cases. Telegram/Remnashop adapters expose only granular verification, provider and persistence operations; a single adapter method must not implement an end-to-end authentication scenario.

Payment dispatch ordering, offer revalidation, idempotency state transitions and uncertain-outcome handling are owned by `src/application/payments/execute-payment-workflow.ts`. The backend payment adapter supplies only provider, persistence, session, rate-limit and audit capabilities through an opaque application port.

## HTTP boundary

Route handlers are retained only for real HTTP contracts: health/readiness, service-to-service callbacks, payment reconciliation and third-party authentication callbacks. A route handler decodes an endpoint-specific request, invokes one use case and presents an endpoint-specific response.

The browser UI does not use internal `/api/bff/*` routes. Those routes are removed as their callers migrate to Server Components and Server Actions.

## Error handling

Adapters translate infrastructure failures into application/domain errors. Application use cases translate those errors into explicit results suitable for the scenario. Views never inspect upstream status codes or provider-specific error payloads.
