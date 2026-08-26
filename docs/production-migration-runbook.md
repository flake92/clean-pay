# Production database migration runbook

This runbook covers the corrected Clean Pay Prisma migration chain, especially
the non-empty `WebSession` rewrite and the lossless Telegram ID type changes.
Treat the upgrade as a maintenance operation: both corrected migrations acquire
an `ACCESS EXCLUSIVE` table lock so an old application process cannot insert a
row between backfill and constraint enforcement.

## Invariants

- Existing `WebSession` rows keep their legacy expiry in both
  `accessTokenExpiresAt` and `refreshExpiresAt` before `expiresAt` is removed.
- A non-null Telegram ID is never dropped. The text-to-`BIGINT` step validates
  every value first and aborts the entire migration if any row is malformed or
  outside the signed 64-bit range. The later migration converts it back to text
  in place.
- The corrected `WebSession`, Telegram-ID, and retention-hold migrations are
  explicit transactions, so a failure leaves their previous schema and data
  intact.
- Every new `20260825*` migration is an explicit transaction with a five-second
  lock-acquisition budget and a fifteen-minute per-statement budget. A stale
  writer therefore fails the migration cleanly instead of hanging the
  maintenance deployment or leaving a partial callback/retention schema.
- The already-published redundant-index migration is immutable and uses a
  five-second `lock_timeout`. Because its original SQL is not explicitly
  transactional, recovery is permitted only when the ledger reports zero
  applied steps and all three redundant plus all three unique indexes are still
  present; otherwise restore a verified backup.
- Rollback means restoring a verified pre-migration backup with the previous
  application image. There is no destructive automatic down migration.

## Before the maintenance window

1. Pin the exact reviewed Clean Pay commit and previous working image digest.
2. Confirm the target host, port, database and schema explicitly. Never run the
   commands below against an inferred database name or inherited `search_path`.
   Every `psql` block below defines `expected_schema`; replace its fail-closed
   placeholder with the exact Prisma schema before executing that block.
3. Stop every Clean Pay application replica and every reconciliation/retention
   worker. Keep PostgreSQL running; do not allow an old writer while recording
   counts, creating the backup, or applying the migration.
4. Run the reviewed Clean Pay `migration` image with the production
   `DATABASE_URL`. Production uses `prisma migrate deploy` only in this one-shot
   job, never in the application container, and never uses `prisma migrate dev`
   or `db push`.
5. Record non-sensitive counts:

   ```sql
   \set expected_schema 'CHANGE_ME_EXACT_PRISMA_SCHEMA'
   SELECT count(*) FROM :"expected_schema"."WebUser";
   SELECT count(*) FROM :"expected_schema"."WebSession";
   SELECT count(*) FROM :"expected_schema"."WebUser"
    WHERE "telegramId" IS NOT NULL;
   ```

6. If `telegramId` is still text, run the same fail-closed preflight as the
   migration. It reports only a count and does not expose identifiers:

   ```sql
   \set expected_schema 'CHANGE_ME_EXACT_PRISMA_SCHEMA'
   SELECT count(*) AS invalid_telegram_id_count
     FROM :"expected_schema"."WebUser"
    WHERE "telegramId" IS NOT NULL
      AND CASE
            WHEN "telegramId" ~ '^[1-9][0-9]{0,18}$'
            THEN "telegramId"::numeric > 9223372036854775807
            ELSE TRUE
          END;
   ```

   Stop if the result is non-zero. Repair ownership data explicitly; do not
   coerce, truncate or discard it.

