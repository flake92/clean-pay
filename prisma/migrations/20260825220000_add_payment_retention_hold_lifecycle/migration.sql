-- Replace timestamp-only holds with a durable, idempotent lifecycle record.
-- A partially populated legacy timestamp cannot be released safely because it
-- has no hold/case identity, so fail closed instead of guessing ownership.
BEGIN;

-- Every DDL lock is acquired during a stopped-writer maintenance window. Fail
-- cleanly if a forgotten session still owns one, and cap each catalog/table
-- validation statement independently.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PaymentOperation" WHERE "retentionHoldAt" IS NOT NULL
    UNION ALL
    SELECT 1 FROM "PaymentRecord" WHERE "retentionHoldAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'timestamp-only payment retention holds must be reviewed before applying 20260825220000';
  END IF;
END $$;

CREATE TYPE "PaymentRetentionHoldStatus" AS ENUM (
  'ACTIVE',
  'RELEASED',
  'DISPOSED'
);

CREATE TYPE "PaymentRetentionHoldSelectorKind" AS ENUM (
  'PAYMENT_OPERATION',
  'PAYMENT_RECORD'
);

CREATE TYPE "PaymentRetentionDisposition" AS ENUM (
  'CASE_CLOSED',
  'LEGAL_RETENTION_SATISFIED',
  'EVIDENCE_TRANSFERRED'
);

