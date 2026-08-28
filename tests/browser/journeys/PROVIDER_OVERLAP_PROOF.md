# Dual-image provider overlap proof

This additive proof is deliberately separate from baseline reconciliation and
comparison projection. It never writes under `tests/browser/baselines` and it
does not make a provider-ledger order difference acceptable on its own.

Prepare two isolated synthetic journey contract directories, but do not start
either Compose project. The verifier owns creation and cleanup so no migration,
provision, reset, or browser action can run from caller-started resources. The
baseline and candidate projects must respectively match
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
  --baseline-asset-image-digest sha256:<baseline-app-OCI-root-or-index-digest> \
  --baseline-migration-asset-image-digest sha256:<baseline-migration-OCI-root-or-index-digest> \
  --baseline-asset-attestation <absolute-baseline-production-asset-attestation> \
  --candidate-contract <absolute-candidate-contract-path> \
  --candidate-control-url http://127.0.0.1:<candidate-control-port>/ \
  --candidate-resolver-ip 127.0.0.<candidate-stack-address> \
  --candidate-asset-image-digest sha256:<candidate-app-OCI-root-or-index-digest> \
  --candidate-migration-asset-image-digest sha256:<candidate-migration-OCI-root-or-index-digest> \
  --candidate-asset-attestation <absolute-candidate-production-asset-attestation> \
  --scenario provider-overlap-v1 \
  --output <absolute-new-path-outside-the-repository>.json
