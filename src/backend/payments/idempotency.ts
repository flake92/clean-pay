import { randomUUID } from "node:crypto";

import { Prisma, type PaymentOperation } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import {
  BffError,
  isBffErrorCode,
  type BffErrorCode,
} from "@/backend/integrations/remnashop/errors";
import {
  recordPayment,
  type RecordPaymentInput,
} from "@/backend/payments/records";
import {
  randomToken,
  safeEqual,
  sha256,
} from "@/backend/security/crypto";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { lockPaymentUpstreamOwner } from "@/backend/payments/owner";
import { isPaymentManualRequired } from "@/backend/payments/manual-review";
import { lockPaymentOwnerFence } from "@/backend/payments/user-merge";
import type {
  ExtendRequest,
  PaymentInitResponse,
  PurchaseRequest,
} from "@/shared/remnashop/types";

const PAYMENT_OPERATION_CONTRACT_VERSION = 2;
const READY_LEASE_MS = 30_000;
const DISPATCH_LEASE_MS = 120_000;
const MAX_BEGIN_STATE_READS = 5;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PaymentOperationRequest =
  | {
      kind: "PURCHASE";
      payload: Pick<
        PurchaseRequest,
        | "plan_code"
        | "duration_days"
        | "gateway_type"
        | "confirmed_amount"
        | "confirmed_currency"
        | "offer_version"
      >;
    }
  | {
      kind: "EXTEND";
      payload: Pick<
        ExtendRequest,
        | "duration_days"
        | "gateway_type"
        | "confirmed_amount"
        | "confirmed_currency"
        | "offer_version"
      >;
    };

export type PaymentOperationErrorSnapshot = {
  code: BffErrorCode;
  status: number;
  message: string;
};

export type PaymentOperationDispatchFailureOutcome =
  | "FINAL"
  | "RETRYABLE"
  | "UNKNOWN";

export type PaymentOperationBeginResult =
  | {
      state: "missing";
    }
  | {
      state: "execute";
      operationId: string;
      claimToken: string;
      upstreamKey: string;
    }
  | {
      state: "replay";
      outcome: "success";
      operationId: string;
      responseStatus: number;
      response: PaymentInitResponse;
    }
  | {
      state: "replay";
      outcome: "failure";
      operationId: string;
      responseStatus: number;
      error: PaymentOperationErrorSnapshot;
    }
  | {
      state: "pending";
      operationId: string;
      reason: "IN_PROGRESS" | "OUTCOME_UNKNOWN";
      retryAfterSeconds?: number;
    }
  | {
      state: "manual_required";
      operationId: string;
    };

type NormalizedOperation = {
  kind: "PURCHASE" | "EXTEND";
  payload: Prisma.InputJsonObject;
  fingerprint: string;
};

type OperationIdentity = NormalizedOperation & {
  idempotencyKeyHash: string;
};

function paymentHash(value: string, purpose: string) {
  return sha256(`clean-pay:payment-operation:${purpose}:v1:${value}`);
}

function normalizeIdempotencyKey(value: string | null) {
  if (value === null || value.trim() === "") {
    throw new BffError(
      "IDEMPOTENCY_KEY_REQUIRED",
      400,
      "Idempotency-Key header is required",
    );
  }

  const normalized = value.trim().toLowerCase();

  if (!UUID_PATTERN.test(normalized)) {
    throw new BffError(
      "IDEMPOTENCY_KEY_INVALID",
      400,
      "Idempotency-Key must be a UUID",
    );
  }

  return normalized;
}

function normalizedString(value: unknown, field: string, maxLength: number) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new BffError(
      "VALIDATION_ERROR",
      400,
      `${field} must be a non-empty string up to ${maxLength} characters`,
    );
  }

  return value;
}

function normalizedDuration(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new BffError(
      "VALIDATION_ERROR",
      400,
      "duration_days must be a non-negative integer",
    );
  }

  return Number(value);
}

function normalizeOperation(
  operation: PaymentOperationRequest,
): NormalizedOperation {
  const durationDays = normalizedDuration(operation.payload.duration_days);
  const gatewayType = normalizedString(
    operation.payload.gateway_type,
    "gateway_type",
    100,
  );
  const confirmedAmount = normalizedString(
    operation.payload.confirmed_amount,
    "confirmed_amount",
    64,
  );
  const confirmedCurrency = normalizedString(
    operation.payload.confirmed_currency,
    "confirmed_currency",
    12,
  );
  const offerVersion = normalizedString(
    operation.payload.offer_version,
    "offer_version",
    2_048,
  );

  if (operation.kind === "PURCHASE") {
    const payload: Prisma.InputJsonObject = {
      plan_code: normalizedString(
        operation.payload.plan_code,
        "plan_code",
        200,
      ),
      duration_days: durationDays,
      gateway_type: gatewayType,
      confirmed_amount: confirmedAmount,
      confirmed_currency: confirmedCurrency,
      offer_version: offerVersion,
    };
    const canonicalRequest = JSON.stringify([
      "clean-pay.payment-operation",
      PAYMENT_OPERATION_CONTRACT_VERSION,
      operation.kind,
      payload.plan_code,
      payload.duration_days,
      payload.gateway_type,
      payload.confirmed_amount,
      payload.confirmed_currency,
      payload.offer_version,
    ]);

    return {
      kind: operation.kind,
      payload,
      fingerprint: sha256(canonicalRequest),
    };
  }

  const payload: Prisma.InputJsonObject = {
    duration_days: durationDays,
    gateway_type: gatewayType,
    confirmed_amount: confirmedAmount,
    confirmed_currency: confirmedCurrency,
    offer_version: offerVersion,
  };
  const canonicalRequest = JSON.stringify([
    "clean-pay.payment-operation",
    PAYMENT_OPERATION_CONTRACT_VERSION,
    operation.kind,
    payload.duration_days,
    payload.gateway_type,
    payload.confirmed_amount,
    payload.confirmed_currency,
    payload.offer_version,
  ]);

  return {
    kind: operation.kind,
    payload,
    fingerprint: sha256(canonicalRequest),
  };
}