7. Create a schema-scoped custom-format backup using explicit libpq components.
   Do not pass Prisma's `DATABASE_URL` to `pg_dump`, `psql`, `createdb`, or
   `pg_restore`: it puts the password in process arguments and its
   Prisma-specific `schema` query option is not a libpq option. Set every
   non-secret component to its reviewed production value, and have the secret
   manager write exactly one `host:port:database:user:password` record to
   `PGPASSFILE` without placing the password in shell history:

   ```bash
   set -euo pipefail

   pg_host='CHANGE_ME_EXACT_PRODUCTION_HOST'
   pg_port='5432'
   pg_database='CHANGE_ME_EXACT_PRODUCTION_DATABASE'
   pg_user='CHANGE_ME_EXACT_BACKUP_USER'
   pg_schema='CHANGE_ME_EXACT_PRISMA_SCHEMA'
   pg_sslmode='CHANGE_ME_EXACT_SSLMODE'
   backup_dir='/secure'
   backup_file='/secure/clean-pay-pre-migrate.dump'
   backup_list='/secure/clean-pay-pre-migrate.list'
   backup_checksum='/secure/clean-pay-pre-migrate.dump.sha256'
   export PGPASSFILE='/secure/clean-pay-backup.pgpass'

   case "$pg_host:$pg_database:$pg_user:$pg_schema:$pg_sslmode" in
     *CHANGE_ME*) echo 'set every exact backup target component first' >&2; exit 1 ;;
   esac
   case "$pg_port" in ''|*[!0-9]*) echo 'invalid PostgreSQL port' >&2; exit 1 ;; esac
   for identifier in "$pg_database" "$pg_user" "$pg_schema"; do
     case "$identifier" in ''|[0-9]*|*[!A-Za-z0-9_]*) echo 'invalid PostgreSQL identifier' >&2; exit 1 ;; esac
   done
   case "$pg_sslmode" in disable|verify-full) ;; *) echo 'use explicit disable or verify-full TLS policy' >&2; exit 1 ;; esac
   test -d "$backup_dir" && test ! -L "$backup_dir"
   case "$(stat -c '%a' -- "$backup_dir")" in 700|750) ;; *) exit 1 ;; esac
   test "$(stat -c '%u' -- "$backup_dir")" = "$(id -u)"
   test "$(dirname -- "$backup_file")" = "$backup_dir"
   test "$(dirname -- "$backup_list")" = "$backup_dir"
   test "$(dirname -- "$backup_checksum")" = "$backup_dir"
   test "$(dirname -- "$PGPASSFILE")" = "$backup_dir"
   test -f "$PGPASSFILE" && test ! -L "$PGPASSFILE"
   test "$(stat -c '%a' -- "$PGPASSFILE")" = '600'
   test "$(stat -c '%u' -- "$PGPASSFILE")" = "$(id -u)"
   test ! -e "$backup_file" && test ! -L "$backup_file"
   test ! -e "$backup_list" && test ! -L "$backup_list"
   test ! -e "$backup_checksum" && test ! -L "$backup_checksum"
   export PGSSLMODE="$pg_sslmode"
   export PGOPTIONS='-c search_path=pg_catalog'

   source_conn=(
     --host="$pg_host" --port="$pg_port" --username="$pg_user"
     --dbname="$pg_database" --no-password
   )
   source_identity="$({ psql "${source_conn[@]}" --no-psqlrc --tuples-only \
     --no-align --set=ON_ERROR_STOP=1 \
     --command="SELECT current_database() || E'\\t' || current_user;"; } 2>/dev/null)"
   test "$source_identity" = "$pg_database"$'\t'"$pg_user"

   schema_table_count="$(psql "${source_conn[@]}" --no-psqlrc --tuples-only \
     --no-align --set=ON_ERROR_STOP=1 --set=expected_schema="$pg_schema" <<'SQL'
   SELECT count(*)
     FROM pg_catalog.pg_class AS c
     JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = :'expected_schema'
      AND c.relkind IN ('r', 'p');
   SQL
   )"
   test "$schema_table_count" -gt 0

   umask 077
   ( set -C; pg_dump "${source_conn[@]}" --schema="$pg_schema" \
     --format=custom >"$backup_file" )
   ( set -C; pg_restore --list "$backup_file" >"$backup_list" )
   grep -Fq " SCHEMA - $pg_schema " "$backup_list"
   grep -Fq " TABLE $pg_schema WebUser " "$backup_list"
   awk -v expected="$pg_schema" '
     /^;/ { next }
     $4 == "SCHEMA" && $5 == "-" { found = 1; if ($6 != expected) bad = 1 }
     $4 == "TABLE" { found = 1; schema = ($5 == "DATA" || $5 == "ATTACH" ? $6 : $5); if (schema != expected) bad = 1 }
     END { exit !(found && !bad) }
   ' "$backup_list"
   ( set -C; sha256sum "$backup_file" >"$backup_checksum" )
   for artifact in "$backup_file" "$backup_list" "$backup_checksum"; do
     test -f "$artifact" && test ! -L "$artifact"
     test "$(stat -c '%a' -- "$artifact")" = '600'
     test "$(stat -c '%u' -- "$artifact")" = "$(id -u)"
   done
   sha256sum --check "$backup_checksum"
   ```

   Stop on any failed assertion. Record the exact non-secret target tuple and
   checksum with the change ticket. Retain the archive, catalog, checksum, and
   protected password file according to the credential/backup policy until the
   post-deploy observation window is complete; never use `PGPASSWORD` here.