```

Before the first `compose up`, the import-safe pair orchestrator validates both
authoritative `.env` files and every role-scoped environment file against a
deterministic allowlist and exact bytes, rejects external PostgreSQL/Redis
targets, hashes the exact repository-contained fixture and Compose sources,
renders both Compose models with a deny-by-default child environment, and proves
both project container/network/volume sets absent. It creates unpredictable,
create-only, run-specific synthetic input snapshots and revalidates them
immediately before starting both projects concurrently. POSIX mode `0700/0600`
is enforced where mode bits are authoritative. On Windows the verifier does not
misrepresent `chmod` as an owner-only DACL: confidentiality instead relies on
the exact synthetic-only/no-external-credential contract, create-only writes,
FileHandle/path identity, and exact cleanup. No caller-prestarted stack is
accepted.

The application asset digest is the OCI root/index digest already bound by the
production asset attestation; its selected-platform config digest comes from
that attestation. The migration argument is likewise an OCI root/index digest,
not the value of `docker image inspect <tag> .Id` treated as a config digest.
For both references, before `compose up`, the verifier creates one uniquely
named and labelled container with `--entrypoint /bin/true`, never starts it,
classifies the Docker store without conflating its identities, rechecks the
mutable tag, and removes only that probe. A classic store must expose the
selected config in the container's `.Image` and is launched by that config. A
containerd store must expose the attested OCI root in `.Image` plus an exact
attested Linux/amd64 or Linux/arm64 image manifest in `.ImageManifestDescriptor`;
an arm64 descriptor may additionally carry only `variant: v8`. Both A/B images
must use the same attested platform, and each is launched only by its OCI root.
When that root is itself a single-image manifest, its digest must equal the
selected manifest digest. The application manifest must equal the production asset
attestation, while the migration root/manifest pair is captured by the first
probe and must be reproduced by the pre-launch probe and live runtime. A
containerd migration root is never reported as a config digest. Every probe
name and ownership label includes
a cryptographically unpredictable per-run nonce; only its SHA-256 ownership
contract enters the sanitized input receipt. Thus a concurrent verifier with
the same project contract cannot be adopted or removed during create-error
recovery. The generated launch snapshot replaces both
tags with the verified classic config IDs or containerd OCI roots, so a later
tag retarget cannot change what Compose starts. A present Descriptor must equal
the attested root and cannot be
masked by a stale RepoDigest. If a classic store exposes no Descriptor, only an
exact validated RepoDigest for the inspected repository/reference may establish
the root. A store exposing neither authority is an explicit fail-closed platform
blocker; `.Id` is never accepted as an OCI root substitute. The resulting
mode/root/manifest/config/reference contracts are bound into runtime evidence.
All application/migration and baseline/candidate pre-launch rechecks settle and
remove their exact probes before any failure can begin stack or snapshot cleanup.

After startup, a reusable import-safe reader matches
all 13 services, four volumes, and the single project network to live Docker
inspection. It binds exact project/service labels, container cardinality,
names, exact classic-config or containerd-root/manifest selections, helper
RepoDigests, OCI revision/role/
public-build labels, commands, entrypoints, base-image-plus-Compose environment,
user, working directory, healthcheck, restart/one-shot state, sandbox/security,
resource limits, tmpfs, the actual daemon default or explicit logging policy,
mounts, network aliases, and loopback-only ports. Completed CA/provision/
migration/grant one-shots must have exited zero with `RestartCount=0` and an
exact bounded `create -> start -> die` event ledger after the verifier launch
boundary;
Postgres and Redis must use the exact project-owned named volumes. Every bind
source has a platform-correct exact realpath, must be consumed by the configured
command, and has verifier-created source bytes bound before and after startup;
when running, its live bytes SHA-256 is also checked in the container.
For the completed observer-provision one-shot, the evidence additionally binds
the immutable pre-start source SHA-256, exact read-only mount, exact
entrypoint/command digest, and exact create/start/die lifecycle digest; it does
not pretend a stopped container was live-executed for inspection.
The generated contract's current fixture SHA-256 must equal those live sources
in both stacks. A dual preflight rejects project, network, runtime, image, or
publication aliasing and proves both stacks coexist before execution. Its
canonical launch receipt binds the two complete input-receipt hashes and exact
ordered project dispatches to one recomputed barrier. The coexistence receipt
then lists all 13 exact service names, hashed container identities, and fixed
healthy/running/exited-zero states for each project; a stopped stray container
or service substitution cannot satisfy it. The complete 26-container identity
union must also be disjoint across projects; changing one set hash cannot hide
cross-project identity reuse.

After that single barrier, baseline and candidate execute via `Promise.all`.
Each stack resets only its project-owned disposable data, completes the
synthetic Telegram login to `/profile`, blocks cabinet prefetch, then arms the
exact one-shot `cabinet_read_overlap_once` barrier for one explicit `/cabinet`
document navigation. The pinned Chromium launch arguments, resolver, and
established CONNECT proxy are shared with the journey runner. Only exact
synthetic HTTPS origins and scenario-specific method/resource/path/ordered-
query/hash/status/content-type/redirect classes are allowed; every request is
counted. A shared pure envelope helper treats Playwright `Request.frame()` as
the initiating frame: `isMainFrame` is true only for a navigation request whose
target is the page main frame. CSS, JavaScript, RSC, and fetch requests initiated
by that frame remain non-navigation resources and cannot be rejected as false
main-frame navigations. Each image has an exact raw semantic/static request-order ledger and
three fixed document-generation ledgers for login, profile, and cabinet. A
static path may legitimately recur once in each generation, but cannot be
duplicated within a generation, omitted, moved to a different generation, or
added outside that document's attested route/response graph. Every occurrence
is bound byte-for-byte to the validated OCI inventory. After each occurrence's
response finishes, its actual decoded body bytes, byte length,
extension-specific content type, and path are independently observed and must
equal the OCI inventory. Repeated CSS bodies are parsed independently; every
later extraction must equal the first extraction for that source, while the
sanitized global CSS closure records the unique source contract once. The
bounded HTML/RSC declaration parser uses fatal UTF-8 decoding, exact byte/count
bounds, longest-first WOFF2/WOFF matching, a canonical token boundary, path
normalization, exact inventory membership, and paired raw `"path"` or Next
inline-Flight `\"path\"` quotes. Unknown, external, prefixed, partial, suffixed,
entity-encoded, mixed-quote, or otherwise unsafe declarations fail closed. The bounded inventory
accepts only CSS/JavaScript chunks and canonical EOT/ICO/PNG/SVG/TTF/WOFF/WOFF2
media. All eight current bounded CSS `url(...)` fallbacks are resolved from the
exact served CSS path with the exact EOT/SVG/TTF/WOFF/WOFF2 cardinalities;
external, data, absolute, escaping, unknown, or absent-in-inventory references
fail closed. All declared fallbacks remain attested, while each document must
load the same exact two distinct CSS-declared WOFF2 targets selected by pinned
Chromium. Raw chunk names and
partition counts are intentionally not compared
between different images, but no inventory-only or undeclared extra chunk can
pass. Navigation, RSC/action, OIDC, the exact `auth_login` Turnstile action, and
Chatwoot semantic counts and order remain exact across images.
Unexpected popup, WebSocket, service worker, request, console output, page
error, proxy failure, extra CONNECT/reconnect, history/query/hash mutation, or
unbounded lifecycle counter fails the proof. The exact four CONNECT authorities
(`challenges.cloudflare.com`, `chatwoot.browser.clean-pay.dev`,
`oauth.telegram.org`, and `pay.ci.clean-pay.dev`, each on port 443) and their
cardinality are recorded and recomputed, not only an aggregate counter. The
browser first drains every mutable source to a quiet barrier, seals routing,
builds the request projection, snapshots all raw ledgers, closes Chromium while
listeners remain attached, and rejects any late close event before detaching.
The successful sealed event count is recomputed as exactly three observations
per request (`request`, route begin, and exactly one finished/failed event) plus
the four fixed history observations. The runner uses a bounded 1,024-event seal,
which covers the declared 256-request maximum (772 causal events) without
weakening overflow handling. A rejected page binding is retained as sticky
failure state even after its Promise settles; no mirrored unhandled rejection
or empty pending-set snapshot can make the explicit drain pass.
History evidence is taken from pinned Chromium CDP `Page.frameNavigated` and
`Page.navigatedWithinDocument`, correlated to the final `Page.getFrameTree`
main-frame/loader identity and the exact cabinet document response. The raw
profile checkpoint, changed-loader cabinet document navigation, one Next
`replaceState` state transition, and its paired `historyApi` same-document
signal canonicalize to exactly four entries; only the delivery order of the
last two signals may vary. The sole cabinet document navigation must add exactly
one session-history entry relative to the profile checkpoint, and hydration must
then preserve that length. Query/hash mutations, extra history calls, a reused
loader, a different frame, replaced/decremented history length, or an unmarked
Next state fail closed. CONNECT counters and that canonical history operation ledger must
be identical across images. The two referenced offers/devices records must
be adjacent, enriched, sanitized ledger entries.

