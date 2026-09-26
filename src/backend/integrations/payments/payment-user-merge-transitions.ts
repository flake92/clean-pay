import { ServiceError } from "@/backend/errors/service-error";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { sha256 } from "@/backend/security/crypto";

export type LockedPaymentMergeUser = {
  id: string;
  remnashopUserId: string | null;
};

export type LockedPaymentMergeOperation = {
  id: string;
  userId: string;
  idempotencyKeyHash: string;
  upstreamKey: string;
  status: string;
  leaseExpiresAt: Date | null;
};

export const paymentOwnerFenceLeaseMs = 180_000;
export const paymentOwnerFenceRenewIntervalMs = 30_000;
export const paymentOwnerFenceTransactionOptions = {
  maxWait: 5_000,
  timeout: 10_000,
};

export function paymentMergeRequired(message: string): never {
  throw new ServiceError("ACCOUNT_MERGE_REQUIRED", 409, message);
}

export function normalizedOwnerFenceUserIds(userIds: string[]) {
  return [...new Set(userIds.filter(Boolean))].sort();
}

export function normalizedPaymentMergeUserIds(
  targetUserId: string,
  sourceUserIds: string[],
) {
  return [
    targetUserId,
    ...new Set(sourceUserIds.filter((userId) => userId !== targetUserId)),
  ].sort();
}

export function normalizedPaymentSourceUserIds(
  targetUserId: string,
  sourceUserIds: string[],
) {
  return [
    ...new Set(sourceUserIds.filter((userId) => userId !== targetUserId)),
  ];
}

export function normalizedPaymentOwnerChangeSelectors({
  userIds,
  upstreamAccountIds,
  emails,
  telegramIds,
}: {
  userIds: string[];
  upstreamAccountIds: string[];
  emails: Array<string | null | undefined>;
  telegramIds: Array<string | number | null | undefined>;
}) {
  const normalizedUpstreamIds = [
    ...new Set(upstreamAccountIds.filter(Boolean)),
  ];
  const normalizedEmails = [
    ...new Set(
      emails
        .map((email) => email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  ];
  const normalizedTelegramIds = [
    ...new Set(
      telegramIds
        .filter((telegramId) => telegramId !== null && telegramId !== undefined)
        .map(String),
    ),
  ];
  const explicitUserIds = normalizedOwnerFenceUserIds(userIds);

  return {
    normalizedUpstreamIds,
    normalizedEmails,
    normalizedTelegramIds,
    explicitUserIds,
  };
}

export function clearedPaymentOwnerChangeFence() {
  return {
    paymentOwnerChangeTokenHash: null,
    paymentOwnerChangeLeaseExpiresAt: null,
    paymentOwnerChangeStartedAt: null,
    paymentOwnerChangeMutationStartedAt: null,
    paymentOwnerChangeLocalFinalizedAt: null,
    paymentOwnerChangeOperationHash: null,
    paymentOwnerChangeExpectedOwnerHash: null,
  } as const;
}

export function paymentOwnerLocalFinalizeCommitted(user: {
  remnashopUserId: string | null;
  paymentOwnerChangeMutationStartedAt?: Date | null;
  paymentOwnerChangeLocalFinalizedAt: Date | null;
  paymentOwnerChangeExpectedOwnerHash: string | null;
}) {
  return Boolean(
    user.paymentOwnerChangeMutationStartedAt
    && user.paymentOwnerChangeLocalFinalizedAt
    && user.remnashopUserId
    && user.paymentOwnerChangeExpectedOwnerHash
      === paymentUpstreamOwnerHash(user.remnashopUserId),
  );
}

export function findInFlightPaymentMergeOperation(
  operations: LockedPaymentMergeOperation[],
  now: Date,
) {
  return operations.find(
    (operation) => operation.status === "DISPATCHING"
      || (
        operation.status === "READY"
        && operation.leaseExpiresAt !== null
        && operation.leaseExpiresAt > now
      ),
  );
}

export function mergedPaymentOperationIdempotencyHash(
  operation: Pick<LockedPaymentMergeOperation, "id" | "upstreamKey">,
  counter: number,
) {
  return sha256(
    `merged-payment-operation:${operation.id}:${operation.upstreamKey}:${counter}`,
  );
}