CREATE TABLE "PaymentRetentionHold" (
  "id" TEXT NOT NULL,
  "holdIdHash" CHAR(64) NOT NULL,
  "status" "PaymentRetentionHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "selectorKind" "PaymentRetentionHoldSelectorKind",
  "selectorId" TEXT,
  "selectorEvidenceHash" CHAR(64) NOT NULL,
  "activeCaseKey" CHAR(64),
  "caseUserId" TEXT,
  "caseOperationId" TEXT,
  "casePaymentRecordId" TEXT,
  "owner" VARCHAR(120),
  "reason" VARCHAR(1000),
  "reviewAt" TIMESTAMP(3),
  "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedBy" VARCHAR(120),
  "releaseReason" VARCHAR(1000),
  "releasedAt" TIMESTAMP(3),
  "disposedBy" VARCHAR(120),
  "disposition" "PaymentRetentionDisposition",
  "disposedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentRetentionHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRetentionHold_evidence_hash_check" CHECK (
    "holdIdHash" ~ '^[0-9a-f]{64}$'
    AND "selectorEvidenceHash" ~ '^[0-9a-f]{64}$'
    AND (
      "activeCaseKey" IS NULL
      OR "activeCaseKey" ~ '^[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT "PaymentRetentionHold_selector_case_check" CHECK (
    "status" = 'DISPOSED'
    OR (
      "selectorKind" = 'PAYMENT_OPERATION'
      AND "caseOperationId" IS NOT NULL
      AND "selectorId" = "caseOperationId"
    )
    OR (
      "selectorKind" = 'PAYMENT_RECORD'
      AND "casePaymentRecordId" IS NOT NULL
      AND "selectorId" = "casePaymentRecordId"
    )
  ),
  CONSTRAINT "PaymentRetentionHold_lifecycle_check" CHECK (
    (
      "status" = 'ACTIVE'
      AND "selectorKind" IS NOT NULL
      AND "selectorId" IS NOT NULL
      AND "activeCaseKey" IS NOT NULL
      AND "caseUserId" IS NOT NULL
      AND ("caseOperationId" IS NOT NULL OR "casePaymentRecordId" IS NOT NULL)
      AND "owner" IS NOT NULL
      AND "reason" IS NOT NULL
      AND "reviewAt" IS NOT NULL
      AND "reviewAt" > "heldAt"
      AND "releasedBy" IS NULL
      AND "releaseReason" IS NULL
      AND "releasedAt" IS NULL
      AND "disposedBy" IS NULL
      AND "disposition" IS NULL
      AND "disposedAt" IS NULL
    ) OR (
      "status" = 'RELEASED'
      AND "selectorKind" IS NOT NULL
      AND "selectorId" IS NOT NULL
      AND "activeCaseKey" IS NULL
      AND "caseUserId" IS NOT NULL
      AND ("caseOperationId" IS NOT NULL OR "casePaymentRecordId" IS NOT NULL)
      AND "owner" IS NOT NULL
      AND "reason" IS NOT NULL
      AND "reviewAt" IS NOT NULL
      AND "reviewAt" > "heldAt"
      AND "releasedBy" IS NOT NULL
      AND "releaseReason" IS NOT NULL
      AND "releasedAt" IS NOT NULL
      AND "releasedAt" >= "heldAt"
      AND "disposedBy" IS NULL
      AND "disposition" IS NULL
      AND "disposedAt" IS NULL
    ) OR (
      "status" = 'DISPOSED'
      AND "selectorKind" IS NULL
      AND "selectorId" IS NULL
      AND "activeCaseKey" IS NULL
      AND "caseUserId" IS NULL
      AND "caseOperationId" IS NULL
      AND "casePaymentRecordId" IS NULL
      AND "owner" IS NULL
      AND "reason" IS NULL
      AND "reviewAt" IS NULL
      AND "releasedBy" IS NULL
      AND "releaseReason" IS NULL
      AND "releasedAt" IS NOT NULL
      AND "releasedAt" >= "heldAt"
      AND "disposedBy" IS NOT NULL
      AND "disposition" IS NOT NULL
      AND "disposedAt" IS NOT NULL
      AND "disposedAt" >= "releasedAt"
    )
  )
);

CREATE UNIQUE INDEX "PaymentRetentionHold_holdIdHash_key"
  ON "PaymentRetentionHold"("holdIdHash");
CREATE UNIQUE INDEX "PaymentRetentionHold_activeCaseKey_key"
  ON "PaymentRetentionHold"("activeCaseKey");
CREATE INDEX "PaymentRetentionHold_status_reviewAt_idx"
  ON "PaymentRetentionHold"("status", "reviewAt");
CREATE INDEX "PaymentRetentionHold_status_disposedAt_idx"
  ON "PaymentRetentionHold"("status", "disposedAt");
CREATE INDEX "PaymentRetentionHold_caseOperationId_idx"
  ON "PaymentRetentionHold"("caseOperationId");
CREATE INDEX "PaymentRetentionHold_casePaymentRecordId_idx"
  ON "PaymentRetentionHold"("casePaymentRecordId");

ALTER TABLE "PaymentOperation" ADD COLUMN "retentionHoldId" TEXT;
ALTER TABLE "PaymentRecord" ADD COLUMN "retentionHoldId" TEXT;

CREATE UNIQUE INDEX "PaymentOperation_retentionHoldId_key"
  ON "PaymentOperation"("retentionHoldId");
CREATE UNIQUE INDEX "PaymentRecord_retentionHoldId_key"
  ON "PaymentRecord"("retentionHoldId");

-- A hold pointer and its timestamp are one atomic marker. Keeping either half
-- would make every later release/disposition ambiguous and could preserve a
-- false legal-case association indefinitely.
ALTER TABLE "PaymentOperation"
  ADD CONSTRAINT "PaymentOperation_retention_hold_pointer_pair_check" CHECK (
    ("retentionHoldId" IS NULL) = ("retentionHoldAt" IS NULL)
  );
ALTER TABLE "PaymentRecord"
  ADD CONSTRAINT "PaymentRecord_retention_hold_pointer_pair_check" CHECK (
    ("retentionHoldId" IS NULL) = ("retentionHoldAt" IS NULL)
  );

-- activeCaseKey is retained as opaque workflow evidence, but database
-- correctness must not depend on application-side hashing. These partial
-- indexes make each concrete case row exclusive even for direct SQL callers.
CREATE UNIQUE INDEX "PaymentRetentionHold_active_caseOperationId_key"
  ON "PaymentRetentionHold"("caseOperationId")
  WHERE "status" = 'ACTIVE' AND "caseOperationId" IS NOT NULL;
CREATE UNIQUE INDEX "PaymentRetentionHold_active_casePaymentRecordId_key"
  ON "PaymentRetentionHold"("casePaymentRecordId")
  WHERE "status" = 'ACTIVE' AND "casePaymentRecordId" IS NOT NULL;

ALTER TABLE "PaymentOperation"
  ADD CONSTRAINT "PaymentOperation_retentionHoldId_fkey"
  FOREIGN KEY ("retentionHoldId") REFERENCES "PaymentRetentionHold"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PaymentRecord"
  ADD CONSTRAINT "PaymentRecord_retentionHoldId_fkey"
  FOREIGN KEY ("retentionHoldId") REFERENCES "PaymentRetentionHold"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- These reverse references protect the payment evidence itself. The active
-- pointer FKs above only protect the hold row from deletion; without these a
-- user cascade or direct payment-row delete could destroy an ACTIVE/RELEASED
-- case and make its lifecycle impossible to complete.
ALTER TABLE "PaymentRetentionHold"
  ADD CONSTRAINT "PaymentRetentionHold_caseOperationId_fkey"
  FOREIGN KEY ("caseOperationId") REFERENCES "PaymentOperation"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PaymentRetentionHold"
  ADD CONSTRAINT "PaymentRetentionHold_casePaymentRecordId_fkey"
  FOREIGN KEY ("casePaymentRecordId") REFERENCES "PaymentRecord"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A relation may only be established while both previously independent rows
-- are unheld, and an ACTIVE/RELEASED linked case cannot be unlinked or pointed
-- elsewhere before disposition. This keeps the stored lifecycle case resolvable
-- even if a new writer bypasses the application preflight.
CREATE FUNCTION "prevent_held_payment_case_link"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  old_record_hold_id TEXT;
  old_record_hold_at TIMESTAMP(3);
  old_operation_hold_id TEXT;
  old_operation_hold_at TIMESTAMP(3);
  old_operation_case_retained BOOLEAN := FALSE;
  new_operation_hold_id TEXT;
  new_operation_hold_at TIMESTAMP(3);
  new_operation_case_retained BOOLEAN := FALSE;
  record_case_retained BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- A syntactic UPDATE OF that leaves the relation unchanged is harmless,
    -- including the NULL -> NULL case.
    IF NEW."operationId" IS NOT DISTINCT FROM OLD."operationId" THEN
      RETURN NEW;
    END IF;

    old_record_hold_id := OLD."retentionHoldId";
    old_record_hold_at := OLD."retentionHoldAt";

    -- Keep the previous operation locked until this relation change commits.
    -- Otherwise a concurrent hold placement could observe the old link before
    -- it is severed and create lifecycle evidence that can never be released.
    IF OLD."operationId" IS NOT NULL THEN
      EXECUTE format(
        'SELECT "retentionHoldId", "retentionHoldAt"
           FROM %I."PaymentOperation"
          WHERE "id" = $1
          FOR UPDATE',
        TG_TABLE_SCHEMA
      )
        INTO old_operation_hold_id, old_operation_hold_at
        USING OLD."operationId";

      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
             FROM %I."PaymentRetentionHold"
            WHERE "status" IN (''ACTIVE'', ''RELEASED'')
              AND "caseOperationId" = $1
         )',
        TG_TABLE_SCHEMA
      )
        INTO old_operation_case_retained
        USING OLD."operationId";
    END IF;
  END IF;

  -- A lifecycle case on the record must also keep its relationship stable.
  -- This query is required for both unlink and replacement operations.
  EXECUTE format(
    'SELECT EXISTS (
       SELECT 1
         FROM %I."PaymentRetentionHold"
        WHERE "status" IN (''ACTIVE'', ''RELEASED'')
          AND "casePaymentRecordId" = $1
     )',
    TG_TABLE_SCHEMA
  )
    INTO record_case_retained
    USING NEW."id";

  IF NEW."operationId" IS NULL THEN
    IF old_record_hold_id IS NOT NULL
      OR old_record_hold_at IS NOT NULL
      OR NEW."retentionHoldId" IS NOT NULL
      OR NEW."retentionHoldAt" IS NOT NULL
      OR old_operation_hold_id IS NOT NULL
      OR old_operation_hold_at IS NOT NULL
      OR old_operation_case_retained
      OR record_case_retained
    THEN
      RAISE EXCEPTION 'cannot unlink a payment record while either case row is retained'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  -- The PrismaPg adapter qualifies ORM statements but does not alter the
  -- session search_path. Resolve related tables from the actual trigger-table
  -- schema and quote it as an identifier; never trust the caller's search_path.
  EXECUTE format(
    'SELECT "retentionHoldId", "retentionHoldAt"
       FROM %I."PaymentOperation"
      WHERE "id" = $1
      FOR UPDATE',
    TG_TABLE_SCHEMA
  )
    INTO new_operation_hold_id, new_operation_hold_at
    USING NEW."operationId";

  EXECUTE format(
    'SELECT EXISTS (
       SELECT 1
         FROM %I."PaymentRetentionHold"
        WHERE "status" IN (''ACTIVE'', ''RELEASED'')
          AND "caseOperationId" = $1
     )',
    TG_TABLE_SCHEMA
  )
    INTO new_operation_case_retained
    USING NEW."operationId";

  IF old_record_hold_id IS NOT NULL
    OR old_record_hold_at IS NOT NULL
    OR NEW."retentionHoldId" IS NOT NULL
    OR NEW."retentionHoldAt" IS NOT NULL
    OR old_operation_hold_id IS NOT NULL
    OR old_operation_hold_at IS NOT NULL
    OR old_operation_case_retained
    OR new_operation_hold_id IS NOT NULL
    OR new_operation_hold_at IS NOT NULL
    OR new_operation_case_retained
    OR record_case_retained
  THEN
    RAISE EXCEPTION 'cannot link a payment record while either case row is retained'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentRecord_prevent_held_case_link"
