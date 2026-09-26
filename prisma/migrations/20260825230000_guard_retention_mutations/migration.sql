-- Move every retention mutation behind owner-executed, policy-bound database
-- functions. The runtime credential receives EXECUTE only after grant sync and
-- can no longer choose rows, timestamps, or retention cutoffs itself.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TABLE "_clean_pay_retention_policy" (
  "singleton" BOOLEAN NOT NULL,
  "auth_state_days" INTEGER NOT NULL,
  "session_days" INTEGER NOT NULL,
  "audit_info_days" INTEGER NOT NULL,
  "audit_security_days" INTEGER NOT NULL,
  "rate_limit_days" INTEGER NOT NULL,
  "payment_sensitive_days" INTEGER NOT NULL,
  "payment_operation_snapshot_days" INTEGER NOT NULL,
  "payment_hold_disposed_days" INTEGER NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "_clean_pay_retention_policy_pkey" PRIMARY KEY ("singleton"),
  CONSTRAINT "_clean_pay_retention_policy_singleton_check" CHECK ("singleton"),
  CONSTRAINT "_clean_pay_retention_policy_ranges_check" CHECK (
    "auth_state_days" BETWEEN 1 AND 30
    AND "session_days" BETWEEN 30 AND 365
    AND "audit_info_days" BETWEEN 30 AND 730
    AND "audit_security_days" BETWEEN 90 AND 2555
    AND "audit_security_days" >= "audit_info_days"
    AND "rate_limit_days" BETWEEN 1 AND 180
    AND "payment_sensitive_days" BETWEEN 7 AND 365
    AND "payment_operation_snapshot_days" BETWEEN 30 AND 730
    AND "payment_hold_disposed_days" BETWEEN 90 AND 2555
  )
);

DO $install_guarded_retention_functions$
DECLARE
  target_schema TEXT := current_schema();
