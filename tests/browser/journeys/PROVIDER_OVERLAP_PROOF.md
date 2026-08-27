# Dual-image provider overlap proof

This additive proof is deliberately separate from baseline reconciliation and
comparison projection. It never writes under `tests/browser/baselines` and it
does not make a provider-ledger order difference acceptable on its own.

Start two complete, isolated journey Compose stacks with the same current
fixture sources and deterministic build contract. The baseline and candidate
projects must respectively match
`clean-pay-browser-journey-provider-proof-baseline-<12 lowercase hex>` and
`clean-pay-browser-journey-provider-proof-candidate-<12 lowercase hex>`.
Their app, provider-control, CONNECT-proxy, and loopback TLS publications,
application image digests, and source revisions must be distinct. Keep each
generated `browser-journey-contract.json` outside the repository. Then run:

```text
node tests/browser/journeys/prove-provider-overlap.mjs \
  --baseline-contract <absolute-baseline-contract-path> \
  --baseline-control-url http://127.0.0.1:<baseline-control-port>/ \
  --baseline-resolver-ip 127.0.0.<baseline-stack-address> \
  --baseline-image-digest sha256:<baseline-app-config-digest> \
  --baseline-migration-image-digest sha256:<baseline-migration-config-digest> \
  --candidate-contract <absolute-candidate-contract-path> \
  --candidate-control-url http://127.0.0.1:<candidate-control-port>/ \
  --candidate-resolver-ip 127.0.0.<candidate-stack-address> \
  --candidate-image-digest sha256:<candidate-app-config-digest> \
  --candidate-migration-image-digest sha256:<candidate-migration-config-digest> \
  --scenario provider-overlap-v1 \
  --output <absolute-new-path-outside-the-repository>.json
```

Before either reset POST or either browser action, the orchestrator validates
both stacks concurrently. A reusable import-safe reader renders the exact two
Compose files with the contract directory's authoritative `.env`, then matches
all 13 services, four volumes, and the single project network to live Docker
inspection. It binds exact project/service labels, container cardinality,
names, app and migration config digests, helper RepoDigests, OCI revision/role/
public-build labels, commands, entrypoints, base-image-plus-Compose environment,
user, working directory, healthcheck, restart/one-shot state, sandbox/security,
resource limits, tmpfs, logging, mounts, network aliases, and loopback-only
ports. Completed CA/provision/migration/grant one-shots must have exited zero;
Postgres and Redis must use the exact project-owned named volumes. Every bind
source has an exact repository realpath, must be consumed by the configured
command, and—when running—has its live bytes SHA-256 checked in the container.
The generated contract's current fixture SHA-256 must equal those live sources
in both stacks. A dual preflight rejects project, network, runtime, image, or
publication aliasing and proves both stacks coexist before execution.

After that single barrier, baseline and candidate execute via `Promise.all`.
Each stack resets only its project-owned disposable data, completes the
synthetic Telegram login to `/profile`, blocks cabinet prefetch, then arms the
exact one-shot `cabinet_read_overlap_once` barrier for one explicit `/cabinet`
document navigation. The pinned Chromium launch arguments, resolver, and
established CONNECT proxy are shared with the journey runner. Only exact
synthetic HTTPS origins and scenario-specific method/resource/path/ordered-
query/hash/status/content-type/redirect classes are allowed; every request is
counted, while build-specific static chunk partitioning is reduced only to
exact JS/CSS/font/image presence classes. Navigation, RSC/action, OIDC,
Turnstile, and Chatwoot semantic counts and order remain exact across images.
Unexpected popup, WebSocket, service worker, request, console output, page
error, proxy failure, or unbounded lifecycle counter fails the proof. The two
referenced offers/devices records must be adjacent, enriched, sanitized ledger
entries.

The output is create-only and requests POSIX mode `0600` where supported. It
contains no cookie values, tokens, request bodies, image references, container
IDs, raw user agent, credentials, host paths, caller-chosen names, or PII. Project,
network, service, fixture-mount, environment, publication, image-reference,
contract, and user-agent identities are represented only by SHA-256 digests,
apart from the two required non-PII role-specific project identifiers.
The serialized reader recomputes all cross-stack and lifecycle invariants; it
does not trust claimed comparison booleans. Failure output is digest-only.

The proof intentionally retains both externally started stacks for subsequent
served-assets and SIGTERM evidence. Its machine-readable lifecycle section has
`automaticCleanup: false` and names the exact ownership-gated handoff:

```text
CLEAN_PAY_BROWSER_COMPOSE_PROJECT=<exact-role-project> \
CLEAN_PAY_BROWSER_JOURNEY_ENV_DIR=<that-project-contract-directory> \
node tests/browser/journeys/run-production-image-journey.mjs cleanup
```

Run the handoff once for each reported role. It inspects exact Compose project
labels before `down --volumes`; it never performs a broad or glob cleanup. The
normal production-image runner separately removes only its known generated
role files in `finally`, removes an empty environment directory only when that
same run created it, and retains a hash-only sanitized contract under
`test-results/browser-journey-contract-evidence`. Caller-owned directories and
unexpected entries are never removed.

Limits: this proof establishes that the offers and devices reads overlapped in
both exact images for one deterministic scenario and browser project. It does
not prove every scheduler interleaving, response completion order, provider
side-effect commutativity, or general order-insensitivity. It must therefore be
retained as sidecar evidence and independently reviewed before any narrowly
scoped comparison projection is proposed.