## Upgrade

1. Start the reviewed Compose migration service and require a successful exit
   before any application revision starts:

   ```bash
   ./deploy.sh migrate
   ```

   The guarded wrapper validates authoritative-file metadata, materializes the
   role-scoped migration environment, verifies immutable image identity, stops
   application runtimes, and leaves them stopped after migration. The migration
   image contains the Prisma CLI and migration files; the standalone application
   image does not. Re-running the command on an up-to-date database must report
   no pending migrations and exit successfully.

2. Verify the final schema and absence of incomplete backfills:

   ```sql
   \set expected_schema 'CHANGE_ME_EXACT_PRISMA_SCHEMA'
   SELECT data_type
     FROM information_schema.columns
    WHERE table_schema = :'expected_schema'
      AND table_name = 'WebUser'
      AND column_name = 'telegramId';

   SELECT count(*) AS incomplete_sessions
     FROM :"expected_schema"."WebSession"
    WHERE "accessTokenExpiresAt" IS NULL OR "refreshExpiresAt" IS NULL;
   ```

   The final Telegram type must be `text`; `incomplete_sessions` must be zero.
3. Verify that the redundant indexes are gone while the three unique indexes
   remain:

   ```sql
   \set expected_schema 'CHANGE_ME_EXACT_PRISMA_SCHEMA'
   SELECT indexname
     FROM pg_catalog.pg_indexes
    WHERE schemaname = :'expected_schema'
      AND indexname IN (
        'WebUser_email_idx',
        'WebUser_telegramId_idx',
        'PaymentRecord_paymentId_idx',
        'WebUser_email_key',
        'WebUser_telegramId_key',
        'PaymentRecord_paymentId_key'
      )
    ORDER BY indexname;
   ```

   The result must contain only the three names ending in `_key`. If migration
   `20260718141000_drop_redundant_indexes` fails with lock timeout, keep writers
   stopped, mark that failed attempt rolled back only after the guarded verifier
   proves a zero-step failure and unchanged index topology:

   ```bash
   ./deploy.sh resolve-rolled-back \
     20260718141000_drop_redundant_indexes \
     --confirm-zero-step-indexes-intact
   ./deploy.sh migrate
   ```

   The same command accepts only the four reviewed transactional migrations
   with their separate acknowledgement, for example:

   ```bash
   ./deploy.sh resolve-rolled-back \
     20260825230000_guard_retention_mutations \
     --confirm-atomic-zero-step-rollback
   ./deploy.sh migrate
   ```

   This is recovery of a verified zero-step failed attempt, not permission to
   hide drift or a checksum mismatch. The wrapper accepts only a migration
   present in the reviewed checkout, verifies role environments and exact image
   identity, and keeps application writers stopped. Inside the one-shot
   migration image, the migration-role verifier requires exactly one
   unresolved zero-step failed ledger row whose checksum equals the SHA-256 of
   the packaged migration SQL. For the historical index migration it also
   proves all three redundant and all three unique indexes in the exact
   configured schema, on their expected table and sole key column. Required
   `_key` indexes must be unique and every index must be live, ready, valid,
   non-partial, and non-expression. For each allowlisted transactional
   migration it proves the exact reviewed pre-migration catalog state and the
   packaged outer transaction/timeouts.

   The verifier then takes Prisma's migration advisory lock followed by an
   exclusive ledger lock inside one serializable transaction, conditionally
   updates only the captured ledger ID, and verifies the exact whole-ledger
   fingerprint before commit. Any concurrent migration writer, partial schema
   change, extra attempt, or unexpected ledger mutation aborts and rolls back
   the transition. Historical rolled-back attempts therefore remain auditable
   and do not block a later verified failure/retry cycle. Never run Prisma
   directly from the host and never edit `_prisma_migrations` or the unique
   `_key` indexes manually.
