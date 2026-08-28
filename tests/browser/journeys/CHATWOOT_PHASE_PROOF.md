# Dual-image Chatwoot phase stability proof

This additive sidecar proves the asynchronous Chatwoot cookie lifecycle without
changing production code, the immutable journey baseline, the Caddy fixture,
or the baseline comparison path. It is not an alternate acceptance path for a
failed journey comparison.

The input is a launch plan for exactly three fresh disposable A/B pairs:
3 baseline + 3 candidate stacks. It does not accept externally started stacks
or a post-start ownership assertion. Each caller-owned external generated
environment already exists and contains the immutable journey contract; it is
attested before launch, re-read after capture, and is never deleted by this
proof. Every planned stack instead has its own absent Compose project and a
separate absent proof-owned role-environment snapshot directory, project
network, database, Redis, publications, CONNECT endpoint, and fresh Chromium
process/context.
All six stacks use the same deterministic scenario, fixture contract, public
build contract, locale, timezone, viewport, renderer arguments, and synthetic
host allowlist.

Pairs run sequentially to keep peak resources bounded. Inside one pair, the
shared proof-owned launcher first proves both exact projects and generated
snapshot directories absent, creates the exact role-environment bytes,
validates the
Compose model, starts baseline and candidate concurrently, and issues a
non-transferable pre-start receipt bound to the resulting live attestation.
Only that receipt can authorize reset and capture. Both exact owned projects
are cleaned in the launcher's `finally` before the next pair starts. At most
two stacks are live at once, while the final proof still requires six distinct
project/runtime/run scopes.

Before that pair's first destructive one-shot, reset POST, or browser launch,
the proof-owned launcher and runner perform the complete two-stage gate. The
pre-start stage binds the input plan, exact synthetic role-environment bytes,
Compose model, project absence, and generated-path absence. The post-start
stage binds exact Compose ownership for the complete stack, service health,
network membership, loopback publications, application and migration image
identities, OCI revisions, generated role environments, and the live read-only
bytes of every fixture mount. Any shared project, network, publication,
resolver address, container, environment directory, prior report binding, or
unexpected same-host browser route fails closed before reset or capture.
The immutable pre-start receipt and live runtime binding also carry the exact
Compose source/rendered model, fixture-mount bytes, one-shot lifecycle,
role-environment contract and policy, generated directory, project, network,
service identity, publications, and production static-asset attestation and
inventory digests. Receipt-to-runtime and cleanup-to-runtime relations are
recomputed by the proof contract rather than trusted as result flags.
Before any stack launch, a separate read-only evidence-output preflight proves
the requested absolute target absent, canonical, outside the repository and
filesystem root, beneath an exact non-link directory, and disjoint from every
caller-owned environment. Its parent and input-directory identities are
rechecked immediately before create-only publication.

The browser barrier is only a Playwright `context.route` hold. The first
Chatwoot `/widget` document request passes unchanged. A replacement request is
recognized by the existing single `cw_conversation` query key, exact Chatwoot
origin/path/method/resource type, and child-frame navigation. Its HTTP request
is held; no message event is created or modified and Caddy continues to emit
the real trusted `loaded` event after release.

Each fresh process captures these causal points:

1. **Gap (G):** the replacement request is held, pending state is
   `waiting_for_frame`, `cw_conversation` is present, `cw_user_*` is absent,
   the SDK identifier was retired, and the persisted ownership fingerprint
   matches the in-memory conversation.
2. **Stable (S):** the unchanged request is released, one later `setUser` and
   trusted confirmation complete, the same conversation remains, `cw_user_*`
   exists, and pending state is resolved.
3. **Cleared:** the existing exact synthetic logout helper clears application
   local storage and the complete browser cookie jar. Its single validated
   Turnstile session ledger is preserved byte-for-byte and represented only by
   an HMAC, byte length, and equality relation, exactly as in journey-v5.
   Immediately before that physical clear, the current document's causal and
   automatic-history queues are drained and atomically sealed. The post-clear
   transition drains the same sealed queues again before marking the logical
   clear boundary, so a late `setUser`, confirmation, document event,
   `replaceState`, or `hashchange` in the physical-to-logical clear window
   fails instead of being reclassified as harmless pre-clear evidence.
   The next navigation receives a fresh per-document collector while retaining
   the already-marked global causal state.
4. **Recreated:** the exact ordinary
   `/login?redirect_to=%2Fcabinet` Telegram flow reaches `/cabinet` without an
   intermediate profile document. A document-start observer proves both
   cookies absent on login and cabinet entry. The first real cabinet
   `setUser` proves the user cookie still absent (the conversation-cookie
   presence is recorded, not assumed), and a separate bounded observer proves
   the real `identity.confirmed` event and eventual cookie pair afterward.

