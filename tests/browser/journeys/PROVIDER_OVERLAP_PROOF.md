# Dual-image provider overlap proof

This additive proof is deliberately separate from baseline reconciliation and
comparison projection. It never writes under `tests/browser/baselines` and it
does not make a provider-ledger order difference acceptable on its own.

Start two complete, isolated journey Compose stacks with the same current
fixture sources, deterministic build contract, and different project names,
ports, loopback TLS resolver addresses, application image digests, and source
revisions. Keep each generated `browser-journey-contract.json` outside the
repository. Then run:

```text
node tests/browser/journeys/prove-provider-overlap.mjs \
  --baseline-contract <absolute-baseline-contract-path> \
  --baseline-control-url http://127.0.0.1:<baseline-control-port>/ \
  --baseline-resolver-ip 127.0.0.<baseline-stack-address> \
  --baseline-image-digest sha256:<baseline-app-config-digest> \
  --candidate-contract <absolute-candidate-contract-path> \
  --candidate-control-url http://127.0.0.1:<candidate-control-port>/ \
  --candidate-resolver-ip 127.0.0.<candidate-stack-address> \
  --candidate-image-digest sha256:<candidate-app-config-digest> \
  --scenario provider-overlap-v1 \
  --output <absolute-new-path-outside-the-repository>.json
```

The orchestrator performs read-only Docker inspection to bind each running
Compose `app` container to the expected exact local image config digest, image
reference, OCI revision, role, and public-build-contract labels. It resets only
each fixture's project-owned disposable data, completes the synthetic Telegram
login to a non-cabinet route in the pinned Chromium project, blocks cabinet
prefetch, then arms the exact one-shot `cabinet_read_overlap_once` barrier only
for one explicit cabinet document navigation. It validates the two referenced
offers/devices records as adjacent, enriched, sanitized ledger entries.

The output is create-only and requests POSIX mode `0600` where supported. It contains no cookie
values, tokens, request bodies, image references, container IDs, raw user
agent, credentials, or PII. Image references and the user agent are represented
only by SHA-256 digests. Failure output is digest-only.

Limits: this proof establishes that the offers and devices reads overlapped in
both exact images for one deterministic scenario and browser project. It does
not prove every scheduler interleaving, response completion order, provider
side-effect commutativity, or general order-insensitivity. It must therefore be
retained as sidecar evidence and independently reviewed before any narrowly
scoped comparison projection is proposed.
