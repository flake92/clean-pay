import { Prisma, type PaymentOperationKind } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { BffError } from "@/backend/integrations/remnashop/errors";
import {
  reconcilePaymentOperation,
  reconcilePaymentOperationAsAdmin,
  type RemnashopPaymentRecovery,
} from "@/backend/integrations/remnashop/payment-recovery";
import {
  paymentResponseSnapshot,
} from "@/backend/payments/idempotency";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { applyRemnashopTransaction } from "@/backend/payments/records";
import { lockPaymentUpstreamOwner } from "@/backend/payments/owner";
import { PAYMENT_MANUAL_REQUIRED_CODE } from "@/backend/payments/manual-review";
import { randomToken, safeEqual, sha256 } from "@/backend/security/crypto";

const RECONCILIATION_LEASE_MS = 30_000;
const MAX_RECONCILIATION_BACKOFF_MS = 60 * 60_000;

export type PaymentReconciliationClaim = {
  operationId: string;
  userId: string;
  remnashopUserId: string;
  operation: PaymentOperationKind;
  upstreamKey: string;
  upstreamOwnerHash: string;
  requestPayload: Prisma.JsonValue;
  claimToken: string;
  leaseExpiresAt: Date;
  attemptCount: number;
  failureCount: number;
};

class PaymentReconciliationManualError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "PaymentReconciliationManualError";
  }
}

function reconciliationClaimHash(token: string) {
  return sha256(`clean-pay:payment-reconciliation:claim:v1:${token}`);
}