BEFORE INSERT OR UPDATE OF "operationId" ON "PaymentRecord"
FOR EACH ROW
EXECUTE FUNCTION "prevent_held_payment_case_link"();

-- RELEASED evidence remains protected until the explicit DISPOSE transition.
-- A CHECK constraint cannot guard DELETE, so reject deletion of every
-- non-disposed lifecycle row at the database boundary.
CREATE FUNCTION "prevent_retained_payment_hold_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD."status" <> 'DISPOSED' THEN
    RAISE EXCEPTION 'payment retention hold must be disposed before deletion'
      USING ERRCODE = '23514';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER "PaymentRetentionHold_prevent_retained_delete"
BEFORE DELETE ON "PaymentRetentionHold"
FOR EACH ROW
EXECUTE FUNCTION "prevent_retained_payment_hold_delete"();

-- A hold is an append-only lifecycle record, not a reusable pointer envelope.
-- Case identifiers are fixed at placement and are cleared only by the terminal
-- RELEASED -> DISPOSED transition. This also makes every admissible
-- cross-table update touch a shared hold/case row, eliminating write-skew
-- between otherwise independent deferred checks.
CREATE FUNCTION "prevent_payment_retention_hold_reassignment"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."holdIdHash" IS DISTINCT FROM OLD."holdIdHash"
    OR NEW."selectorEvidenceHash" IS DISTINCT FROM OLD."selectorEvidenceHash"
    OR NEW."heldAt" IS DISTINCT FROM OLD."heldAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'payment retention hold immutable evidence changed'
      USING ERRCODE = '23514';
  END IF;

  IF (OLD."status" = 'ACTIVE' AND NEW."status" NOT IN ('ACTIVE', 'RELEASED'))
    OR (OLD."status" = 'RELEASED' AND NEW."status" NOT IN ('RELEASED', 'DISPOSED'))
    OR (OLD."status" = 'DISPOSED' AND NEW."status" <> 'DISPOSED')
  THEN
    RAISE EXCEPTION 'payment retention hold lifecycle cannot move backwards or skip release'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" <> 'DISPOSED'
    AND (
      NEW."selectorKind" IS DISTINCT FROM OLD."selectorKind"
      OR NEW."selectorId" IS DISTINCT FROM OLD."selectorId"
      OR NEW."caseOperationId" IS DISTINCT FROM OLD."caseOperationId"
      OR NEW."casePaymentRecordId" IS DISTINCT FROM OLD."casePaymentRecordId"
      OR NEW."owner" IS DISTINCT FROM OLD."owner"
      OR NEW."reason" IS DISTINCT FROM OLD."reason"
      OR NEW."reviewAt" IS DISTINCT FROM OLD."reviewAt"
    )
  THEN
    RAISE EXCEPTION 'payment retention hold case cannot be reassigned'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'ACTIVE'
    AND NEW."status" = 'ACTIVE'
    AND NEW."activeCaseKey" IS DISTINCT FROM OLD."activeCaseKey"
  THEN
    RAISE EXCEPTION 'active payment retention case key is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'RELEASED'
    AND NEW."status" = 'RELEASED'
    AND (
      NEW."releasedBy" IS DISTINCT FROM OLD."releasedBy"
      OR NEW."releaseReason" IS DISTINCT FROM OLD."releaseReason"
      OR NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt"
    )
  THEN
    RAISE EXCEPTION 'released payment retention evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'RELEASED'
    AND NEW."status" = 'DISPOSED'
    AND NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt"
  THEN
    RAISE EXCEPTION 'payment retention release timestamp is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'DISPOSED'
    AND (
      NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt"
      OR NEW."disposedBy" IS DISTINCT FROM OLD."disposedBy"
      OR NEW."disposition" IS DISTINCT FROM OLD."disposition"
      OR NEW."disposedAt" IS DISTINCT FROM OLD."disposedAt"
    )
  THEN
    RAISE EXCEPTION 'disposed payment retention tombstone is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "PaymentRetentionHold_prevent_reassignment"