4. Re-run the recorded row counts. Start every application role from the same
   new image, then check liveness, readiness, login/refresh and Telegram-linking
   smoke tests before reopening traffic.

## Databases that already applied the historical migrations

`prisma migrate deploy` does not re-run a completed migration record; the local
rehearsal also confirmed this when the stored checksum differed. Do not delete
rows from `_prisma_migrations` and do not use `migrate resolve` merely to hide a
checksum or drift warning. The corrected SQL protects databases that have not
yet crossed these revisions. It cannot reconstruct a Telegram ID already lost
by the former drop/add migration; recovery for such a database must come from a
known-good backup or an independently verified source of truth.

## Rollback

1. Stop all new application and worker processes. Preserve the failed database
   unchanged for diagnosis.
2. Create a separate, explicitly named empty database on an isolated recovery
   PostgreSQL cluster (not as a sibling of the failed database) and restore the verified
   pre-migration dump into it. Repeat the exact host, port, source database,
   restore database, user, and Prisma schema instead of inheriting libpq
   defaults. The secret manager must provision `PGPASSFILE` as a regular,
   operator-owned `0600` file with exact records for the maintenance database
   and the new restore database; do not use a wildcard database entry:

   ```bash
   set -euo pipefail
   umask 077

   pg_host='CHANGE_ME_EXACT_ISOLATED_RECOVERY_HOST'
   pg_port='5432'
   source_database='CHANGE_ME_EXACT_FAILED_DATABASE'
   restore_database='CHANGE_ME_NEW_EMPTY_RESTORE_DATABASE'
   restore_user='CHANGE_ME_EXACT_BOOTSTRAP_ADMIN'
   migration_owner='CHANGE_ME_EXACT_MIGRATION_OWNER'
   pg_schema='CHANGE_ME_EXACT_PRISMA_SCHEMA'
   pg_sslmode='CHANGE_ME_EXACT_SSLMODE'
   maintenance_database='postgres'
   recovery_dir='/secure'
   backup_file='/secure/clean-pay-pre-migrate.dump'
   backup_checksum='/secure/clean-pay-pre-migrate.dump.sha256'
   export PGPASSFILE='/secure/clean-pay-restore.pgpass'

   case "$pg_host:$source_database:$restore_database:$restore_user:$migration_owner:$pg_schema:$pg_sslmode" in
     *CHANGE_ME*) echo 'set every exact restore target component first' >&2; exit 1 ;;
   esac
   case "$pg_port" in ''|*[!0-9]*) echo 'invalid PostgreSQL port' >&2; exit 1 ;; esac
   for identifier in "$source_database" "$restore_database" "$restore_user" "$migration_owner" "$pg_schema" "$maintenance_database"; do
     case "$identifier" in ''|[0-9]*|*[!A-Za-z0-9_]*) echo 'invalid PostgreSQL identifier' >&2; exit 1 ;; esac
   done
   case "$pg_sslmode" in disable|verify-full) ;; *) echo 'use explicit disable or verify-full TLS policy' >&2; exit 1 ;; esac
   test "$source_database" != "$restore_database"
   test -d "$recovery_dir" && test ! -L "$recovery_dir"
   case "$(stat -c '%a' -- "$recovery_dir")" in 700|750) ;; *) exit 1 ;; esac
   test "$(stat -c '%u' -- "$recovery_dir")" = "$(id -u)"
   test "$(dirname -- "$backup_file")" = "$recovery_dir"
   test "$(dirname -- "$backup_checksum")" = "$recovery_dir"
   test "$(dirname -- "$PGPASSFILE")" = "$recovery_dir"
   test -f "$backup_file" && test ! -L "$backup_file"
   test -f "$backup_checksum" && test ! -L "$backup_checksum"
   test "$(stat -c '%a' -- "$backup_file")" = '600'
   test "$(stat -c '%a' -- "$backup_checksum")" = '600'
   test "$(stat -c '%u' -- "$backup_file")" = "$(id -u)"
   test "$(stat -c '%u' -- "$backup_checksum")" = "$(id -u)"
   test -f "$PGPASSFILE" && test ! -L "$PGPASSFILE"
   test "$(stat -c '%a' -- "$PGPASSFILE")" = '600'
   test "$(stat -c '%u' -- "$PGPASSFILE")" = "$(id -u)"
   export PGSSLMODE="$pg_sslmode"
   export PGOPTIONS='-c search_path=pg_catalog'
   sha256sum --check "$backup_checksum"
   restore_list="${backup_file%.dump}.restore.list"
   test "$(dirname -- "$restore_list")" = "$recovery_dir"
   test ! -e "$restore_list" && test ! -L "$restore_list"
   ( set -C; pg_restore --list "$backup_file" >"$restore_list" )
   grep -Fq " SCHEMA - $pg_schema " "$restore_list"
   grep -Fq " TABLE $pg_schema WebUser " "$restore_list"
   awk -v expected="$pg_schema" '
     /^;/ { next }
     $4 == "SCHEMA" && $5 == "-" { found = 1; if ($6 != expected) bad = 1 }
     $4 == "TABLE" { found = 1; schema = ($5 == "DATA" || $5 == "ATTACH" ? $6 : $5); if (schema != expected) bad = 1 }
     END { exit !(found && !bad) }
   ' "$restore_list"

   maintenance_conn=(
     --host="$pg_host" --port="$pg_port" --username="$restore_user"
     --dbname="$maintenance_database" --no-password
   )
   database_guard="$(psql "${maintenance_conn[@]}" --no-psqlrc --tuples-only \
     --no-align --set=ON_ERROR_STOP=1 \
     --set=restore_database="$restore_database" <<'SQL'
   SELECT count(*) FILTER (WHERE datname = :'restore_database')
     FROM pg_catalog.pg_database;
   SQL
   )"
   test "$database_guard" = '0'

   createuser --host="$pg_host" --port="$pg_port" --username="$restore_user" \
     --maintenance-db="$maintenance_database" --no-password --no-login \
     --no-superuser --no-createdb --no-createrole --no-inherit -- "$migration_owner"
   createdb --host="$pg_host" --port="$pg_port" --username="$restore_user" \
     --maintenance-db="$maintenance_database" --no-password \
     --owner="$restore_user" --template=template0 --encoding=UTF8 \
     --locale-provider=libc --lc-collate=C --lc-ctype=C.UTF-8 -- "$restore_database"
   psql --host="$pg_host" --port="$pg_port" --username="$restore_user" \
     --dbname="$restore_database" --no-password --no-psqlrc \
     --set=ON_ERROR_STOP=1 --set=restore_database="$restore_database" <<'SQL'
   REVOKE CONNECT, TEMPORARY ON DATABASE :"restore_database" FROM PUBLIC;
   REVOKE CREATE ON SCHEMA public FROM PUBLIC;
   SQL
   restore_conn=(
     --host="$pg_host" --port="$pg_port" --username="$restore_user"
     --dbname="$restore_database" --no-password
   )
   restore_identity="$({ psql "${restore_conn[@]}" --no-psqlrc --tuples-only \
     --no-align --set=ON_ERROR_STOP=1 \
     --command="SELECT current_database() || E'\\t' || current_user;"; } 2>/dev/null)"
   test "$restore_identity" = "$restore_database"$'\t'"$restore_user"
   restore_table_count="$(psql "${restore_conn[@]}" --no-psqlrc --tuples-only \
     --no-align --set=ON_ERROR_STOP=1 --set=expected_schema="$pg_schema" <<'SQL'
   SELECT count(*)
     FROM pg_catalog.pg_class AS c
     JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = :'expected_schema'
      AND c.relkind IN ('r', 'p');
   SQL
   )"
   test "$restore_table_count" = '0'

   pg_restore --host="$pg_host" --port="$pg_port" --username="$restore_user" \
     --dbname="$restore_database" --no-password --exit-on-error \
     --single-transaction --no-owner --no-acl --schema="$pg_schema" "$backup_file"
   restored_schema_check="$(psql "${restore_conn[@]}" --no-psqlrc --tuples-only \
     --no-align --set=ON_ERROR_STOP=1 --set=expected_schema="$pg_schema" <<'SQL'
   SELECT count(*) FILTER (WHERE c.relname = '_prisma_migrations') || E'\t' || count(*)
     FROM pg_catalog.pg_class AS c
     JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = :'expected_schema'
      AND c.relkind IN ('r', 'p');
   SQL
   )"
   case "$restored_schema_check" in 1$'\t'[1-9]*) ;; *) exit 1 ;; esac
   ```

   If creation or restore fails, leave the partial target closed to application
   traffic and investigate it explicitly; do not rerun with `--clean`, restore
   into the failed source database, or drop either database by an inferred name.
