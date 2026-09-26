import { randomUUID } from "node:crypto";

import { Prisma, type PaymentOperation } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import {
  recordPayment,
  type RecordPaymentInput,
} from "@/backend/integrations/payments/payment-record-service";
import {
  randomToken,
  safeEqual,
} from "@/backend/security/crypto";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { lockPaymentUpstreamOwner } from "@/backend/integrations/payments/payment-owner-service";
import { isPaymentManualRequired } from "@/backend/payments/manual-review";
import { lockPaymentOwnerFence } from "@/backend/integrations/payments/payment-user-merge-service";
import {
  normalizedString,
  operationIdentity,
  type OperationIdentity,
  type PaymentOperationBeginResult,
  type PaymentOperationDispatchFailureOutcome,
  type PaymentOperationRequest,
} from "@/backend/integrations/payments/payment-operation-contract";
import {
  claimTokenHash,
  errorSnapshot,
  errorSnapshotJson,
  parseErrorSnapshot,
  parsePaymentResponse,
  paymentOperationConflict,
  paymentResponseSnapshot,
  secondsUntil,
} from "@/backend/integrations/payments/payment-operation-snapshot";

export type {
  PaymentOperationBeginResult,
  PaymentOperationDispatchFailureOutcome,
  PaymentOperationRequest,
} from "@/backend/integrations/payments/payment-operation-contract";
export {
  paymentOperationDispatchFailureOutcome,
  paymentOperationErrorFromSnapshot,
  paymentResponseSnapshot,
} from "@/backend/integrations/payments/payment-operation-snapshot";

// Provider mutations have longer leases than local preparation because
// recovery and capability checks are independently bounded upstream calls.
const READY_LEASE_MS = 90_000;
const DISPATCH_LEASE_MS = 120_000;
const MAX_BEGIN_STATE_READS = 5;
function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function findOperation(userId: string, idempotencyKeyHash: string) {
  return prisma.paymentOperation.findUnique({
    where: {
      userId_idempotencyKeyHash: {
        userId,
        idempotencyKeyHash,
      },
    },
  });
}

async function createOrFindOperation({
  userId,
  identity,
  expectedUpstreamAccountId,
}: {
  userId: string;
  identity: OperationIdentity;
  expectedUpstreamAccountId?: string;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await lockPaymentOwnerFence(tx, [userId]);
          const lockedUsers = await tx.$queryRaw<Array<{
            id: string;
            remnashopUserId: string | null;
          }>>(
            Prisma.sql`
              SELECT "id", "remnashopUserId"
              FROM "WebUser"
              WHERE "id" = ${userId}
              FOR UPDATE
            `,
          );

          if (lockedUsers.length !== 1 || lockedUsers[0]?.id !== userId) {
            throw new ServiceError(
              "ACCOUNT_MERGE_REQUIRED",
              409,
              "Payment owner changed before operation creation",
            );
          }

          if (
            expectedUpstreamAccountId !== undefined &&
            lockedUsers[0]?.remnashopUserId !== expectedUpstreamAccountId
          ) {
            throw new ServiceError(
              "ACCOUNT_MERGE_REQUIRED",
              409,
              "Payment upstream owner changed before operation creation",
            );
          }

          return tx.paymentOperation.create({
            data: {
              userId,
              kind: identity.kind,
              idempotencyKeyHash: identity.idempotencyKeyHash,
              requestFingerprint: identity.fingerprint,
              requestPayload: identity.payload,
              upstreamKey: randomUUID(),
            },
          });
        },
        { maxWait: 5_000, timeout: 30_000 },
      );
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const existing = await findOperation(
        userId,
        identity.idempotencyKeyHash,
      );

      if (existing) {
        return existing;
      }

      // A practically impossible upstream-key collision can safely use a new
      // server key because no operation was created for this client key.
    }
  }

  throw new ServiceError(
    "INTERNAL_ERROR",
    500,
    "Could not allocate a unique payment operation key",
  );
}

function assertSameOperation(
  operation: PaymentOperation,
  identity: OperationIdentity,
) {
  if (
    operation.kind !== identity.kind ||
    !safeEqual(operation.requestFingerprint, identity.fingerprint)
  ) {
    throw new ServiceError(
      "IDEMPOTENCY_KEY_REUSED",
      409,
      "Idempotency key is already bound to another payment operation",
    );
  }
}

