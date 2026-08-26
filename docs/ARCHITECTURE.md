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

Production composition modules live only under `src/app/_composition`. Backend
integrations never import a backend composition directory or an application
use-case implementation. When an infrastructure workflow needs an
application-owned decision (for example Telegram session recovery), the app
composition root passes the narrow dependency contract explicitly into every
runtime gateway; the adapter fails closed if that wiring is unavailable. No
mutable process-global registration is used, so cold entrypoints are safe.

Every application port must be consumed by an application use case. Technical helpers that merely forward a call to one concrete repository are not use cases and must stay in the outer adapter layer. Backend adapters may import application ports and models, but never an application use-case implementation; production use cases are composed only in `src/app`.

Authentication policy belongs to `src/application/auth`: human verification and rate-limit ordering, registration fallback, session establishment, verification dispatch, password-reset session replacement and success auditing are application decisions. The backend authentication gateway exposes granular provider and persistence operations and translates provider failures into application-owned errors.

Telegram callback and WebApp authentication follow the same rule: account-link/merge/recovery branching, redirect selection, identity-verification ordering and session-recovery decisions live in application use cases. Telegram/Remnashop adapters expose only granular verification, provider and persistence operations; a single adapter method must not implement an end-to-end authentication scenario.

E-mail verification/change, password change and linked-account workflows follow the same boundary. Retry/fallback order, actor revalidation, merge preflight interpretation, post-confirm synchronization and account-merge state transitions belong to `src/application`; backend gateways expose provider calls, atomic persistence transitions, locks and session-cookie operations only. Historical end-to-end implementations must not be reachable from `src/app` composition roots.

Current-profile resolution is also an application query. Selection between a local and provider profile, recoverable fallback, verified-email reconciliation and readiness classification live in `src/application/auth/resolve-auth-profile.ts`. The production gateway only reads session/provider data and performs the explicitly requested atomic confirmation or cookie refresh. Cabinet, navigation, checkout, profile, linked-account and verification screens compose this same query at the `src/app` boundary.

Passkey registration and management authorization is application policy. Gateways report the current actor and assurance level; application use cases decide whether full assurance and account access are sufficient before listing, registering or deleting credentials. Infrastructure owns WebAuthn SDK calls and atomic credential persistence, including the invariant that the final credential cannot be deleted.

Payment dispatch ordering, offer revalidation, idempotency state transitions and uncertain-outcome handling are owned by `src/application/payments/execute-payment-workflow.ts`. The backend payment adapter supplies only provider, persistence, session, rate-limit and audit capabilities through an opaque application port.

Payment status/history refresh and maintenance batches are application workflows as well. Claim processing, provider fallback, stale-history behavior, reconciliation outcomes and batch continuation decisions stay in `src/application/payments`; backend adapters expose fenced transitions, provider reads and persistence primitives.

## HTTP boundary

Route handlers are retained only for real HTTP contracts: health/readiness/metrics, service-to-service callbacks, payment reconciliation and third-party authentication callbacks. A route handler decodes an endpoint-specific request, invokes one use case and presents an endpoint-specific response. Internal readiness and Prometheus metrics endpoints use the same dedicated service secret and are never exposed as browser API contracts.

The browser UI does not use internal `/api/bff/*` routes. Those routes are removed as their callers migrate to Server Components and Server Actions.

## Infrastructure module boundaries

Large provider adapters are split by responsibility while retaining narrow compatibility facades. Remnashop HTTP transport and DTO normalization, Telegram session recovery and provider authorization are separate modules. Payment idempotency keeps operation contracts and persisted snapshots separate from orchestration. Web-session token handling, creation policy and revocation are likewise independent from the public session service. These modules may collaborate, but must not recreate application workflows inside infrastructure.

Operational metrics use bounded, normalized labels. Request IDs and W3C trace context are propagated to upstream HTTP calls where available; secrets, raw user identifiers and unbounded error text must never become metric labels or log fields.

## Error handling

Adapters translate infrastructure failures into application/domain errors. Application use cases translate those errors into explicit results suitable for the scenario. Views never inspect upstream status codes or provider-specific error payloads.
