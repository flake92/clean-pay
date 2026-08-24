# Deployment image and migration safety

Clean Pay deployment is fail-closed. The launchers validate the authoritative
`.env`, prepare both image roles, resolve each configured image reference once
to a local immutable `sha256` image ID, verify labels and baked public settings,
and run the application image's environment validator without a network. All
subsequent migration and runtime containers use those verified IDs with
`--pull never`.

## Build provenance

`CLEAN_PAY_RELEASE=local` and `CLEAN_PAY_REVISION=local` are an explicitly
unverified developer build. The launcher prints a warning and these values are
not accepted in pull mode.

A non-local build is accepted only when `CLEAN_PAY_REVISION` is the exact Git
`HEAD` and the checkout is clean, including untracked files. Published image
pairs record the same release and revision on the application and migration
targets. A pull deployment must set both values to those recorded labels; the
preflight rejects a mismatch.

Both Docker build roots use the same digest-pinned official Node multi-platform
index. The manual publisher builds `linux/amd64` and `linux/arm64` from that
index, rather than resolving a mutable base tag independently for each role.

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

Publishing is fail-closed but the two registry pushes cannot be transactional.
If the first role is published and the second fails, its release/SHA tags remain
reserved and a retry will refuse to overwrite them. An operator must inspect
the published digest and remove the incomplete tags in GHCR before retrying the
same release.