async function databaseNow(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "now"`,
  );
  const now = rows[0]?.now;

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Database did not return a valid current timestamp");
  }

  return now;
}

function reconciliationDelayMs(failureCount: number) {
  return Math.min(
    MAX_RECONCILIATION_BACKOFF_MS,
    15_000 * 2 ** Math.min(failureCount, 8),
  );
}

function safeFailureSnapshot(error: unknown): Prisma.InputJsonObject {
  if (error instanceof BffError) {
    return { code: error.code, status: error.status };
  }

  return {
    code: "INTERNAL_ERROR",
    name: error instanceof Error ? error.name : "UnknownError",
  };
}

function planCodeFromPayload(value: Prisma.JsonValue) {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.plan_code === "string" &&
    value.plan_code.length > 0 &&
    value.plan_code.length <= 200
  ) {
    return value.plan_code;
  }
  return undefined;
}

export async function claimUnknownPaymentOperation(input: {
  userId?: string;
} = {}): Promise<PaymentReconciliationClaim | null> {
  return prisma.$transaction(async (tx) => {
    const claimToken = randomToken(32);
    type ClaimedRow = {
      id: string;
      userId: string;
      kind: PaymentOperationKind;
      upstreamKey: string;
      upstreamOwnerHash: string;
      requestPayload: Prisma.JsonValue;
      reconcileLeaseExpiresAt: Date;
      reconcileAttemptCount: number;
      reconcileFailureCount: number;
      remnashopUserId: string;
    };
    const userFilter = input.userId
      ? Prisma.sql`AND operation."userId" = ${input.userId}`
      : Prisma.empty;
    const rows = await tx.$queryRaw<ClaimedRow[]>(Prisma.sql`
      WITH candidate AS (
        SELECT operation."id"
        FROM "PaymentOperation" AS operation
        INNER JOIN "WebUser" AS web_user
          ON web_user."id" = operation."userId"
        WHERE operation."status" IN ('DISPATCHING', 'OUTCOME_UNKNOWN')
          AND operation."reconciledAt" IS NULL
          AND operation."upstreamOwnerHash" IS NOT NULL
          AND web_user."remnashopUserId" IS NOT NULL
          AND (
            (
              operation."status" = 'DISPATCHING'
              AND (
                operation."leaseExpiresAt" IS NULL
                OR operation."leaseExpiresAt" <= clock_timestamp()
              )
            )
            OR (
              operation."status" = 'OUTCOME_UNKNOWN'
              AND (
                operation."reconcileLeaseExpiresAt" IS NULL
                OR operation."reconcileLeaseExpiresAt" <= clock_timestamp()
              )
            )
          )
          AND (
            operation."reconcileNextAttemptAt" IS NULL
            OR operation."reconcileNextAttemptAt" <= clock_timestamp()
          )
          ${userFilter}
        ORDER BY
          operation."reconcileNextAttemptAt" ASC NULLS FIRST,
          operation."outcomeUnknownAt" ASC NULLS FIRST,
          operation."id" ASC
        FOR UPDATE OF operation SKIP LOCKED
        LIMIT 1
      ), claimed AS (
        UPDATE "PaymentOperation" AS operation
        SET "status" = 'OUTCOME_UNKNOWN',
            "outcomeUnknownAt" = COALESCE(operation."outcomeUnknownAt", clock_timestamp()),
            "leaseExpiresAt" = NULL,
            "reconcileClaimTokenHash" = ${reconciliationClaimHash(claimToken)},
            "reconcileLeaseExpiresAt" = clock_timestamp() + (${RECONCILIATION_LEASE_MS} * INTERVAL '1 millisecond'),
            "reconcileLastAttemptAt" = clock_timestamp(),
            "reconcileAttemptCount" = operation."reconcileAttemptCount" + 1,
            "updatedAt" = clock_timestamp()
        FROM candidate
        WHERE operation."id" = candidate."id"
        RETURNING operation.*
      )
      SELECT
        claimed."id",
        claimed."userId",
        claimed."kind",
        claimed."upstreamKey",
        claimed."upstreamOwnerHash",
        claimed."requestPayload",
        claimed."reconcileLeaseExpiresAt",
        claimed."reconcileAttemptCount",
        claimed."reconcileFailureCount",
        web_user."remnashopUserId"
      FROM claimed
      INNER JOIN "WebUser" AS web_user ON web_user."id" = claimed."userId"
    `);
    const candidate = rows[0];

    if (!candidate) {
      return null;
    }

    return {
      operationId: candidate.id,
      userId: candidate.userId,
      remnashopUserId: candidate.remnashopUserId,
      operation: candidate.kind,
      upstreamKey: candidate.upstreamKey,
      upstreamOwnerHash: candidate.upstreamOwnerHash,
      requestPayload: candidate.requestPayload,
      claimToken,
      leaseExpiresAt: candidate.reconcileLeaseExpiresAt,
      attemptCount: candidate.reconcileAttemptCount,
      failureCount: candidate.reconcileFailureCount,
    };
  });
}

export async function completeReconciledPayment(
  claim: PaymentReconciliationClaim,
  recovery: RemnashopPaymentRecovery,
) {
  if (
    recovery.state !== "SUCCEEDED" ||
    recovery.payment === null ||
    recovery.transaction === null
  ) {
    throw new BffError(
      "INTERNAL_ERROR",
      500,
      "Only a successful recovery can complete a payment operation",
    );
  }
  const payment = recovery.payment;
  const transaction = recovery.transaction;

  await prisma.$transaction(async (tx) => {
    await lockPaymentUpstreamOwner(
      tx,
      claim.userId,
      claim.upstreamOwnerHash,
    );
    const now = await databaseNow(tx);
    const tokenHash = reconciliationClaimHash(claim.claimToken);
    const operation = await tx.paymentOperation.findUnique({
      where: { id: claim.operationId },
    });

    if (
      !operation ||
      operation.status !== "OUTCOME_UNKNOWN" ||
      operation.userId !== claim.userId ||
      operation.kind !== recovery.operation ||
      operation.upstreamKey !== claim.upstreamKey ||
      !operation.upstreamOwnerHash ||
      !safeEqual(operation.upstreamOwnerHash, claim.upstreamOwnerHash) ||
      !operation.reconcileClaimTokenHash ||
      !safeEqual(operation.reconcileClaimTokenHash, tokenHash) ||
      !operation.reconcileLeaseExpiresAt ||
      operation.reconcileLeaseExpiresAt <= now
    ) {
      throw new BffError(
        "CONFLICT",
        409,
        "Payment reconciliation was fenced by another completion",
      );
    }

    const operationRecord = await tx.paymentRecord.findUnique({
      where: { operationId: operation.id },
      select: { paymentId: true },
    });

    if (
      operationRecord &&
      operationRecord.paymentId !== payment.payment_id
    ) {
      throw new PaymentReconciliationManualError(
        "OPERATION_PAYMENT_ID_COLLISION",
      );
    }

    try {
      await applyRemnashopTransaction(tx, {
        userId: claim.userId,
        transaction,
        payment,
        operationId: operation.id,
        planCode: planCodeFromPayload(operation.requestPayload),
      });
    } catch (error) {
      if (error instanceof BffError && error.code === "CONFLICT") {
        throw new PaymentReconciliationManualError(
          "PAYMENT_RECORD_OWNER_OR_ID_COLLISION",
        );
      }

      throw error;
    }

    const completionNow = await databaseNow(tx);
    const transitioned = await tx.paymentOperation.updateMany({
      where: {
        id: operation.id,
        userId: claim.userId,
        status: "OUTCOME_UNKNOWN",
        reconcileClaimTokenHash: tokenHash,
        reconcileLeaseExpiresAt: { gt: completionNow },
      },
      data: {
        status: "SUCCEEDED",
        responseStatus: 200,
        responseSnapshot: paymentResponseSnapshot(payment),
        errorSnapshot: Prisma.DbNull,
        completedAt: completionNow,
        reconciledAt: completionNow,
        claimTokenHash: null,
        leaseExpiresAt: null,
        reconcileClaimTokenHash: null,
        reconcileLeaseExpiresAt: null,
        reconcileNextAttemptAt: null,
        reconcileErrorSnapshot: Prisma.DbNull,
      },
    });

    if (transitioned.count !== 1) {
      throw new BffError(
        "CONFLICT",
        409,
        "Payment reconciliation lost its completion race",
      );
    }

  });
}

async function releaseReconciliationClaim(
  claim: PaymentReconciliationClaim,
  input: {
    nextAttemptDelayMs: number | null;
    failure: boolean;
    markReconciled?: boolean;
    errorSnapshot?: Prisma.InputJsonObject;
    manualReason?: string;
    allowOwnerMismatch?: boolean;
  },
) {
  await prisma.$transaction(async (tx) => {
    if (input.allowOwnerMismatch) {
      const currentOwners = await tx.$queryRaw<
        Array<{ remnashopUserId: string | null }>
      >(Prisma.sql`
        SELECT "remnashopUserId"
        FROM "WebUser"
        WHERE "id" = ${claim.userId}
        FOR KEY SHARE
      `);
      const currentOwner = currentOwners[0]?.remnashopUserId;

      if (
        !currentOwner ||
        safeEqual(
          paymentUpstreamOwnerHash(currentOwner),
          claim.upstreamOwnerHash,
        )
      ) {
        throw new BffError(
          "CONFLICT",
          409,
          "Payment owner mismatch was not proven while releasing reconciliation",
        );
      }
    } else {
      await lockPaymentUpstreamOwner(
        tx,
        claim.userId,
        claim.upstreamOwnerHash,
      );
    }

    const now = await databaseNow(tx);

    const released = await tx.paymentOperation.updateMany({
      where: {
        id: claim.operationId,
        userId: claim.userId,
        status: "OUTCOME_UNKNOWN",
        reconciledAt: null,
        upstreamOwnerHash: claim.upstreamOwnerHash,
        reconcileClaimTokenHash: reconciliationClaimHash(claim.claimToken),
        reconcileLeaseExpiresAt: { gt: now },
      },
      data: {
        reconcileClaimTokenHash: null,
        reconcileLeaseExpiresAt: null,
        reconcileNextAttemptAt:
          input.nextAttemptDelayMs === null
            ? null
            : new Date(now.getTime() + input.nextAttemptDelayMs),
        ...(input.failure
          ? { reconcileFailureCount: { increment: 1 } }
          : { reconcileFailureCount: 0 }),
        reconcileErrorSnapshot:
          input.errorSnapshot ?? Prisma.DbNull,
        ...(input.markReconciled ? { reconciledAt: now } : {}),
      },
    });

    if (released.count !== 1) {
      throw new BffError(
        "CONFLICT",
        409,
        "Payment reconciliation release was fenced by another worker",
      );
    }

    if (input.manualReason) {
      await tx.auditLog.create({
        data: {
          userId: claim.userId,
          action: "payment_reconciliation_manual_required",
          severity: "ERROR",
          metadata: {
            operation_id: claim.operationId,
            operation: claim.operation,
            reason: input.manualReason,
            reconcile_attempt_count: claim.attemptCount,
            reconcile_failure_count: claim.failureCount + 1,
          },
        },
      });
    }
  });
}

async function markPaymentReconciliationManual(
  claim: PaymentReconciliationClaim,
  reason: string,
  options: { allowOwnerMismatch?: boolean } = {},
) {
  await releaseReconciliationClaim(claim, {
    nextAttemptDelayMs: null,
    failure: true,
    markReconciled: true,
    manualReason: reason,
    allowOwnerMismatch: options.allowOwnerMismatch,
    errorSnapshot: {
      code: PAYMENT_MANUAL_REQUIRED_CODE,
      reason,
      operator_action: "REVIEW_PAYMENT_OPERATION",
    },
  });
}

async function resetMissingUpstreamOperation(
  claim: PaymentReconciliationClaim,
) {
  await prisma.$transaction(async (tx) => {
    await lockPaymentUpstreamOwner(
      tx,
      claim.userId,
      claim.upstreamOwnerHash,
    );
    const now = await databaseNow(tx);
    const reset = await tx.paymentOperation.updateMany({
      where: {
        id: claim.operationId,
        userId: claim.userId,
        status: "OUTCOME_UNKNOWN",
        reconciledAt: null,
        upstreamOwnerHash: claim.upstreamOwnerHash,
        reconcileClaimTokenHash: reconciliationClaimHash(claim.claimToken),
        reconcileLeaseExpiresAt: { gt: now },
      },
      data: {
        status: "READY",
        claimTokenHash: null,
        leaseExpiresAt: null,
        dispatchedAt: null,
        outcomeUnknownAt: null,
        completedAt: null,
        responseStatus: null,
        responseSnapshot: Prisma.DbNull,
        errorSnapshot: Prisma.DbNull,
        reconcileClaimTokenHash: null,
        reconcileLeaseExpiresAt: null,
        reconcileNextAttemptAt: null,
        reconcileFailureCount: 0,
        reconcileErrorSnapshot: Prisma.DbNull,
      },
    });

    if (reset.count !== 1) {
      throw new BffError(
        "CONFLICT",
        409,
        "Payment reconciliation reset was fenced by another worker",
      );
    }
  });
}

export async function settlePaymentReconciliation(
  claim: PaymentReconciliationClaim,
  recovery: RemnashopPaymentRecovery | null,
) {
  if (recovery?.state === "SUCCEEDED") {
    await completeReconciledPayment(claim, recovery);
    return "SUCCEEDED" as const;
  }

  if (recovery === null) {
    await resetMissingUpstreamOperation(claim);
    return "RETRY_READY" as const;
  }

  if (recovery?.state === "IN_PROGRESS") {
    const retryAfterSeconds = Math.max(
      1,
      recovery.retry_after_seconds ?? 5,
    );
    await releaseReconciliationClaim(claim, {
      nextAttemptDelayMs: retryAfterSeconds * 1_000,
      failure: false,
    });
    return "IN_PROGRESS" as const;
  }

  if (recovery?.state === "UNKNOWN") {
    const operation = await prisma.paymentOperation.findUnique({
      where: { id: claim.operationId },
      select: { reconcileFailureCount: true },
    });
    await releaseReconciliationClaim(claim, {
      nextAttemptDelayMs:
        (recovery.retry_after_seconds ?? 0) > 0
          ? recovery.retry_after_seconds! * 1_000
          : reconciliationDelayMs(operation?.reconcileFailureCount ?? 0),
      failure: true,
      errorSnapshot: { code: "UPSTREAM_OUTCOME_UNKNOWN" },
    });
    return "UNKNOWN" as const;
  }

  await markPaymentReconciliationManual(claim, "UPSTREAM_MANUAL_REQUIRED");
  return "MANUAL_REQUIRED" as const;
}

export async function failPaymentReconciliation(
  claim: PaymentReconciliationClaim,
  error: unknown,
) {
  const operation = await prisma.paymentOperation.findUnique({
    where: { id: claim.operationId },
    select: { reconcileFailureCount: true },
  });
  await releaseReconciliationClaim(claim, {
    nextAttemptDelayMs: reconciliationDelayMs(
      operation?.reconcileFailureCount ?? 0,
    ),
    failure: true,
    errorSnapshot: safeFailureSnapshot(error),
  });
}

export async function processPaymentReconciliationClaim(
  claim: PaymentReconciliationClaim,
  options: { accessToken?: string },
) {
  const expectedOwnerHash = paymentUpstreamOwnerHash(claim.remnashopUserId);

  if (!safeEqual(expectedOwnerHash, claim.upstreamOwnerHash)) {
    await markPaymentReconciliationManual(claim, "UPSTREAM_OWNER_MISMATCH", {
      allowOwnerMismatch: true,
    });
    return "MANUAL_REQUIRED" as const;
  }

  let recovery: RemnashopPaymentRecovery | null;

  try {
    recovery = options.accessToken
      ? await reconcilePaymentOperation({
          accessToken: options.accessToken,
          operation: claim.operation,
          idempotencyKey: claim.upstreamKey,
          trigger: true,
        })
      : await reconcilePaymentOperationAsAdmin({
          remnashopUserId: claim.remnashopUserId,
          operation: claim.operation,
          idempotencyKey: claim.upstreamKey,
          trigger: true,
        });

  } catch (error) {
    try {
      await failPaymentReconciliation(claim, error);
    } catch (releaseError) {
      if (
        releaseError instanceof BffError &&
        releaseError.code === "ACCOUNT_MERGE_REQUIRED"
      ) {
        await markPaymentReconciliationManual(
          claim,
          "UPSTREAM_OWNER_CHANGED_DURING_REQUEST",
          { allowOwnerMismatch: true },
        );
        return "MANUAL_REQUIRED" as const;
      }

      throw releaseError;
    }
    throw error;
  }

  try {
    return await settlePaymentReconciliation(claim, recovery);
  } catch (error) {
    if (error instanceof PaymentReconciliationManualError) {
      try {
        await markPaymentReconciliationManual(claim, error.reason);
      } catch (manualError) {
        if (
          manualError instanceof BffError &&
          manualError.code === "ACCOUNT_MERGE_REQUIRED"
        ) {
          await markPaymentReconciliationManual(
            claim,
            `${error.reason}_AND_OWNER_CHANGED`,
            { allowOwnerMismatch: true },
          );
        } else {
          throw manualError;
        }
      }
      return "MANUAL_REQUIRED" as const;
    }

    if (error instanceof BffError && error.code === "ACCOUNT_MERGE_REQUIRED") {
      await markPaymentReconciliationManual(
        claim,
        "UPSTREAM_OWNER_CHANGED_DURING_SETTLEMENT",
        { allowOwnerMismatch: true },
      );
      return "MANUAL_REQUIRED" as const;
    }

    try {
      await failPaymentReconciliation(claim, error);
    } catch (releaseError) {
      if (
        releaseError instanceof BffError &&
        releaseError.code === "ACCOUNT_MERGE_REQUIRED"
      ) {
        await markPaymentReconciliationManual(
          claim,
          "UPSTREAM_OWNER_CHANGED_AFTER_SETTLEMENT_FAILURE",
          { allowOwnerMismatch: true },
        );
        return "MANUAL_REQUIRED" as const;
      }

      throw releaseError;
    }
    throw error;
  }
}

export async function reconcileUnknownPayments(input: {
  limit: number;
  userId?: string;
  accessToken?: string;
  deadlineMs?: number;
}) {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new BffError(
      "VALIDATION_ERROR",
      400,
      "Reconciliation limit must be between 1 and 100",
    );
  }

  const deadlineMs = input.deadlineMs ?? 20_000;

  if (
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1_000 ||
    deadlineMs > 30_000
  ) {
    throw new BffError(
      "VALIDATION_ERROR",
      400,
      "Reconciliation deadline must be between 1000 and 30000 milliseconds",
    );
  }
  const deadlineAt = Date.now() + deadlineMs;

  const counts = {
    claimed: 0,
    succeeded: 0,
    inProgress: 0,
    unknown: 0,
    manualRequired: 0,
    retryReady: 0,
    failed: 0,
    manualRequiredOperationIds: [] as string[],
  };

  for (let index = 0; index < input.limit; index += 1) {
    if (Date.now() >= deadlineAt) {
      break;
    }
    const claim = await claimUnknownPaymentOperation({ userId: input.userId });

    if (!claim) {
      break;
    }

    counts.claimed += 1;

    try {
      const result = await processPaymentReconciliationClaim(claim, {
        accessToken: input.accessToken,
      });

      if (result === "SUCCEEDED") counts.succeeded += 1;
      if (result === "IN_PROGRESS") counts.inProgress += 1;
      if (result === "UNKNOWN") counts.unknown += 1;
      if (result === "MANUAL_REQUIRED") {
        counts.manualRequired += 1;
        counts.manualRequiredOperationIds.push(claim.operationId);
      }
      if (result === "RETRY_READY") counts.retryReady += 1;
    } catch {
      counts.failed += 1;
    }
  }

  return counts;
}
