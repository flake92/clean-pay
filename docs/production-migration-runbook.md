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
- A failed migration leaves the previous schema and data intact.
- Redundant non-unique indexes on unique identity/payment columns are removed
  in one transaction with a five-second `lock_timeout`. A busy table aborts the
  migration quickly instead of extending the maintenance outage.
- Rollback means restoring a verified pre-migration backup with the previous
  application image. There is no destructive automatic down migration.

## Before the maintenance window

1. Pin the exact reviewed Clean Pay commit and previous working image digest.
2. Confirm the target host, port, database and schema explicitly. Never run the
   commands below against an inferred database name.
3. Stop every Clean Pay application replica and the reconciliation worker. Keep
   PostgreSQL running; do not allow an old writer during the migration.
4. Run `npx prisma migrate status` with the production `DATABASE_URL`. Production
   uses `prisma migrate deploy`, never `prisma migrate dev` or `db push`.
5. Record non-sensitive counts:

   ```sql
   SELECT count(*) FROM "WebUser";
   SELECT count(*) FROM "WebSession";
   SELECT count(*) FROM "WebUser" WHERE "telegramId" IS NOT NULL;
   ```

6. If `telegramId` is still text, run the same fail-closed preflight as the
   migration. It reports only a count and does not expose identifiers:

   ```sql
   SELECT count(*) AS invalid_telegram_id_count
     FROM "WebUser"
    WHERE "telegramId" IS NOT NULL
      AND CASE
            WHEN "telegramId" ~ '^[1-9][0-9]{0,18}$'
            THEN "telegramId"::numeric > 9223372036854775807
            ELSE TRUE
          END;
   ```

   Stop if the result is non-zero. Repair ownership data explicitly; do not
   coerce, truncate or discard it.

7. Create a custom-format backup to an explicit protected path and verify that
   PostgreSQL can read its catalog:

   ```bash
   pg_dump "$DATABASE_URL" --format=custom --file=/secure/clean-pay-pre-migrate.dump
   pg_restore --list /secure/clean-pay-pre-migrate.dump >/dev/null
   ```

   Retain this backup until the post-deploy observation window is complete.

## Upgrade

1. From the reviewed image or checkout, run:

   ```bash
   npx prisma migrate deploy
   npx prisma migrate status
   ```

2. Verify the final schema and absence of incomplete backfills:

   ```sql
   SELECT data_type
     FROM information_schema.columns
    WHERE table_name = 'WebUser' AND column_name = 'telegramId';

   SELECT count(*) AS incomplete_sessions
     FROM "WebSession"
    WHERE "accessTokenExpiresAt" IS NULL OR "refreshExpiresAt" IS NULL;
   ```

   The final Telegram type must be `text`; `incomplete_sessions` must be zero.
3. Verify that the redundant indexes are gone while the three unique indexes
   remain:

   ```sql
   SELECT indexname
     FROM pg_indexes
    WHERE schemaname = current_schema()
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
   stopped, mark that failed attempt rolled back only after confirming the
   transaction did roll back, and retry `prisma migrate deploy`; never drop the
   unique `_key` indexes manually.
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
2. Create a separate, explicitly named empty database and restore the verified
   pre-migration dump into it:

   ```bash
   createdb clean_pay_restore
   pg_restore --exit-on-error --clean=false \
     --dbname=clean_pay_restore /secure/clean-pay-pre-migrate.dump
   ```

3. Verify the pre-migration row counts and representative session/Telegram
   ownership records without logging raw identifiers.
4. Point the previous application image at the restored database, run its
   readiness checks, then reopen traffic. Reconcile writes accepted after the
   backup separately; never overwrite the failed database in place.

The local production audit rehearses this exact flow on a non-empty PostgreSQL
database, including an intentional malformed Telegram ID, transaction rollback,
the complete migration chain, custom-format backup and restore.