The import-safe output writer uses a create-only `FileHandle`, fsync, stable
device/inode/path/byte checks, and exact failure cleanup. If the first post-open
identity read fails, cleanup retries identity through the still-open handle and
unlinks only that proven device/inode/path; if identity remains unknowable it
fails stop and preserves the residue rather than deleting by pathname. It
enforces POSIX mode
`0600` where mode bits are
authoritative. Windows makes no owner-only DACL claim; the output has already
passed the exact serialized sanitized schema and contains only the synthetic
evidence projection before its create-only write. It
contains no cookie values, tokens, request bodies, image references, container
IDs, raw user agent, credentials, host paths, caller-chosen names, or PII. Project,
network, service, fixture-mount, environment, publication, image-reference,
contract, and user-agent identities are represented only by SHA-256 digests,
apart from the two required non-PII role-specific project identifiers.
The serialized reader recomputes all cross-stack and lifecycle invariants; it
does not trust claimed comparison booleans. Failure output is digest-only.
The contract suite also drives the real pair entry point through two complete
13-service Docker API mocks: both immutable preparations cross one same-turn
launch barrier, both runtime/coexistence receipts feed the real report factory
and serialized reader, and both exact project/snapshot cleanups must finish.
That test exercises orchestration without starting Docker or a live stack.

The pair orchestrator always performs ownership-gated `down --volumes` for the
two exact projects in its internal `finally`, including partial-start and proof
failure paths. It then removes only the exact files it created and only its empty
owner-specific directories—never a glob, recursive target, caller-owned input,
or unrelated resource. Directory setup and create-only file writes are journaled
before their fallible identity postchecks; a transient setup/post-write failure
recovers only allowlisted entries from that unpredictable create-only directory.
If exact directory/file identity cannot be re-established, cleanup fails closed
and preserves the residue for diagnosis. Docker CLI timeout/overflow handling
sends bounded TERM/KILL signals but never releases stack cleanup merely because
a timer elapsed: it waits for stream close or repeated OS confirmation that the
exact child PID no longer exists. CONNECT proxy termination uses the same
close-or-exact-PID-absence rule; an unverifiably live child remains fail-stop
while bounded checks and kill retries continue. The create-only proof is written only after both absence
checks and directory cleanups succeed. Its lifecycle section includes sanitized
per-role project and generated-directory hashes plus the exact cleanup receipts;
the serialized reader recomputes their association with each stack.

Logging residual: Docker exposes the active daemon driver and each container's
effective `HostConfig.LogConfig`, which this proof checks exactly against the
rendered Compose policy. Docker does not expose a portable complete attestation
of every daemon-wide default logging option through this contract, so such
defaults remain an explicitly reviewed host-policy residual rather than being
claimed as proven here.

Limits: this proof establishes that the offers and devices reads overlapped in
both exact images for one deterministic scenario and browser project. It does
not prove every scheduler interleaving, response completion order, provider
side-effect commutativity, or general order-insensitivity. It must therefore be
retained as sidecar evidence and independently reviewed before any narrowly
scoped comparison projection is proposed.