3. Keep traffic stopped. Materialize a guarded `0600` recovery provision file
   whose `POSTGRES_DB` and all four distinct role URLs point to this exact
   restore target. Using the role-aware migration image and privilege manifest
   reviewed for the restored schema, run `database-role-provision.mjs prepare`,
   with both guarded existing-volume adoption flags set after verifying the
   backup, then `sync`, then `verify`; `prepare` requires the stopped-maintenance flag.
   Do not reopen traffic if catalog, ownership, default ACL, or negative runtime
   privilege verification fails.
4. Verify the pre-migration row counts and representative session/Telegram
   ownership records in the exact restored schema without logging raw
   identifiers.
5. Only a previous image already proven role-aware may receive the scoped
   application file. Images from before the role-environment contract expect a
   full authoritative environment and a superuser `DATABASE_URL`: the new
   `.env.app` fails their validator, while mounting the old full file leaks the
   bootstrap credential. Such an image requires a separately reviewed
   compatibility image/environment and explicit tests; otherwise keep traffic
   closed and repair forward. For a compatible image, run readiness checks,
   then reopen traffic. Reconcile writes accepted after the
   backup separately; never overwrite the failed database in place.

The release CI rehearsal now repeats this flow on disposable PostgreSQL through
the exact Dockerfile `migration` target and its packaged Prisma engine. For each
historical boundary it mounts an ordered, read-only prefix of the checked-out
migration directory; revision and failure assertions read the real
`_prisma_migrations` table. It creates a legacy `WebSession` before the expiry
rewrite, holds that populated row so the rewrite must time out and roll back
without replacement columns, then records the verified failed attempt with the
official `migrate resolve --rolled-back` flow and retries. It separately feeds
the Telegram conversion a malformed legacy identifier and proves that the
type, row and surrounding schema remain unchanged before the same verified
resolve/repair/resume sequence. Valid synthetic encrypted access/refresh,
refresh-successor and refresh-recovery envelopes are added at their actual
schema boundaries and hashed as a bundle; a populated `PaymentOperation` is
inserted before the reconciliation migration and must receive its queue
    backfill. Owner-fencing fields and all those rows must survive through the
    current migration head. The published-candidate smoke recreates the exact
    pre-guard boundary by omitting only
    `20260825230000_guard_retention_mutations`, proves that the retention-hold
    migration remains applied, and requires a successful guard-migration ledger
    row after the populated forward run. The exact image's default command also
    migrates an empty database, performs the populated no-op run and production
    environment guard, and migrates a separately restored pre-session backup
    through head; `prisma migrate status` must finish up to date.

