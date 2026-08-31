# Browser characterization

The suite targets an externally managed, disposable production runner through
`CLEAN_PAY_BROWSER_BASE_URL`. It never starts or mutates an application stack.
Use the repository-local Playwright binary and the pinned Chromium installed
for `@playwright/test` 1.62.1.

Every public and anonymous protected-route case records a viewport PNG plus a
canonical JSON contract containing DOM, selected computed styles, ARIA, link
and button state, redirects, cookies/storage, and a redacted network manifest.
Console output and `pageerror` events fail the case. Credentials, payloads,
storage values, cookie values, dynamic request identifiers, and external URLs
are redacted or represented by a SHA-256 digest and byte count.

Known third-party console output may be reviewed and made explicit with
`CLEAN_PAY_BROWSER_EXPECTED_CONSOLE_SHA256`, a comma-separated list of exact
`<console-type>:<sha256>` fingerprints from the redacted diagnostics. The
default is empty, malformed or duplicate entries fail configuration, and the
configured allowlist plus every observed match are part of the immutable JSON
contract. `pageerror` has no allowlist.

The two static PWA routes have a separate `console.json` contract. It accepts
only Chromium's exact CSP diagnostic grammar for same-origin
`/_next/static/chunks/<opaque>.js` and inline scripts, with the exact current
`script-src` source order. Only a 32-hex nonce, a 44-character inline SHA-256,
and the opaque chunk filename are normalized. Kind, template, count, order,
and redacted location remain immutable; the sidecar is empty for other routes.
Any other console text still fails. Baseline reconciliation runs only after
the console and `pageerror` listeners are stopped and their deny-by-default
gate has passed, so a failed case cannot publish a new baseline artifact.

The first capture below
`tests/browser/baselines/f5cb6f543d85256e7733a1ade6a4f451d86cf378`
is retained as immutable forensic evidence. Its metadata marks it
`invalid_for_gate`: the live Turnstile provider produced multiple DOM/PNG
states and Next emitted timing-dependent prefetch teardown records. No raw
file in that set is overwritten or deleted.

The first deterministic sibling, `-deterministic-v1`, is also retained but its
`supersession.json` marks it `invalid_for_gate`: parallel Chromium workers
introduced small GPU antialias differences and timing-dependent static
resource state. The serial `-deterministic-v2` sibling removed parallelism but
later read-only runs proved that hardware Skia raster could still differ by
one or two channel values across Chromium processes. Its raw files, metadata,
and v4/v5 policies remain immutable; `supersession-v3.json` marks it
`invalid_for_gate` with sanitized evidence.

The one-flag `-deterministic-v3` capture is retained with unchanged raw files,
metadata, and inventory. Its new `supersession-v4.json` marks it
`invalid_for_gate`: `--disable-gpu` alone still admitted cross-process text
raster variance.

The seven-flag `-deterministic-v4` capture is also retained byte-for-byte.
Its `supersession-v5.json` records the second independent read-only run that
found 33 differing pixels (60 channels, maximum delta 2) only in the lower
antialiased card corners while DOM, boxes, styles, ARIA, state, routes, and
projected network remained exact. It is therefore `invalid_for_gate`; no
pixel tolerance or masking was introduced.

The canonical gate is `-deterministic-v5`, recaptured from the same pristine
f5cb commit/tree/archive and exact production-image digest. It runs with one
worker, `fullyParallel: false`, and the exact Chromium launch arguments
`--disable-gpu`, `--disable-gpu-compositing`, `--disable-gpu-rasterization`,
`--disable-skia-runtime-opts`, `--disable-lcd-text`,
`--disable-font-subpixel-positioning`, `--font-render-hinting=none`, and
`--disable-oop-rasterization`. The final flag is the smallest bounded fix:
the seven-flag control still produced both PNG hashes, while 48 independent
Chromium processes with in-process raster produced one byte-identical hash
per viewport. Two subsequent full read-only runs each passed 108/108.
This is a deterministic renderer policy, not a pixel tolerance: PNG comparison
remains byte-for-byte exact. Before every navigation the gate intercepts only
the exact Cloudflare Turnstile script URL and only an exact GET script request.
The callback-free stub exposes render, reset, and remove, creates no token, and
leaves the challenge pending. Every URL/method/resource-type near miss
continues to the network.

The immutable v5 baseline and its eight launch arguments remain unchanged.
The production-image live paired A/B gate additionally pins
`--num-raster-threads=1` on both the pristine baseline and candidate browser
processes. This targets a later in-process scheduling edge observed in CI run
`33346935619`: the candidate was byte-identical in all three processes and one
baseline process matched it exactly, while the other two baseline processes
differed only at 13 and 17 rounded-card edge pixels (maximum channel delta 1
and 2). The live policy still compares raw PNG bytes exactly and retains the
same three independent process pairs; it introduces no retry, tolerance,
masking, normalization, or baseline update.

