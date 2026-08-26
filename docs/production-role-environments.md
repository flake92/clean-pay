# Production role environments

`deploy/prod/.env` is the guarded, authoritative deploy input. It must be a
regular non-symlink file owned by the deploy identity with mode `0600`. Every
supported production entry point validates the same metadata policy before it
reads the file.

Immediately before startup, `deploy/prod/role-env.mjs` validates the complete
configuration and atomically derives owner-only role files next to it:

| File | Visible configuration |
|---|---|
| `.env.app` | Application `DATABASE_URL`, cache, auth, provider, messaging, and internal endpoint settings; PostgreSQL bootstrap variables are excluded |
| `.env.migration` | Non-superuser migration-owner `DATABASE_URL` only; no `POSTGRES_*` bootstrap credential |
| `.env.hold-operator` | Hold-operator URL remapped to `DATABASE_URL` plus only its lifecycle marker |
| `.env.reconciliation` | Reconciliation enable flag, internal URL, interval, and secret only |
| `.env.retention` | `DATABASE_URL`, retention policy, and retention-pool budgets only |
| `.env.postgres` | Bundled PostgreSQL database, user, and password only |
| `.env.provision` | Ephemeral provisioner input: bootstrap identity, all four role URLs, the eight bounded retention settings, and guarded adoption flags; never mounted into a runtime |

Both supported shell entry points (`./deploy.sh` with `deploy/prod/.env`, and
`sh start.sh` with the root `.env`), production Compose, and the zero-downtime
canary use these files directly. Every runtime also receives a non-secret
`CLEAN_PAY_RUNTIME_ROLE` marker (`application`, `hold-operator`, `migration`,
`provision`, `reconciliation`, or `retention`). Narrow workers therefore cannot inspect authentication,
provider, Telegram, Chatwoot, or other unrelated credential families. The
files are generated artifacts, ignored by Git, and must not be edited
independently; every supported prepare/start path refreshes them atomically
after validating the authoritative file.

PostgreSQL uses five pairwise-distinct LOGIN identities and passwords. The
bootstrap superuser is mounted only into PostgreSQL and the stopped-maintenance
provisioner. The bootstrap identity remains the dedicated database owner; the
non-superuser migration role owns only the target schema and exact
non-extension schema objects, with explicit database `CONNECT` but no database
`CREATE` or `TEMP`. Application and ephemeral hold-operator roles receive only
the versioned per-object and per-column manifest. The long-running retention
role receives no direct table, column, or enum access: it has `EXECUTE` on only
four owner-run, policy-bound cleanup functions. None of the runtime roles can
create schema objects, truncate, delegate a grant, or access
`_prisma_migrations`. Provisioning takes both its own advisory
lock and Prisma's migration lock, terminates stale role sessions, reconciles
role flags/passwords and targeted ownership atomically, and verifies the
post-migration catalog and ACL contract before traffic. It never uses
`REASSIGN OWNED` or future-object CRUD grants. The contract intentionally
rejects a shared PostgreSQL cluster with sibling user databases or user objects
outside the target schema.

Catalog and system-PUBLIC-ACL fingerprints are source-of-truth values from the
exact PostgreSQL 17.11 image digest pinned in Compose and CI, never from PGlite
or a different minor release. CI reproduces every accepted ledger boundary in
both `public` and a custom schema with:

```sh
DATABASE_CATALOG_ADMIN_URL='postgresql://BOOTSTRAP:SECRET@HOST:PORT/postgres' \
  node scripts/security/verify-database-catalog-states.mjs
```

The generator rejects a server/environment mismatch, non-LF packaged migration
bytes, catalog drift, and either added or missing effective system `PUBLIC`
privileges. `--print` is reserved for a reviewed manifest regeneration against
that same pinned image; normal CI always verifies committed constants.

After changing an application or worker credential, use `./deploy.sh restart`.
That guarded path pins the exact currently running application image, validates
the updated authoritative environment with that image, removes only the
stateless application/worker containers, recreates them from the fresh role
files, and waits for detailed readiness. Do not use `docker compose restart` to
apply credential changes: Compose restarts the existing container configuration
and does not reload `env_file` values. Existing role passwords are reconciled
by the ephemeral provisioner only while application and workers are stopped;
an edited URL alone is not a rotation until that guarded path succeeds.

For a populated volume created before this contract, stop every runtime, take
and verify a backup, set both `CLEAN_PAY_DATABASE_ADOPT_EXISTING=true` and
`CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED=true`, and run the normal guarded
install. Ownership reconciliation keeps the exact database owned by bootstrap
and is limited otherwise to the target schema and inventoried manifest objects;
an adopted pre-state accepts only bootstrap or migration ownership. Reset both
flags to `false` immediately after `sync` and `verify` pass.

The standalone zero-downtime canary and its migration-status assertion use the
same read-only root, dropped capabilities, no-new-privileges, PID/memory/CPU
bounds, and bounded tmpfs policy as their Compose counterparts. The migration
assertion validates its scoped environment before invoking Prisma.

Use synthetic, distinct markers during a deployment rehearsal and inspect only
environment variable names/fingerprints—not values—to prove each role sees its
allowlist. `tests/unit/config/production-env-validator.test.ts` performs the
repository-side version of this isolation check.

Back up the authoritative file only through the approved encrypted secret
backup mechanism. Record owner, creation time, expiry, and destruction evidence
without recording values. A restored file must pass the same owner/mode/symlink
guard and should be followed by rotation of every credential family if access
history cannot exclude disclosure.