## Remnashop migration boundary

Remnashop follows the same release invariant: run its one-shot `migration`
service (`docker-migrate.sh`) before API, worker, or scheduler. All three runtime
roles must use the same reviewed image and must not invoke Alembic from their
entrypoint. The same CI job first runs
[`scripts/security/rehearse-clean-pay-migrations.sh`](../scripts/security/rehearse-clean-pay-migrations.sh)
against the checked-out Clean Pay migration chain, then runs
[`scripts/security/rehearse-remnashop-migrations.sh`](../scripts/security/rehearse-remnashop-migrations.sh)
against the exact reviewed revision beginning `837d964`; the CI workflow and
rehearsal script enforce the complete commit identifier.
The disposable job builds that source, creates a two-user synthetic fixture at
`0040`, inventories a custom-format backup, advances to `0047`, and only then
adds a payment operation plus user-merge audit data. Thus `0048` installs and
validates owner fencing over a populated operation, while `0049` must
conservatively transform its legacy `UNKNOWN` state before the chain reaches
`0058`. A separate restored `0047` database deliberately links that operation
to an already merged owner: `0048` must fail without leaving its replacement FK
or triggers, then reach `0058` after the row is repaired. The job also verifies
a second no-op apply, restores the `0040` backup into a separate database,
forces `0045` to fail under a 1.5-second table-lock budget from `0044`, and
resumes the unchanged chain. A second contention database holds the populated
`payment_runtime_control` row before `0051`; the timeout must leave revision
`0050`, the old gate value and no partial finalization constraint, after which
the same migration command reaches `0058`. Finally, an in-process ASGI client
verifies the three empty-body auth probes still return `422` and the
side-effect-free unsupported notification-preferences method returns `405`,
matching the Clean Pay runtime compatibility check. It preserves only
synthetic row hashes, schema backup inventories and logs; it never receives a
production database or credential.
Rollback still uses the pinned previous image plus a verified pre-upgrade
database restore; never run an automatic destructive downgrade against the only
production database.

Revision `0057` adds the explicit user opt-in and durable subscription-email
outbox. Before enabling delivery, configure Remnashop SMTP plus:

```dotenv
EMAIL_USE_TLS=true
EMAIL_USE_SSL=false
EMAIL_ALLOW_INSECURE_SMTP=false
EMAIL_SUBSCRIPTION_EXPIRATION_CABINET_URL=https://pay.example.com/cabinet
EMAIL_SUBSCRIPTION_EXPIRATION_REMINDERS_ENABLED=false
```

Deploy migration, API, worker and scheduler from one image first. While the
kill switch is `false`, verify the GET route and PATCH with `false`; enabling a
user preference intentionally returns `503` in this state. Validate a complete
opt-in and test delivery in staging. For production, be ready to restore the
switch to `false`, change it to `true`, restart the Remnashop runtime roles,
enable one controlled test account and verify its delivery before wider use.
Do not use `WEB_CABINET_URL` in reminder emails: it points to Telegram WebApp
auth in this integration. SMTP credentials remain only in Remnashop. Configure
SPF, DKIM and DMARC for the sender domain before wider delivery; the application
cannot establish those DNS/provider controls itself.