function operationIdentity(input: {
  idempotencyKey: string | null;
  operation: PaymentOperationRequest;
}): OperationIdentity {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);

  return {
    ...normalizeOperation(input.operation),
    idempotencyKeyHash: paymentHash(idempotencyKey, "client-key"),
  };
}

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
            throw new BffError(
              "ACCOUNT_MERGE_REQUIRED",
              409,
              "Payment owner changed before operation creation",
            );
          }

          if (
            expectedUpstreamAccountId !== undefined &&
            lockedUsers[0]?.remnashopUserId !== expectedUpstreamAccountId
          ) {
            throw new BffError(
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

  throw new BffError(
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
    throw new BffError(
      "IDEMPOTENCY_KEY_REUSED",
      409,
      "Idempotency key is already bound to another payment operation",
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePaymentResponse(value: Prisma.JsonValue | null) {
  if (!isObject(value)) {
    throw new BffError(
      "INTERNAL_ERROR",
      500,
      "Stored payment operation response is missing",
    );
  }

  const paymentUrl = value.payment_url;

  if (
    typeof value.payment_id !== "string" ||
    (paymentUrl !== null && typeof paymentUrl !== "string") ||
    typeof value.purchase_type !== "string" ||
    typeof value.status !== "string" ||
    typeof value.is_free !== "boolean" ||
    typeof value.final_amount !== "string" ||
    typeof value.currency !== "string"
  ) {
    throw new BffError(
      "INTERNAL_ERROR",
      500,
      "Stored payment operation response is invalid",
    );
  }

  return {
    payment_id: value.payment_id,
    payment_url: paymentUrl,
    purchase_type: value.purchase_type,
    status: value.status,
    is_free: value.is_free,
    final_amount: value.final_amount,
    currency: value.currency,
  } satisfies PaymentInitResponse;
}

function parseErrorSnapshot(
  value: Prisma.JsonValue | null,
): PaymentOperationErrorSnapshot {
  if (
    !isObject(value) ||
    !isBffErrorCode(value.code) ||
    typeof value.status !== "number" ||
    !Number.isInteger(value.status) ||
    typeof value.message !== "string"
  ) {
    throw new BffError(
      "INTERNAL_ERROR",
      500,
      "Stored payment operation error is invalid",
    );
  }

  return {
    code: value.code,
    status: value.status,
    message: value.message,
  };
}

function secondsUntil(date: Date, now: Date) {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1_000));
}

function claimTokenHash(claimToken: string) {
  return sha256(`clean-pay:payment-operation:claim:v1:${claimToken}`);
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
            throw new BffError(
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
      throw new BffError(
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
    throw new BffError(
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

  throw new BffError(
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
    throw new BffError(
      "CONFLICT",
      409,
      "Payment operation claim expired before dispatch",
    );
  }
}

export function paymentResponseSnapshot(
  response: PaymentInitResponse,
): Prisma.InputJsonObject {
  return {
    payment_id: response.payment_id,
    payment_url: response.payment_url,
    purchase_type: response.purchase_type,
    status: response.status,
    is_free: response.is_free,
    final_amount: response.final_amount,
    currency: response.currency,
  };
}

function errorSnapshot(error: unknown): PaymentOperationErrorSnapshot {
  if (error instanceof BffError) {
    return {
      code: error.code,
      status: error.status,
      message: error.prodMessage,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    status: 500,
    message: "Internal payment operation error",
  };
}

function errorSnapshotJson(
  snapshot: PaymentOperationErrorSnapshot,
): Prisma.InputJsonObject {
  return {
    code: snapshot.code,
    status: snapshot.status,
    message: snapshot.message,
  };
}

function paymentOperationConflict(message: string) {
  return new BffError("CONFLICT", 409, message);
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
    throw new BffError(
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

      const [recordForPayment, recordForOperation] = await Promise.all([
        transaction.paymentRecord.findUnique({
          where: { paymentId },
          select: { userId: true, operationId: true },
        }),
        transaction.paymentRecord.findUnique({
          where: { operationId: input.operationId },
          select: { paymentId: true },
        }),
      ]);

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
    if (error instanceof BffError) {
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

export function paymentOperationDispatchFailureOutcome(
  error: unknown,
): PaymentOperationDispatchFailureOutcome {
  if (!(error instanceof BffError)) {
    return "UNKNOWN";
  }

  if (typeof error.debug?.upstreamStatus !== "number") {
    return "UNKNOWN";
  }

  if (
    error.code === "PAYMENT_OPERATION_IN_PROGRESS" ||
    error.code === "PAYMENT_OUTCOME_UNKNOWN" ||
    error.code === "IDEMPOTENCY_KEY_REUSED"
  ) {
    return "UNKNOWN";
  }

  if (error.status === 429) {
    return "RETRYABLE";
  }

  if (error.status >= 400 && error.status < 500 && error.status !== 408) {
    return "FINAL";
  }

  return "UNKNOWN";
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

export function paymentOperationErrorFromSnapshot(
  snapshot: PaymentOperationErrorSnapshot,
) {
  return new BffError(snapshot.code, snapshot.status, snapshot.message);
}