The JSON proof never contains a user identifier, cookie value, credential,
request body, host path, container ID, or PII. It stores booleans, bounded
counts, byte lengths, equality relations, image/revision digests, and HMACs.
One fresh proof-scoped HMAC key is shared by the six captures and never
persisted, so corresponding evidence can be compared without disclosing it.
Raw PNGs are synthetic and written only to the new owner-readable evidence
directory.

That memory-only key is an explicit trust boundary: the running verifier can
prove all six order-sensitive HMAC equalities, while an offline reader cannot
recompute those HMACs after process exit. Offline verification is intentionally
limited to the exact JSON schema and recomputed proof invariants, image and
revision digests, raw 1440x900 PNG byte hashes, and the create-only aggregate
manifest. The artifact never substitutes an unkeyed raw canonical ledger,
because persisting that ledger could disclose synthetic identifiers or cookie
values.

At Gap, Stable, and Recreated, each process also captures bounded canonical
DOM, computed styles, accessibility tree, interactive/button state, storage,
raw request order, Server Action count/order/payload/status, Chatwoot boundary
calls, and provider ledger/effect order. Corresponding HMACs must agree across
all three baseline processes, all three candidate processes, and cross-image.
The complete automatic/manual history lifecycle is separately reduced to an
exact entry count, initial/recreated partition, single generation boundary,
and canonical semantic digest. That history projection also agrees 6/6 and
contains no role-specific static provenance; an extra `replaceState`,
`hashchange`, navigation, or checkpoint changes the proof.
Generated journey values may be converted only by the existing exact
referential-symbol contract; there is no new field drop, sorting, or request
reordering. Cookie/contact values remain represented only by byte lengths and
within-run equality relations.
Role-specific static-asset attestation, inventory, and load-graph digests are
kept in a separate provenance binding and must match that role's preflight and
runtime attestation in all three runs. They are deliberately not inserted into
the cross-image semantic request HMAC: baseline and candidate image
attestations must be distinct, while their projected request/order semantics
must be equal. Removing or changing either provenance relation fails closed.
The full sanitized static ledger is retained for offline recomputation. The
initial generation is exactly `[login, profile, cabinet]`; the recreated
generation is exactly `[login, cabinet]`. Every static response must complete
through `finished()`, then its bounded body is read twice byte-for-byte and
bound by length, digest, content type, resource class, active document, and OCI
inventory entry. HTML and RSC declaration bodies are likewise read twice under
the five-second bound and passed to the shared canonical parser, which accepts
only paired raw double-quoted paths and exact JSON-escaped inline Flight paths;
external/local prefixes, URI suffixes, entities, or mixed quote forms fail.
CSS is decoded as fatal UTF-8 and must expose the exact
eight-reference EOT/SVG/TTF/WOFF/WOFF2 fallback closure reconciled with the
route graph. A sanitized per-document response-declaration ledger preserves
the exact `[login, profile, cabinet]` initial partition. The recreated ledger
must equal that initial ledger with only `profile` removed; its login and
cabinet path-digest sets cannot be replaced by the initial three-document
union. Each generation's sorted declaration union is recomputed against its
own static load graph. The offline reader also resolves every declared digest
through the role's inventory, requires each document's route plus
response-declared CSS/JS partition to equal that document's expected chunk
set, and requires its negotiated and CSS-referenced media to remain declared.
Both generation finalizers run again after
`page.close()`, and any late response or changed body fails.
Cross-image comparison preserves the entire occurrence order while projecting
each static occurrence only to its safe class, content type, and document; raw
asset paths, bytes, and image-specific hashes remain role-scoped.