export async function beginPaymentOperation(input: {
  userId: string;
  idempotencyKey: string | null;
  operation: PaymentOperationRequest;
  createIfMissing?: boolean;
  expectedUpstreamAccountId?: string;
}): Promise<PaymentOperationBeginResult> {
  const identity = operationIdentity(input);
  let operation = await findOperation(
    input.userId,
    identity.idempotencyKeyHash,
  );

  if (!operation) {
    if (input.createIfMissing === false) {
      return { state: "missing" };
    }

    operation = await createOrFindOperation({
      userId: input.userId,
      identity,
      expectedUpstreamAccountId: input.expectedUpstreamAccountId,
    });
  }

  for (let read = 0; read < MAX_BEGIN_STATE_READS; read += 1) {
    assertSameOperation(operation, identity);

    if (operation.status === "SUCCEEDED") {
      return {
        state: "replay",
        outcome: "success",
        operationId: operation.id,
        responseStatus: operation.responseStatus ?? 200,
        response: parsePaymentResponse(operation.responseSnapshot),
      };
    }

    if (operation.status === "FAILED_FINAL") {
      const error = parseErrorSnapshot(operation.errorSnapshot);

      return {
        state: "replay",
        outcome: "failure",
        operationId: operation.id,
        responseStatus: operation.responseStatus ?? error.status,
        error,
      };
    }

    if (operation.status === "OUTCOME_UNKNOWN") {
      if (isPaymentManualRequired(operation)) {
        return {
          state: "manual_required",
          operationId: operation.id,
        };
      }

      return {
        state: "pending",
        operationId: operation.id,
        reason: "OUTCOME_UNKNOWN",
      };
    }

    const now = new Date();

    if (operation.status === "DISPATCHING") {
      if (
        operation.leaseExpiresAt === null ||
        operation.leaseExpiresAt <= now
      ) {
        const settled = await prisma.paymentOperation.updateMany({
          where: {
            id: operation.id,
            status: "DISPATCHING",
            OR: [
              { leaseExpiresAt: null },
              { leaseExpiresAt: { lte: now } },
            ],
          },
          data: {
            status: "OUTCOME_UNKNOWN",
            outcomeUnknownAt: now,
            leaseExpiresAt: null,
            reconcileNextAttemptAt: now,
          },
        });

        if (settled.count === 1) {
          return {
            state: "pending",
            operationId: operation.id,
            reason: "OUTCOME_UNKNOWN",
          };
        }
      } else {
        return {
          state: "pending",
          operationId: operation.id,
          reason: "IN_PROGRESS",
          retryAfterSeconds: secondsUntil(operation.leaseExpiresAt, now),
        };
      }
    } else {
      const claimToken = randomToken(32);
      const leaseExpiresAt = new Date(now.getTime() + READY_LEASE_MS);
      const operationId = operation.id;
      const claimed = await prisma.$transaction(async (tx) => {
        await lockPaymentOwnerFence(tx, [input.userId]);

        if (input.expectedUpstreamAccountId !== undefined) {
          const currentOwner = await tx.webUser.findUnique({
            where: { id: input.userId },
            select: { remnashopUserId: true },
          });

          if (
            !currentOwner ||
            currentOwner.remnashopUserId !== input.expectedUpstreamAccountId
          ) {
            throw new ServiceError(
              "ACCOUNT_MERGE_REQUIRED",
              409,
              "Payment upstream owner changed before operation claim",
            );
          }
        }

        return tx.paymentOperation.updateMany({
          where: {
            id: operationId,
            status: "READY",
            OR: [
              { leaseExpiresAt: null },
              { leaseExpiresAt: { lte: now } },
            ],
          },
          data: {
            attemptCount: { increment: 1 },
            claimTokenHash: claimTokenHash(claimToken),
            leaseExpiresAt,
          },
        });
      });

      if (claimed.count === 1) {
        return {
          state: "execute",
          operationId: operation.id,
          claimToken,
          upstreamKey: operation.upstreamKey,
        };
      }

      if (operation.leaseExpiresAt && operation.leaseExpiresAt > now) {
        return {
          state: "pending",
          operationId: operation.id,
          reason: "IN_PROGRESS",
          retryAfterSeconds: secondsUntil(operation.leaseExpiresAt, now),
        };
      }
    }

    const refreshed = await findOperation(
      input.userId,
      identity.idempotencyKeyHash,
    );

    if (!refreshed) {
      throw new ServiceError(
        "INTERNAL_ERROR",
        500,
        "Payment operation disappeared during claim",
      );
    }

    operation = refreshed;
  }

  return {
    state: "pending",
    operationId: operation.id,
    reason: "IN_PROGRESS",
    retryAfterSeconds: 1,
  };
}