BEFORE UPDATE ON "PaymentRetentionHold"
FOR EACH ROW
EXECUTE FUNCTION "prevent_payment_retention_hold_reassignment"();

-- Cross-table CHECK constraints cannot express the final legal-hold state.
-- Validate it at transaction commit so placement and release may update the
-- hold and both case pointers in either order, while no committed state can
-- contain a half pointer, a foreign/released pointer, a partial linked case or
-- stale case ownership. The trigger runs as its tightly verified migration
-- owner so cleanup and application roles never need broad SELECT access to
-- legal evidence merely to satisfy a deferred check. TG_TABLE_SCHEMA is
-- supplied by PostgreSQL and every dynamic identifier is quoted.
CREATE FUNCTION "enforce_payment_retention_hold_integrity"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  case_ids TEXT[] := ARRAY[]::TEXT[];
  pointer_ids TEXT[] := ARRAY[]::TEXT[];
  affected_hold_ids TEXT[] := ARRAY[]::TEXT[];
  hold_id TEXT;
  invalid BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'PaymentRetentionHold' THEN
    IF TG_OP <> 'INSERT' THEN
      affected_hold_ids := array_append(affected_hold_ids, OLD."id");
    END IF;
    IF TG_OP <> 'DELETE' THEN
      affected_hold_ids := array_append(affected_hold_ids, NEW."id");
    END IF;
  ELSIF TG_TABLE_NAME = 'PaymentOperation' THEN
    IF TG_OP <> 'INSERT' THEN
      case_ids := array_append(case_ids, OLD."id");
      pointer_ids := array_append(pointer_ids, OLD."retentionHoldId");
    END IF;
    IF TG_OP <> 'DELETE' THEN
      case_ids := array_append(case_ids, NEW."id");
      pointer_ids := array_append(pointer_ids, NEW."retentionHoldId");
    END IF;

    EXECUTE format(
      'SELECT COALESCE(array_agg(DISTINCT hold."id"), ARRAY[]::TEXT[])
         FROM %I."PaymentRetentionHold" AS hold
        WHERE hold."caseOperationId" = ANY($1)
           OR hold."id" = ANY($2)',
      TG_TABLE_SCHEMA
    )
      INTO affected_hold_ids
      USING case_ids, pointer_ids;
  ELSIF TG_TABLE_NAME = 'PaymentRecord' THEN
    IF TG_OP <> 'INSERT' THEN
      case_ids := array_append(case_ids, OLD."id");
      pointer_ids := array_append(pointer_ids, OLD."retentionHoldId");
    END IF;
    IF TG_OP <> 'DELETE' THEN
      case_ids := array_append(case_ids, NEW."id");
      pointer_ids := array_append(pointer_ids, NEW."retentionHoldId");
    END IF;

    EXECUTE format(
      'SELECT COALESCE(array_agg(DISTINCT hold."id"), ARRAY[]::TEXT[])
         FROM %I."PaymentRetentionHold" AS hold
        WHERE hold."casePaymentRecordId" = ANY($1)
           OR hold."id" = ANY($2)',
      TG_TABLE_SCHEMA
    )
      INTO affected_hold_ids
      USING case_ids, pointer_ids;
  ELSE
    RAISE EXCEPTION 'unexpected payment retention integrity trigger table'
      USING ERRCODE = '23514';
  END IF;

  FOREACH hold_id IN ARRAY affected_hold_ids LOOP
    IF hold_id IS NOT NULL THEN
      EXECUTE format(
        $integrity$
          SELECT EXISTS (
            SELECT 1
              FROM %1$I."PaymentRetentionHold" AS hold
              LEFT JOIN %1$I."PaymentOperation" AS operation
                ON operation."id" = hold."caseOperationId"
              LEFT JOIN %1$I."PaymentRecord" AS record
                ON record."id" = hold."casePaymentRecordId"
              LEFT JOIN %1$I."PaymentRecord" AS linked_record
                ON linked_record."operationId" = hold."caseOperationId"
             WHERE hold."id" = $1
               AND (
                 (
                   hold."status"::TEXT IN ('ACTIVE', 'RELEASED')
                   AND (
                     (
                       hold."caseOperationId" IS NOT NULL
                       AND (
                         operation."id" IS NULL
                         OR hold."caseUserId" IS DISTINCT FROM operation."userId"
                         OR hold."casePaymentRecordId" IS DISTINCT FROM linked_record."id"
                       )
                     )
                     OR (
                       hold."casePaymentRecordId" IS NOT NULL
                       AND (
                         record."id" IS NULL
                         OR hold."caseUserId" IS DISTINCT FROM record."userId"
                         OR hold."caseOperationId" IS DISTINCT FROM record."operationId"
                       )
                     )
                   )
                 )
                 OR (
                   hold."status"::TEXT = 'ACTIVE'
                   AND (
                     (
                       hold."caseOperationId" IS NOT NULL
                       AND (
                         operation."retentionHoldId" IS DISTINCT FROM hold."id"
                         OR operation."retentionHoldAt" IS DISTINCT FROM hold."heldAt"
                       )
                     )
                     OR (
                       hold."casePaymentRecordId" IS NOT NULL
                       AND (
                         record."retentionHoldId" IS DISTINCT FROM hold."id"
                         OR record."retentionHoldAt" IS DISTINCT FROM hold."heldAt"
                       )
                     )
                     OR EXISTS (
                       SELECT 1
                         FROM %1$I."PaymentOperation" AS extra_operation
                        WHERE extra_operation."retentionHoldId" = hold."id"
                          AND extra_operation."id" IS DISTINCT FROM hold."caseOperationId"
                     )
                     OR EXISTS (
                       SELECT 1
                         FROM %1$I."PaymentRecord" AS extra_record
                        WHERE extra_record."retentionHoldId" = hold."id"
                          AND extra_record."id" IS DISTINCT FROM hold."casePaymentRecordId"
                     )
                   )
                 )
                 OR (
                   hold."status"::TEXT <> 'ACTIVE'
                   AND (
                     EXISTS (
                       SELECT 1
                         FROM %1$I."PaymentOperation" AS pointed_operation
                        WHERE pointed_operation."retentionHoldId" = hold."id"
                     )
                     OR EXISTS (
                       SELECT 1
                         FROM %1$I."PaymentRecord" AS pointed_record
                        WHERE pointed_record."retentionHoldId" = hold."id"
                     )
                   )
                 )
               )
          )
        $integrity$,
        TG_TABLE_SCHEMA
      )
        INTO invalid
        USING hold_id;

      IF invalid THEN
        RAISE EXCEPTION 'payment retention hold integrity violation'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "PaymentOperation_payment_retention_hold_integrity"
AFTER INSERT
  OR UPDATE OF "id", "userId", "retentionHoldId", "retentionHoldAt"
  OR DELETE ON "PaymentOperation"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_payment_retention_hold_integrity"();

CREATE CONSTRAINT TRIGGER "PaymentRecord_payment_retention_hold_integrity"
AFTER INSERT
  OR UPDATE OF "id", "userId", "operationId", "retentionHoldId", "retentionHoldAt"
  OR DELETE ON "PaymentRecord"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_payment_retention_hold_integrity"();

CREATE CONSTRAINT TRIGGER "PaymentRetentionHold_payment_retention_hold_integrity"
AFTER INSERT OR UPDATE OR DELETE ON "PaymentRetentionHold"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_payment_retention_hold_integrity"();

COMMIT;
