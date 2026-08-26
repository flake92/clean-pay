# Deployment image and migration safety

Clean Pay deployment is fail-closed. The launchers validate the authoritative
`.env`, prepare both image roles, resolve each configured image reference once
to a local immutable `sha256` image ID, verify labels and baked public settings,
and run the application image's environment validator without a network. All
subsequent migration and runtime containers use those verified IDs with
`--pull never`.

All production writers exposed by `deploy.sh`, `start.sh`, `prod.mjs`, and the
zero-downtime commands contend on the same
`deploy/prod/.production-operation.lock`. Commands that regenerate the shared
role-scoped environment files take the lock before doing so: zero-downtime
`verify` and `status` retain it through their bounded observation, while
`prod.mjs` log/status/verification commands release it immediately after the
guarded materialization and before observation or log tailing. Pure help and
the shell launchers' non-materializing log/status commands do not take it.
The lock is created atomically with a private ownership token and is released
only by that owner, including normal failure and handled signal cleanup. A
release failure turns an otherwise successful operation into a failure, but
never replaces an earlier error or signal status. An existing lock is
deliberately never expired or removed automatically: after a crash, prove that
no production operation is still running before manually recovering the
fail-closed lock.

Lock metadata records `ownerPid` (also mirrored as the backwards-compatible
`pid`) separately from `helperPid`. Shell launchers pass their live `$$` as the
owner, including when the Node helper runs in the Docker fallback; direct Node
callers record their own process. During stale-lock investigation, validate the
host-side `ownerPid` together with `operation` and `startedAt`. `helperPid` is
diagnostic only, can belong to a short-lived helper or container PID namespace,
and must never be used as evidence that the owning operation has exited.

## Build provenance

`CLEAN_PAY_RELEASE=local` and `CLEAN_PAY_REVISION=local` are an explicitly
unverified developer build. The launcher prints a warning and these values are
not accepted in pull mode.

A non-local build is accepted only when `CLEAN_PAY_REVISION` is the exact Git
`HEAD` and the checkout is clean, including untracked files. Published image
pairs record the same release and revision on the application and migration
targets. A pull deployment must set both values to those recorded labels; the
preflight rejects a mismatch.

Published pairs also share a versioned public-build-contract SHA-256. The
contract commits to the exact public application URL, enabled Turnstile flag
and site key, brand name, and brand logo URL used for the frontend build. Both
platform children carry the contract labels, both multi-platform indexes carry
matching OCI annotations, and promotion recomputes and verifies them before it
can create release tags. Candidate smoke independently compares the requested
contract with both roles and checks the application's individual baked labels
and runtime metadata.

Both Docker build roots use the same digest-pinned official Node multi-platform
index. The manual publisher first stages `linux/amd64` and `linux/arm64` for
both roles without release tags. It scans each exact child manifest and emits
four non-approving scope requests. A second run can promote those same staged
indexes only after a policy-only commit explicitly approves every
target/platform/index/child/revision/canonical-report tuple. Rebuilds receive new digests and cannot
inherit those approvals. The full operator sequence is documented in
[`container-vulnerability-release-gate.md`](container-vulnerability-release-gate.md).

## Migration downtime

After all downloads and image checks have passed, deployment intentionally
introduces a short maintenance window:

1. stop `app`, `retention-worker`, and the enabled reconciliation worker;
2. keep PostgreSQL and Redis running and wait until both are healthy;
3. run one migration container explicitly and require a zero exit status;
4. start the application from its verified image ID and wait for health;
5. only then start the workers from that same verified application ID.

If migration fails, PostgreSQL and Redis remain available but application
runtimes stay stopped. Inspect the migration/log output, correct the cause, and
rerun the same deployment command. The launcher does not automatically start
the old application against a partially migrated schema, because that rollback
cannot be assumed safe.

The private file used to transfer verified IDs is removed after the containers
are created. Build-cache and dangling-image pruning is limited to local build
mode; pull deployments never prune the host.

Promotion is fail-closed but creation of the two roles' registry tags cannot be
transactional. If promotion stops after creating only part of the pair, rerun
the same approved candidate indexes and source revision. The publisher accepts
each immutable release or **candidate-source** `sha-<revision>` tag only when it
is absent or already resolves to the exact approved digest, then completes any
missing tags. A different existing digest fails closed. Never delete, repoint,
or overwrite an immutable tag to recover a partial promotion; the
approval-policy commit SHA is never used as an image revision.