Every visible phase uses one generation barrier around two exact reads of DOM,
computed styles, accessibility, interactive state, browser storage, complete
cookie descriptors, boundary calls, provider ledger, strict browser records,
history, and the existing network/Server Action evidence. Requests,
responses, history and boundary callbacks increment the same bounded in-memory
ledger. A second continuous request lifecycle records structural request order,
redirect ancestry, header names, body byte lengths, Server Action presence,
response status/type, and terminal state, but never stores payload, action, or
query values. Exact payload/action equality remains in the approved
journey-v5 referential projection and proof-scoped HMAC above. This continuous
ledger therefore detects an extra or late action without introducing another
dynamic-value projection. After the recreated page closes, boundary,
diagnostic, automatic/manual history, continuous network, strict browser, and
provider sources are read and compared again, then the common ledger must
remain quiet and clean through its bounded final seal. A late event, in-flight
callback, reordered provider effect, or changed snapshot fails the run.
Provider evidence is decoded by the exact phase sequence rather than by a
service-name allowlist: Gap and Stable require the same complete
Turnstile/Telegram/Remnashop/Remnawave/Chatwoot order, while Recreated requires
the exact second direct-cabinet login suffix and one additional contact probe.
Turnstile, OIDC query/token, and Remnashop Telegram-auth bodies use
endpoint-field descriptor decoders with exact literal, URL, redaction kind,
format, byte-length, and digest shapes. Both synthetic Turnstile challenges
must carry the exact production action `auth_login`; any other action fails.
An arbitrary nested value, numeric
secret, omitted service, extra effect, or contact-only ledger fails closed.
The initial history contract is the shared exact four-record CDP/binding
ledger: profile checkpoint, cabinet document navigation, one `replaceState`,
and its correlated same-document navigation with the final frame/loader
barrier. The post-clear/recreated manual and automatic-history seal is a
separate causal contract and cannot be substituted for those four records.

For every phase and role, one PNG comes from each of the three independent
Chromium processes. A single byte-identical 2/3 majority is required; all three
raw files, including a dissenting file, remain in the create-only inventory.
The selected baseline and candidate PNG must then be byte-identical. Three
different files, two competing majorities, or a cross-image difference fails
closed. All non-PNG phase observations must agree exactly across all six runs.
Each PNG is decoded as an exact 1440x900, non-interlaced 8-bit RGB/RGBA raster;
only `IHDR`, contiguous `IDAT`, and terminal `IEND` chunks are permitted, so
text metadata cannot carry hidden evidence. Evidence ancestors, root, raw
directory, and every file are bound by realpath, device/inode, and live
file-handle identity; the proof-owned immediate parent, root, raw directory,
and files additionally bind change time and size. Finalization reopens all
eighteen PNGs and verifies the exact inventory before writing the proof and
manifest. Serialized phase counts use the same category maxima as the HMAC
sealer and the same cookie, boundary, storage, request, and Server Action
maxima as the live producer; synchronized over-limit values therefore cannot
hide behind 6/6 equality. The complete event generation is capped at 4,096
events, preserved fixture storage at 64 KiB, and each screenshot at 5 MiB.
Every externally decoded array used for execution, cleanup, static paths,
cookie HMAC input, provider tables, history, or query-key evidence must also
own every index; sparse arrays and wrong-typed entries fail before projection
or artifact finalization.
All eighteen bounded PNG buffers stay in memory until all three A/B pairs have
been cleaned and the JSON proof validates. Only then is a new private evidence
root created and populated. A proof, PNG, or manifest publication failure
triggers identity-gated abort of only the exact adopted artifacts; an unknown
or replaced file fails stop and is never deleted. The private evidence parent
is an explicit proof-owner trust boundary: hostile same-owner concurrent path
replacement is outside the local verifier authority, while every observable
identity change is rejected.

Cleanup is owned by the same launcher that performed the pre-start absence
gate; callers cannot substitute a prestarted stack or a cleanup callback. In a
`finally`, it stops each exact CONNECT process and invokes the existing
ownership-gated project cleanup for the two receipt-bound generated contracts
before the next pair. It removes only resources bearing the exact project
label and the exact generated files. Ambiguous ownership fails closed and is
reported without broad cleanup.

The heavy six-stack run is intentionally not part of ordinary unit, lint, or
typecheck commands. Run it only with an approved fresh launch plan and a new
output directory outside the repository. The exact entrypoint is
`node tests/browser/journeys/prove-chatwoot-phase-stability.mjs --plan
<absolute-external-plan.json> --output <absolute-new-evidence-directory>`.
The plan is a bounded regular non-symlink JSON file outside the repository;
its path, realpath, device/inode, change time, size, and live
FileHandle are checked across two identical positional reads before parsing.
It contains exactly three pair records using the input schema enforced by
`assertChatwootPhaseInput`, and it must not contain credentials or PII. The
command emits only sanitized digests/counts on success and an error class plus
message digest on failure. The committed contract tests
exercise the schema, pre-clear and post-clear causal invariants, common
request pending/late-event lifecycle, every boundary method, automatic history
validation, endpoint-specific provider decoding, descriptor-only cookie HMAC,
byte quorum, pre-start receipt, immutable FileHandle input, input envelope,
near misses, partial-create cleanup, write-once policy, and cleanup association
without starting Docker or issuing a reset.