Raw PNG and JSON evidence is always retained. JSON equality uses a separate
comparison projection that retains every external request, including the
exact Turnstile-stub request count and position, while normalizing only its
route-fulfilment timing. It removes automatic non-Server-Action Next RSC prefetches with the exact digests of
`next-router-prefetch: 1` and `rsc: 1`. It normalizes only the exact digest of
`net::ERR_ABORTED` for a non-navigation application GET resource when a
response is already present. Retained request order and Server Action or
redirect references are reindexed. Successful same-origin WOFF2 values are
sorted only within their existing font-resource positions, retaining all
records, headers, status and positions of every non-font record. Static PWA
chunk transport records are projected only for the exact `/install` and
`/offline` CSP sidecar contract. Tests keep route, method, navigation,
Server-Action/RSC, path, query, status, failure, origin and resource-type near
misses fail-closed.

The candidate-only semantic projection covers only the approved accessibility
diff: the exact offscreen skip link and main target, six exact cabinet
`h5`-to-`h2.text-xl` headings, three exact decorative logo alternatives,
passkey delete names under the exact passkey item, and the bounded PrimeReact
English/Russian ARIA locale labels on PrimeReact-signed elements. ARIA target
counts must agree with the exact DOM targets. Because the original style
selector did not include `h5`, a newly selected cabinet `h2` style record is
projected only after its complete captured 20px/500/24px visual contract
matches. PNG bytes remain exact in the normal state; only keyboard focus may
make the exact skip link visible. Every near miss remains observable.

The retained canonical capture used three immediate PNGs after the existing
load, `document.fonts.ready`, double-animation-frame, and network-idle settling
sequence. The read-only candidate gate now acquires one raw PNG in each of
exactly three independently launched Chromium processes. Each route receives a
fresh context in every process. At least two full PNG files must be
byte-identical; those unchanged majority bytes become the manifest hash and
compared artifact. Three distinct PNGs fail closed before reconciliation. The
selection function accepts no baseline path or baseline bytes.

This process quorum is restricted to the exact six public and eight anonymous
protected-route GET characterizations. Before navigation it denies every
non-GET, every `Next-Action`, and every external request except the exact
credential-free Turnstile script GET handled by the pinned local stub. The
guard is installed on each fresh context before its only page exists; an extra
page, WebSocket, Service Worker, or Service-Worker-owned request is a failure.
After capture, requests drain while the recorder remains attached, then the
context is sealed against all new traffic and closed with a bounded checked
teardown before baseline reconciliation. A sanitized raw guard sidecar is
attached for every process. The raw PNG and manifest from every process are
attached, as is each final console sidecar and a hashes-only quorum record. All
three projected non-PNG manifests and all three exact console sidecars must
agree before baseline reconciliation.
Authenticated journeys are never replayed by this mechanism. There is no pixel
tolerance, masking, channel normalization, perceptual comparison, baseline
lookup, or retry that can turn different pixels into a match.

Normal mode is read-only. Missing or different canonical artifacts fail and
leave both sets untouched. Initial canonical creation additionally requires
`CLEAN_PAY_UPDATE_BASELINE=1` while `HEAD` is exactly
`f5cb6f543d85256e7733a1ade6a4f451d86cf378`. Existing artifacts are
immutable: update mode may add a missing artifact but never replace one.

The canonical and forensic `metadata.json` files record their status, source
commit/tree/archive and production-image digests, pinned Playwright/Chromium
revision, forensic aggregate hash, deterministic stub contract/hash, and the
comparison policy. They contain no tokens, request values, cookies, or PII.
Serial raw v2 files and metadata remain immutable. The immutable
`comparison-policy-v4.json` sidecar records the later exact font-order and
candidate semantic rules plus the aggregate digest of the 126 original raw
PNG/JSON/console artifacts; it does not replace or rewrite any raw evidence.
The immutable `comparison-policy-v5.json` sidecar carries v4 forward and
records the byte-identical 2-of-3 screenshot acquisition rule and its
sanitized raster-variance evidence. V2 raw files, metadata, and v4 are never
modified. Retained v3 `metadata.json` and `artifact-inventory.json` pin its
lineage and 126 raw artifacts to aggregate SHA-256
`7fff96da71cbedb8f3492f727e0fa9abc0921ab964c2e249a0300a8bb608c7df`.
Retained v4 metadata records its exact seven-flag renderer and 36-process
pre-capture probe. Its inventory pins 126 raw artifacts to aggregate SHA-256
`6a07c966ca2fca8cc71c913e3a084067f645072ad8105d5894f4899f114f040c`.
Canonical v5 metadata records the exact eight-flag renderer and 48-process
probe. Its inventory pins 126 raw artifacts to aggregate SHA-256
`bf449337e7222adc093f9adb7c1b3d7f2c122af74720bf1e1dfacb34fb69f4c3`;
metadata and inventory SHA-256 are respectively
`51bcec0733718ca1dec9672fb3a60ae1ee26f8c018626bedc4d1953501478255`
and `99f537efdace707a2c439cfb906cf078c537ae1f9d65ab13a2e4fdb60c6e34ba`.