export async function bindPaymentOperationUpstreamOwner(input: {
  operationId: string;
  claimToken: string;
  upstreamAccountId: string;
}) {
  const upstreamAccountId = normalizedString(
    input.upstreamAccountId,
    "upstreamAccountId",
    512,
  );
  const ownerHash = paymentUpstreamOwnerHash(upstreamAccountId);
  const claimHash = claimTokenHash(input.claimToken);
  const bound = await prisma.paymentOperation.updateMany({
    where: {
      id: input.operationId,
      status: "READY",
      claimTokenHash: claimHash,
      upstreamOwnerHash: null,
    },
    data: {
      upstreamOwnerHash: ownerHash,
    },
  });

  if (bound.count === 1) {
    return;
  }

  const operation = await prisma.paymentOperation.findUnique({
    where: { id: input.operationId },
    select: {
      status: true,
      claimTokenHash: true,
      upstreamOwnerHash: true,
    },
  });

  if (
    !operation ||
    operation.status !== "READY" ||
    !operation.claimTokenHash ||
    !safeEqual(operation.claimTokenHash, claimHash)
  ) {
    throw new ServiceError(
      "CONFLICT",
      409,
      "Payment operation is not owned by this execution",
    );
  }

  if (
    operation.upstreamOwnerHash &&
    safeEqual(operation.upstreamOwnerHash, ownerHash)
  ) {
    return;
  }

  throw new ServiceError(
    "IDEMPOTENCY_KEY_REUSED",
    409,
    "Payment operation is already bound to another upstream account",
  );
}

export async function markPaymentOperationDispatched(input: {
  operationId: string;
  claimToken: string;
}) {
  const now = new Date();
  const transitioned = await prisma.paymentOperation.updateMany({
    where: {
      id: input.operationId,
      status: "READY",
      claimTokenHash: claimTokenHash(input.claimToken),
      upstreamOwnerHash: { not: null },
      leaseExpiresAt: { gt: now },
    },
    data: {
      status: "DISPATCHING",
      dispatchedAt: now,
      leaseExpiresAt: new Date(now.getTime() + DISPATCH_LEASE_MS),
    },
  });

  if (transitioned.count !== 1) {
    throw new ServiceError(
      "CONFLICT",
      409,
      "Payment operation claim expired before dispatch",
    );
  }
}