BEGIN
  IF target_schema IS NULL
    OR target_schema = 'information_schema'
    OR target_schema LIKE 'pg\_%' ESCAPE '\'
  THEN
    RAISE EXCEPTION 'guarded retention functions require an application schema';
  END IF;

  EXECUTE format($delete_function$
    CREATE FUNCTION %1$I."clean_pay_retention_delete_batch"(phase TEXT)
    RETURNS TABLE(selected INTEGER, affected INTEGER, backlog BOOLEAN)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, %1$I
    SET "TimeZone" = 'UTC'
    AS $body$
    DECLARE
      effective_now TIMESTAMP(3) := (
        pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
      )::TIMESTAMP(3);
      auth_state_days INTEGER;
      session_days INTEGER;
      audit_info_days INTEGER;
      audit_security_days INTEGER;
      rate_limit_days INTEGER;
      payment_hold_disposed_days INTEGER;
      candidate_ids TEXT[] := ARRAY[]::TEXT[];
      selected_count INTEGER := 0;
      affected_count INTEGER := 0;
      has_backlog BOOLEAN := FALSE;
    BEGIN
      PERFORM pg_catalog.pg_advisory_xact_lock(72707369);

      SELECT policy."auth_state_days",
             policy."session_days",
             policy."audit_info_days",
             policy."audit_security_days",
             policy."rate_limit_days",
             policy."payment_hold_disposed_days"
        INTO STRICT auth_state_days,
                    session_days,
                    audit_info_days,
                    audit_security_days,
                    rate_limit_days,
                    payment_hold_disposed_days
        FROM %1$I."_clean_pay_retention_policy" AS policy
       FOR SHARE;

      IF phase = 'webAuthnChallengesExpired' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."expiresAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT challenge."id", challenge."expiresAt"
              FROM %1$I."WebAuthnChallenge" AS challenge
             WHERE challenge."expiresAt" < effective_now
               AND challenge."expiresAt" < effective_now - pg_catalog.make_interval(days => auth_state_days)
             ORDER BY challenge."expiresAt", challenge."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."WebAuthnChallenge" AS challenge
         WHERE challenge."id" = ANY(candidate_ids[1:500])
           AND challenge."expiresAt" < effective_now - pg_catalog.make_interval(days => auth_state_days);

      ELSIF phase = 'webAuthnChallengesConsumed' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."consumedAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT challenge."id", challenge."consumedAt"
              FROM %1$I."WebAuthnChallenge" AS challenge
             WHERE challenge."consumedAt" IS NOT NULL
               AND challenge."consumedAt" < effective_now - pg_catalog.make_interval(days => auth_state_days)
             ORDER BY challenge."consumedAt", challenge."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."WebAuthnChallenge" AS challenge
         WHERE challenge."id" = ANY(candidate_ids[1:500])
           AND challenge."consumedAt" IS NOT NULL
           AND challenge."consumedAt" < effective_now - pg_catalog.make_interval(days => auth_state_days);

      ELSIF phase = 'telegramAuthStatesExpired' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."expiresAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT state."id", state."expiresAt"
              FROM %1$I."TelegramAuthState" AS state
             WHERE state."callbackWebSessionId" IS NULL
               AND state."expiresAt" < effective_now - pg_catalog.make_interval(days => auth_state_days)
             ORDER BY state."expiresAt", state."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."TelegramAuthState" AS state
         WHERE state."id" = ANY(candidate_ids[1:500])
           AND state."callbackWebSessionId" IS NULL
           AND state."expiresAt" < effective_now - pg_catalog.make_interval(days => auth_state_days);

      ELSIF phase = 'telegramAuthStatesConsumed' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."consumedAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT state."id", state."consumedAt"
              FROM %1$I."TelegramAuthState" AS state
             WHERE state."callbackWebSessionId" IS NULL
               AND state."consumedAt" IS NOT NULL
               AND state."consumedAt" < effective_now - pg_catalog.make_interval(days => auth_state_days)
             ORDER BY state."consumedAt", state."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."TelegramAuthState" AS state
         WHERE state."id" = ANY(candidate_ids[1:500])
           AND state."callbackWebSessionId" IS NULL
           AND state."consumedAt" IS NOT NULL
           AND state."consumedAt" < effective_now - pg_catalog.make_interval(days => auth_state_days);

      ELSIF phase = 'emailVerificationCodesExpired' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."expiresAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT code."id", code."expiresAt"
              FROM %1$I."EmailVerificationCode" AS code
             WHERE code."expiresAt" < effective_now - pg_catalog.make_interval(days => auth_state_days)
             ORDER BY code."expiresAt", code."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."EmailVerificationCode" AS code
         WHERE code."id" = ANY(candidate_ids[1:500])
           AND code."expiresAt" < effective_now - pg_catalog.make_interval(days => auth_state_days);

      ELSIF phase = 'emailVerificationCodesConsumed' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."consumedAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT code."id", code."consumedAt"
              FROM %1$I."EmailVerificationCode" AS code
             WHERE code."consumedAt" IS NOT NULL
               AND code."consumedAt" < effective_now - pg_catalog.make_interval(days => auth_state_days)
             ORDER BY code."consumedAt", code."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."EmailVerificationCode" AS code
         WHERE code."id" = ANY(candidate_ids[1:500])
           AND code."consumedAt" IS NOT NULL
           AND code."consumedAt" < effective_now - pg_catalog.make_interval(days => auth_state_days);

      ELSIF phase = 'accountMergeConfirmations' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."expiresAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT confirmation."id", confirmation."expiresAt"
              FROM %1$I."AccountMergeConfirmation" AS confirmation
             WHERE confirmation."expiresAt" < effective_now - pg_catalog.make_interval(days => auth_state_days)
             ORDER BY confirmation."expiresAt", confirmation."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."AccountMergeConfirmation" AS confirmation
         WHERE confirmation."id" = ANY(candidate_ids[1:500])
           AND confirmation."expiresAt" < effective_now - pg_catalog.make_interval(days => auth_state_days);

      ELSIF phase = 'webSessionsRevoked' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."revokedAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT session."id", session."revokedAt"
              FROM %1$I."WebSession" AS session
             WHERE session."revokedAt" IS NOT NULL
               AND session."revokedAt" < effective_now - pg_catalog.make_interval(days => session_days)
             ORDER BY session."revokedAt", session."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."WebSession" AS session
         WHERE session."id" = ANY(candidate_ids[1:500])
           AND session."revokedAt" IS NOT NULL
           AND session."revokedAt" < effective_now - pg_catalog.make_interval(days => session_days);

      ELSIF phase = 'webSessionsExpired' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."refreshExpiresAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT session."id", session."refreshExpiresAt"
              FROM %1$I."WebSession" AS session
             WHERE session."refreshExpiresAt" < effective_now - pg_catalog.make_interval(days => session_days)
             ORDER BY session."refreshExpiresAt", session."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."WebSession" AS session
         WHERE session."id" = ANY(candidate_ids[1:500])
           AND session."refreshExpiresAt" < effective_now - pg_catalog.make_interval(days => session_days);

      ELSIF phase = 'auditInfo' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."createdAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT audit."id", audit."createdAt"
              FROM %1$I."AuditLog" AS audit
             WHERE audit."severity" = 'INFO'
               AND audit."createdAt" < effective_now - pg_catalog.make_interval(days => audit_info_days)
             ORDER BY audit."createdAt", audit."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."AuditLog" AS audit
         WHERE audit."id" = ANY(candidate_ids[1:500])
           AND audit."severity" = 'INFO'
           AND audit."createdAt" < effective_now - pg_catalog.make_interval(days => audit_info_days);

      ELSIF phase = 'auditSecurity' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."createdAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT audit."id", audit."createdAt"
              FROM %1$I."AuditLog" AS audit
             WHERE audit."severity" IN ('WARN', 'ERROR')
               AND audit."createdAt" < effective_now - pg_catalog.make_interval(days => audit_security_days)
             ORDER BY audit."createdAt", audit."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."AuditLog" AS audit
         WHERE audit."id" = ANY(candidate_ids[1:500])
           AND audit."severity" IN ('WARN', 'ERROR')
           AND audit."createdAt" < effective_now - pg_catalog.make_interval(days => audit_security_days);

      ELSIF phase = 'paymentRetentionHolds' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."disposedAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT hold."id", hold."disposedAt"
              FROM %1$I."PaymentRetentionHold" AS hold
             WHERE hold."status" = 'DISPOSED'
               AND hold."disposedAt" IS NOT NULL
               AND hold."disposedAt" < effective_now - pg_catalog.make_interval(days => payment_hold_disposed_days)
             ORDER BY hold."disposedAt", hold."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."PaymentRetentionHold" AS hold
         WHERE hold."id" = ANY(candidate_ids[1:500])
           AND hold."status" = 'DISPOSED'
           AND hold."disposedAt" IS NOT NULL
           AND hold."disposedAt" < effective_now - pg_catalog.make_interval(days => payment_hold_disposed_days);

      ELSIF phase = 'rateLimitEvents' THEN
        SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."occurredAt", candidate."id"), ARRAY[]::TEXT[])
          INTO candidate_ids
          FROM (
            SELECT event."id", event."occurredAt"
              FROM %1$I."RateLimitEvent" AS event
             WHERE event."occurredAt" < effective_now - pg_catalog.make_interval(days => rate_limit_days)
             ORDER BY event."occurredAt", event."id"
             LIMIT 501
          ) AS candidate;
        selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
        has_backlog := pg_catalog.cardinality(candidate_ids) > 500;
        DELETE FROM %1$I."RateLimitEvent" AS event
         WHERE event."id" = ANY(candidate_ids[1:500])
           AND event."occurredAt" < effective_now - pg_catalog.make_interval(days => rate_limit_days);

      ELSE
        RAISE EXCEPTION 'unknown guarded retention delete phase'
          USING ERRCODE = '22023';
      END IF;

      GET DIAGNOSTICS affected_count = ROW_COUNT;
      RETURN QUERY SELECT selected_count, affected_count, has_backlog;
    END;
    $body$
  $delete_function$, target_schema);

  EXECUTE format($callback_function$
    CREATE FUNCTION %1$I."clean_pay_retention_scrub_telegram_callbacks"()
    RETURNS TABLE(selected INTEGER, affected INTEGER, backlog BOOLEAN)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, %1$I
    SET "TimeZone" = 'UTC'
    AS $body$
    DECLARE
      effective_now TIMESTAMP(3) := (
        pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
      )::TIMESTAMP(3);
      policy_singleton BOOLEAN;
      candidate_ids TEXT[] := ARRAY[]::TEXT[];
      candidate_id TEXT;
      session_id TEXT;
      selected_count INTEGER := 0;
      affected_count INTEGER := 0;
      has_backlog BOOLEAN := FALSE;
    BEGIN
      PERFORM pg_catalog.pg_advisory_xact_lock(72707369);
      SELECT policy."singleton"
        INTO STRICT policy_singleton
        FROM %1$I."_clean_pay_retention_policy" AS policy
       FOR SHARE;

      IF policy_singleton IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'guarded retention policy singleton is invalid';
      END IF;

      SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate.session_rank, candidate."callbackResultExpiresAt", candidate."id"), ARRAY[]::TEXT[])
        INTO candidate_ids
        FROM (
          SELECT state."id", state."callbackResultExpiresAt",
                 CASE WHEN state."callbackWebSessionId" IS NULL THEN 1 ELSE 0 END AS session_rank
            FROM %1$I."TelegramAuthState" AS state
           WHERE state."callbackResultEncrypted" IS NOT NULL
             AND (
               state."callbackResultExpiresAt" IS NULL
               OR state."callbackResultExpiresAt" <= effective_now
             )
             AND (
               state."callbackWebSessionId" IS NULL
               OR state."callbackStatus" IN ('SESSION_CREATED', 'RECOVERY_DISPATCHING')
             )
           ORDER BY session_rank, state."callbackResultExpiresAt", state."id"
           LIMIT 501
        ) AS candidate;

      selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
      has_backlog := pg_catalog.cardinality(candidate_ids) > 500;

      FOREACH candidate_id IN ARRAY candidate_ids[1:500] LOOP
        session_id := NULL;
        SELECT state."callbackWebSessionId"
          INTO session_id
          FROM %1$I."TelegramAuthState" AS state
         WHERE state."id" = candidate_id
           AND state."callbackResultEncrypted" IS NOT NULL
           AND (
             state."callbackResultExpiresAt" IS NULL
             OR state."callbackResultExpiresAt" <= effective_now
           )
           AND (
             state."callbackWebSessionId" IS NULL
             OR state."callbackStatus" IN ('SESSION_CREATED', 'RECOVERY_DISPATCHING')
           )
         FOR UPDATE;

        IF FOUND THEN
          UPDATE %1$I."TelegramAuthState" AS state
             SET "callbackResultEncrypted" = NULL,
                 "callbackClaimTokenHash" = NULL,
                 "callbackLeaseExpiresAt" = NULL,
                 "callbackFailureCode" = NULL,
                 "callbackWebSessionId" = NULL,
                 "updatedAt" = effective_now
           WHERE state."id" = candidate_id;
          affected_count := affected_count + 1;

          IF session_id IS NOT NULL THEN
            UPDATE %1$I."WebSession" AS session
               SET "revokedAt" = effective_now,
                   "accessTokenExpiresAt" = effective_now,
                   "refreshExpiresAt" = effective_now,
                   "remnashopAccessTokenEncrypted" = NULL,
                   "remnashopRefreshTokenEncrypted" = NULL,
                   "remnashopAccessExpiresAt" = NULL,
                   "remnashopRefreshExpiresAt" = NULL,
                   "remnashopRefreshClaimTokenHash" = NULL,
                   "remnashopRefreshLeaseExpiresAt" = NULL,
                   "remnashopRefreshDispatchedAt" = NULL,
                   "remnashopRefreshRecoveryEncrypted" = NULL,
                   "updatedAt" = effective_now
             WHERE session."id" = session_id
               AND session."revokedAt" IS NULL;
          END IF;
        END IF;
      END LOOP;

      RETURN QUERY SELECT selected_count, affected_count, has_backlog;
    END;
    $body$
  $callback_function$, target_schema);

  EXECUTE format($record_function$
    CREATE FUNCTION %1$I."clean_pay_retention_scrub_payment_records"()
    RETURNS TABLE(selected INTEGER, affected INTEGER, backlog BOOLEAN)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, %1$I
    SET "TimeZone" = 'UTC'
    AS $body$
    DECLARE
      effective_now TIMESTAMP(3) := (
        pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
      )::TIMESTAMP(3);
      policy_days INTEGER;
      candidate_ids TEXT[] := ARRAY[]::TEXT[];
      selected_count INTEGER := 0;
      affected_count INTEGER := 0;
      has_backlog BOOLEAN := FALSE;
    BEGIN
      PERFORM pg_catalog.pg_advisory_xact_lock(72707369);
      SELECT policy."payment_sensitive_days"
        INTO STRICT policy_days
        FROM %1$I."_clean_pay_retention_policy" AS policy
       FOR SHARE;

      SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."status", candidate."terminalObservedAt", candidate."id"), ARRAY[]::TEXT[])
        INTO candidate_ids
        FROM (
          SELECT record."id", record."status", record."terminalObservedAt"
            FROM %1$I."PaymentRecord" AS record
           WHERE record."status" IN ('COMPLETED', 'FAILED', 'CANCELED', 'REFUNDED')
             AND record."terminalObservedAt" IS NOT NULL
             AND record."terminalObservedAt" < effective_now - pg_catalog.make_interval(days => policy_days)
             AND record."sensitiveDataScrubbedAt" IS NULL
             AND record."retentionHoldAt" IS NULL
             AND record."retentionHoldId" IS NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM %1$I."PaymentRetentionHold" AS hold
                WHERE hold."casePaymentRecordId" = record."id"
                  AND hold."status" IN ('ACTIVE', 'RELEASED')
             )
             AND (
               record."operationId" IS NULL
               OR EXISTS (
                 SELECT 1
                   FROM %1$I."PaymentOperation" AS operation
                  WHERE operation."id" = record."operationId"
                    AND operation."status" IN ('SUCCEEDED', 'FAILED_FINAL')
                    AND operation."retentionHoldAt" IS NULL
                    AND operation."retentionHoldId" IS NULL
                    AND NOT EXISTS (
                      SELECT 1
                        FROM %1$I."PaymentRetentionHold" AS hold
                       WHERE hold."caseOperationId" = operation."id"
                         AND hold."status" IN ('ACTIVE', 'RELEASED')
                    )
               )
             )
           ORDER BY record."status", record."terminalObservedAt", record."id"
           LIMIT 501
        ) AS candidate;

      selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
      has_backlog := pg_catalog.cardinality(candidate_ids) > 500;

      UPDATE %1$I."PaymentRecord" AS record
         SET "paymentUrl" = NULL,
             "raw" = pg_catalog.jsonb_build_object('retention', 'scrubbed', 'version', 1),
             "sensitiveDataScrubbedAt" = effective_now,
             "updatedAt" = effective_now
       WHERE record."id" = ANY(candidate_ids[1:500])
         AND record."status" IN ('COMPLETED', 'FAILED', 'CANCELED', 'REFUNDED')
         AND record."terminalObservedAt" IS NOT NULL
         AND record."terminalObservedAt" < effective_now - pg_catalog.make_interval(days => policy_days)
         AND record."sensitiveDataScrubbedAt" IS NULL
         AND record."retentionHoldAt" IS NULL
         AND record."retentionHoldId" IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM %1$I."PaymentRetentionHold" AS hold
            WHERE hold."casePaymentRecordId" = record."id"
              AND hold."status" IN ('ACTIVE', 'RELEASED')
         )
         AND (
           record."operationId" IS NULL
           OR EXISTS (
             SELECT 1
               FROM %1$I."PaymentOperation" AS operation
              WHERE operation."id" = record."operationId"
                AND operation."status" IN ('SUCCEEDED', 'FAILED_FINAL')
                AND operation."retentionHoldAt" IS NULL
                AND operation."retentionHoldId" IS NULL
                AND NOT EXISTS (
                  SELECT 1
                    FROM %1$I."PaymentRetentionHold" AS hold
                   WHERE hold."caseOperationId" = operation."id"
                     AND hold."status" IN ('ACTIVE', 'RELEASED')
                )
           )
         );

      GET DIAGNOSTICS affected_count = ROW_COUNT;
      RETURN QUERY SELECT selected_count, affected_count, has_backlog;
    END;
    $body$
  $record_function$, target_schema);

  EXECUTE format($operation_function$
    CREATE FUNCTION %1$I."clean_pay_retention_scrub_payment_operation_snapshots"()
    RETURNS TABLE(selected INTEGER, affected INTEGER, backlog BOOLEAN)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, %1$I
    SET "TimeZone" = 'UTC'
    AS $body$
    DECLARE
      effective_now TIMESTAMP(3) := (
        pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC'
      )::TIMESTAMP(3);
      policy_days INTEGER;
      candidate_ids TEXT[] := ARRAY[]::TEXT[];
      selected_count INTEGER := 0;
      affected_count INTEGER := 0;
      has_backlog BOOLEAN := FALSE;
    BEGIN
      PERFORM pg_catalog.pg_advisory_xact_lock(72707369);
      SELECT policy."payment_operation_snapshot_days"
        INTO STRICT policy_days
        FROM %1$I."_clean_pay_retention_policy" AS policy
       FOR SHARE;

      SELECT COALESCE(pg_catalog.array_agg(candidate."id" ORDER BY candidate."status", candidate."completedAt", candidate."id"), ARRAY[]::TEXT[])
        INTO candidate_ids
        FROM (
          SELECT operation."id", operation."status", operation."completedAt"
            FROM %1$I."PaymentOperation" AS operation
           WHERE operation."status" IN ('SUCCEEDED', 'FAILED_FINAL')
             AND operation."completedAt" IS NOT NULL
             AND operation."completedAt" < effective_now - pg_catalog.make_interval(days => policy_days)
             AND operation."snapshotScrubbedAt" IS NULL
             AND operation."retentionHoldAt" IS NULL
             AND operation."retentionHoldId" IS NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM %1$I."PaymentRetentionHold" AS hold
                WHERE hold."caseOperationId" = operation."id"
                  AND hold."status" IN ('ACTIVE', 'RELEASED')
             )
             AND NOT EXISTS (
               SELECT 1
                 FROM %1$I."PaymentRecord" AS record
                WHERE record."operationId" = operation."id"
                  AND (
                    record."retentionHoldAt" IS NOT NULL
                    OR record."retentionHoldId" IS NOT NULL
                    OR EXISTS (
                      SELECT 1
                        FROM %1$I."PaymentRetentionHold" AS hold
                       WHERE hold."casePaymentRecordId" = record."id"
                         AND hold."status" IN ('ACTIVE', 'RELEASED')
                    )
                  )
             )
           ORDER BY operation."status", operation."completedAt", operation."id"
           LIMIT 501
        ) AS candidate;

      selected_count := LEAST(pg_catalog.cardinality(candidate_ids), 500);
      has_backlog := pg_catalog.cardinality(candidate_ids) > 500;

      UPDATE %1$I."PaymentOperation" AS operation
         SET "requestPayload" = pg_catalog.jsonb_build_object('retention', 'scrubbed', 'version', 2),
             "responseSnapshot" = CASE
               WHEN operation."status" = 'SUCCEEDED' THEN
                 CASE
                   WHEN pg_catalog.jsonb_typeof(operation."responseSnapshot") = 'object'
                    AND pg_catalog.jsonb_typeof(operation."responseSnapshot" -> 'payment_id') = 'string'
                    AND pg_catalog.jsonb_typeof(operation."responseSnapshot" -> 'purchase_type') = 'string'
                    AND pg_catalog.jsonb_typeof(operation."responseSnapshot" -> 'status') = 'string'
                    AND pg_catalog.jsonb_typeof(operation."responseSnapshot" -> 'is_free') = 'boolean'
                    AND pg_catalog.jsonb_typeof(operation."responseSnapshot" -> 'final_amount') = 'string'
                    AND pg_catalog.jsonb_typeof(operation."responseSnapshot" -> 'currency') = 'string'
                   THEN pg_catalog.jsonb_build_object(
                     'retention', 'scrubbed',
                     'version', 2,
                     'outcome', 'success',
                     'payment_id', operation."responseSnapshot" -> 'payment_id',
                     'payment_url', NULL,
                     'purchase_type', operation."responseSnapshot" -> 'purchase_type',
                     'status', operation."responseSnapshot" -> 'status',
                     'is_free', operation."responseSnapshot" -> 'is_free',
                     'final_amount', operation."responseSnapshot" -> 'final_amount',
                     'currency', operation."responseSnapshot" -> 'currency'
                   )
                   ELSE pg_catalog.jsonb_build_object(
                     'retention', 'scrubbed', 'version', 2, 'outcome', 'success'
                   )
                 END
               ELSE pg_catalog.jsonb_build_object('retention', 'scrubbed', 'version', 2)
             END,
             "errorSnapshot" = CASE
               WHEN operation."status" = 'SUCCEEDED'
               THEN pg_catalog.jsonb_build_object('retention', 'scrubbed', 'version', 2)
               ELSE pg_catalog.jsonb_build_object(
                 'retention', 'scrubbed',
                 'version', 2,
                 'outcome', 'failure',
                 'code', CASE
                   WHEN pg_catalog.jsonb_typeof(operation."errorSnapshot") = 'object'
                    AND pg_catalog.jsonb_typeof(operation."errorSnapshot" -> 'code') = 'string'
                    AND operation."errorSnapshot" ->> 'code' ~ '^[A-Z][A-Z0-9_]{0,63}$'
                   THEN operation."errorSnapshot" ->> 'code'
                   ELSE 'INTERNAL_ERROR'
                 END,
                 'status', CASE
                   WHEN pg_catalog.jsonb_typeof(operation."errorSnapshot") = 'object'
                    AND pg_catalog.jsonb_typeof(operation."errorSnapshot" -> 'status') = 'number'
                   THEN CASE
                     WHEN operation."errorSnapshot" ->> 'status' ~ '^[45][0-9]{2}([.]0+)?$'
                     THEN pg_catalog.substring(operation."errorSnapshot" ->> 'status', 1, 3)::INTEGER
                     ELSE 500
                   END
                   ELSE 500
                 END
               )
             END,
             "reconcileErrorSnapshot" = pg_catalog.jsonb_build_object('retention', 'scrubbed', 'version', 2),
             "snapshotScrubbedAt" = effective_now,
             "updatedAt" = effective_now
       WHERE operation."id" = ANY(candidate_ids[1:500])
         AND operation."status" IN ('SUCCEEDED', 'FAILED_FINAL')
         AND operation."completedAt" IS NOT NULL
         AND operation."completedAt" < effective_now - pg_catalog.make_interval(days => policy_days)
         AND operation."snapshotScrubbedAt" IS NULL
         AND operation."retentionHoldAt" IS NULL
         AND operation."retentionHoldId" IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM %1$I."PaymentRetentionHold" AS hold
            WHERE hold."caseOperationId" = operation."id"
              AND hold."status" IN ('ACTIVE', 'RELEASED')
         )
         AND NOT EXISTS (
           SELECT 1
             FROM %1$I."PaymentRecord" AS record
            WHERE record."operationId" = operation."id"
              AND (
                record."retentionHoldAt" IS NOT NULL
                OR record."retentionHoldId" IS NOT NULL
                OR EXISTS (
                  SELECT 1
                    FROM %1$I."PaymentRetentionHold" AS hold
                   WHERE hold."casePaymentRecordId" = record."id"
                     AND hold."status" IN ('ACTIVE', 'RELEASED')
                )
              )
         );

      GET DIAGNOSTICS affected_count = ROW_COUNT;
      RETURN QUERY SELECT selected_count, affected_count, has_backlog;
    END;
    $body$
  $operation_function$, target_schema);

  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON FUNCTION %I."clean_pay_retention_delete_batch"(TEXT) FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON FUNCTION %I."clean_pay_retention_scrub_telegram_callbacks"() FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON FUNCTION %I."clean_pay_retention_scrub_payment_records"() FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON FUNCTION %I."clean_pay_retention_scrub_payment_operation_snapshots"() FROM PUBLIC',
    target_schema
  );
END;
$install_guarded_retention_functions$;

COMMIT;