## Coverage boundary

The canonical deterministic-v5 suite above remains the immutable
public/anonymous gate: six public routes and eight anonymous protected-route
redirects at three viewports. Authenticated behavior is a separate sibling,
`<commit>-journey-v5`, so its synthetic mutations and provenance cannot alter
the 126 public raw artifacts.

The sibling harness runs six serial journeys at 390x844, 768x1024, and
1440x900 against a production image. It exercises register/verify/login,
Telegram OIDC and Telegram WebApp, cabinet/profile/referral/link-account and
real merge confirmation, Passkey registration plus logout/login, tariffs,
payment return states and extend, Chatwoot iframe identity confirmation,
Turnstile render/challenge/reset/remove, PWA install lifecycle, production
service-worker offline fallback/recovery, and responsive/keyboard states.
It captures 35 PNG checkpoints per viewport plus DOM/styles/ARIA,
cookies/storage, navigation chains, a redacted HAR 1.2 document, Server Action
count/order/payload digests, provider ledgers, and table-name/count-only DB
snapshots.

Every browser case starts by transactionally truncating only the application
tables in its own disposable Compose Postgres (the locked schema has no
sequences) and flushing only DB 0 of its own Redis. A dedicated synthetic
observer role has only CONNECT/USAGE, table SELECT/TRUNCATE, and sequence
privileges; bootstrap credentials are confined to its one-shot provisioner.
Provider/OIDC state is reset with a project-and-journey scenario
digest. Baseline and candidate therefore use the same synthetic seed without
sharing state. No external provider, secret file, real account, or real PII is
read. The final canonical directory is atomically published from a unique
staging directory only after all browser and contract cases pass; a failed
attempt leaves no partial canonical baseline.

The repository-local commands are:

```powershell
npm run test:browser:journey -- --project journey-contract
npm run test:browser:journey:production-image
```

The production-image command requires exact non-secret image provenance,
unique project and port variables documented by `prepare-synthetic-env.mjs`.
It uses the locked Playwright binary, creates only its named Compose project,
and verifies exact labels before its `down --volumes` cleanup. CI uses this
same command after building the runner and migration targets; it does not use
`npx`.

An additive cabinet asset sidecar can be generated while the exact baseline
and candidate application images are live on two distinct loopback ports.
First generate one immutable static-asset attestation for each image with
`scripts/security/attest-production-image-assets.mjs`. Then run:

```powershell
npm run evidence:served-cabinet-assets -- `
  --baseline-attestation <baseline-attestation.json> `
  --baseline-base-url http://127.0.0.1:<baseline-port>/ `
  --baseline-image-digest <baseline-sha256-digest> `
  --baseline-revision <baseline-40-hex-revision> `
  --baseline-fixture-sha256 <pinned-journey-v5-fixture-sha256> `
  --candidate-attestation <candidate-attestation.json> `
  --candidate-base-url http://127.0.0.1:<candidate-port>/ `
  --candidate-image-digest <candidate-sha256-digest> `
  --candidate-revision <candidate-40-hex-revision> `
  --candidate-fixture-sha256 <candidate-journey-v5-fixture-sha256> `
  --fixture-version journey-v5 `
  --public-build-contract-version 1 `
  --public-build-contract-sha256 <exact-common-contract-sha256> `
  --platform linux/amd64 `
  --output <new-proof.json>
```

The command accepts only loopback origins, refuses redirects, omits browser
credentials, and fetches only the bounded chunk paths declared by the exact
`/cabinet/page` image manifests. Its create-only JSON contains paths, status,
content type, sizes, and SHA-256 values, never response bodies. It proves the
identical 16-module closure and different chunk partition but is deliberately
not a behavioral-comparison projection.

Read-only candidate A/B from this repository on Windows PowerShell:

```powershell
$env:CLEAN_PAY_BROWSER_BASE_URL = "http://127.0.0.1:<candidate-port>"
Remove-Item Env:CLEAN_PAY_UPDATE_BASELINE -ErrorAction SilentlyContinue
Remove-Item Env:CLEAN_PAY_BROWSER_EXPECTED_CONSOLE_SHA256 -ErrorAction SilentlyContinue
node node_modules/playwright/cli.js test --config playwright.config.ts
```