export async function completePaymentOperationSuccess(input: {
  operationId: string;
  claimToken: string;
  payment: RecordPaymentInput;
  responseStatus?: number;
}) {
  const responseStatus = input.responseStatus ?? 200;

  if (
    !Number.isInteger(responseStatus) ||
    responseStatus < 200 ||
    responseStatus > 299
  ) {
    throw new ServiceError(
      "INTERNAL_ERROR",
      500,
      "Successful payment response status must be 2xx",
    );
  }

  const ownerHash = claimTokenHash(input.claimToken);
  const paymentId = input.payment.payment.payment_id;
  const now = new Date();

  try {
    await prisma.$transaction(async (transaction) => {
      const operation = await transaction.paymentOperation.findUnique({
        where: { id: input.operationId },
      });

      if (
        !operation ||
        (operation.status !== "DISPATCHING" &&
          operation.status !== "OUTCOME_UNKNOWN") ||
        !operation.claimTokenHash ||
        !safeEqual(operation.claimTokenHash, ownerHash)
      ) {
        throw paymentOperationConflict(
          "Payment operation is not owned by this execution",
        );
      }

      if (operation.userId !== input.payment.userId) {
        throw paymentOperationConflict(
          "Payment operation user does not match payment owner",
        );
      }

      if (!operation.upstreamOwnerHash) {
        throw paymentOperationConflict(
          "Payment operation is missing its upstream owner",
        );
      }

      await lockPaymentUpstreamOwner(
        transaction,
        operation.userId,
        operation.upstreamOwnerHash,
      );

      const recordForPayment = await transaction.paymentRecord.findUnique({
        where: { paymentId },
        select: { userId: true, operationId: true },
      });
      const recordForOperation = await transaction.paymentRecord.findUnique({
        where: { operationId: input.operationId },
        select: { paymentId: true },
      });

      if (
        recordForPayment &&
        (recordForPayment.userId !== operation.userId ||
          (recordForPayment.operationId !== null &&
            recordForPayment.operationId !== operation.id))
      ) {
        throw paymentOperationConflict(
          "Upstream payment id is already owned by another operation",
        );
      }

      if (
        recordForOperation &&
        recordForOperation.paymentId !== paymentId
      ) {
        throw paymentOperationConflict(
          "Payment operation is already linked to another payment id",
        );
      }

      const transitioned = await transaction.paymentOperation.updateMany({
        where: {
          id: operation.id,
          status: { in: ["DISPATCHING", "OUTCOME_UNKNOWN"] },
          claimTokenHash: ownerHash,
        },
        data: {
          status: "SUCCEEDED",
          responseStatus,
          responseSnapshot: paymentResponseSnapshot(input.payment.payment),
          reconcileClaimTokenHash: null,
          reconcileLeaseExpiresAt: null,
          reconcileNextAttemptAt: null,
          reconcileErrorSnapshot: Prisma.DbNull,
          errorSnapshot: Prisma.DbNull,
          completedAt: now,
          claimTokenHash: null,
          leaseExpiresAt: null,
        },
      });

      if (transitioned.count !== 1) {
        throw paymentOperationConflict(
          "Payment operation was settled by another execution",
        );
      }

      await recordPayment(input.payment, {
        client: transaction,
        operationId: operation.id,
      });
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }

    if (isUniqueConstraintError(error)) {
      throw paymentOperationConflict(
        "Payment result collides with an existing payment record",
      );
    }

    throw error;
  }

  return input.payment.payment;
}

export async function settlePaymentOperationBeforeDispatchFailure(input: {
  operationId: string;
  claimToken: string;
  error: unknown;
  final: boolean;
}) {
  const snapshot = errorSnapshot(input.error);
  const now = new Date();
  const transitioned = await prisma.paymentOperation.updateMany({
    where: {
      id: input.operationId,
      status: "READY",
      claimTokenHash: claimTokenHash(input.claimToken),
    },
    data: input.final
      ? {
          status: "FAILED_FINAL",
          responseStatus: snapshot.status,
          errorSnapshot: errorSnapshotJson(snapshot),
          completedAt: now,
          claimTokenHash: null,
          leaseExpiresAt: null,
        }
      : {
          claimTokenHash: null,
          leaseExpiresAt: null,
        },
  });

  if (transitioned.count !== 1) {
    throw paymentOperationConflict(
      "Payment operation could not settle a pre-dispatch failure",
    );
  }
}

export async function settlePaymentOperationAfterDispatchFailure(input: {
  operationId: string;
  claimToken: string;
  error: unknown;
  outcome: PaymentOperationDispatchFailureOutcome;
}) {
  const snapshot = errorSnapshot(input.error);
  const now = new Date();
  const data =
    input.outcome === "FINAL"
      ? {
          status: "FAILED_FINAL" as const,
          responseStatus: snapshot.status,
          errorSnapshot: errorSnapshotJson(snapshot),
          completedAt: now,
          claimTokenHash: null,
          leaseExpiresAt: null,
        }
      : input.outcome === "RETRYABLE"
        ? {
            status: "READY" as const,
            responseStatus: null,
            responseSnapshot: Prisma.DbNull,
            errorSnapshot: Prisma.DbNull,
            completedAt: null,
            outcomeUnknownAt: null,
            claimTokenHash: null,
            leaseExpiresAt: null,
          }
        : {
            status: "OUTCOME_UNKNOWN" as const,
            errorSnapshot: errorSnapshotJson(snapshot),
            outcomeUnknownAt: now,
            reconcileNextAttemptAt: now,
            claimTokenHash: null,
            leaseExpiresAt: null,
          };
  const transitioned = await prisma.paymentOperation.updateMany({
    where: {
      id: input.operationId,
      status: { in: ["DISPATCHING", "OUTCOME_UNKNOWN"] },
      claimTokenHash: claimTokenHash(input.claimToken),
    },
    data,
  });

  if (transitioned.count !== 1) {
    throw paymentOperationConflict(
      "Payment operation could not settle a dispatched failure",
    );
  }
}
