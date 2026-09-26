import { AsyncLocalStorage } from "node:async_hooks";

import {
  assertPaymentOwnerChangeFenceTokenHeld,
  claimPaymentOwnerChangeFence,
  finalizePaymentOwnerChangeFence,
  markPaymentOwnerChangeMutation,
  markPaymentOwnerChangeTokenLocalFinalized,
  type PaymentUserMergeTransactionClient,
  releasePaymentOwnerChangeFence,
  renewPaymentOwnerChangeFence,
} from "@/backend/integrations/payments/payment-user-merge-repository";
import {
  normalizedPaymentOwnerChangeSelectors,
  paymentMergeRequired,
  paymentOwnerFenceRenewIntervalMs,
} from "@/backend/integrations/payments/payment-user-merge-transitions";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { randomToken, sha256 } from "@/backend/security/crypto";

type PaymentOwnerChangeContext = {
  tokenHash: string;
  userIds: string[];
  upstreamMutationStarted: boolean;
  recoverable: boolean;
};

const paymentOwnerChangeContext =
  new AsyncLocalStorage<PaymentOwnerChangeContext>();

/**
 * Must be called immediately before the first irreversible provider mutation
 * in an owner-change workflow. Pre-dispatch validation failures can then
 * safely compensate their local barrier; post-dispatch failures stay fenced
 * for an explicit retry/reconciliation.
 */
export async function markPaymentOwnerChangeUpstreamMutationStarted() {
  const context = paymentOwnerChangeContext.getStore();
  if (!context) {
    paymentMergeRequired("Payment owner fence context is missing");
  }
  if (!context.recoverable) {
    paymentMergeRequired(
      "Payment owner change has no durable operation and target owner",
    );
  }

  await markPaymentOwnerChangeMutation(context.userIds, context.tokenHash);
  context.upstreamMutationStarted = true;
}

/**
 * Owner-changing local transactions use the token installed by
 * withPaymentOwnerChangeFence. This check makes an expired/taken-over worker a
 * stale writer instead of allowing it to commit after its upstream calls.
 */
export async function assertPaymentOwnerChangeFenceHeld(
  tx: PaymentUserMergeTransactionClient,
  rawUserIds: string[],
) {
  const context = paymentOwnerChangeContext.getStore();
  if (!context) {
    paymentMergeRequired("Payment owner fence context is missing");
  }

  await assertPaymentOwnerChangeFenceTokenHeld(
    tx,
    rawUserIds,
    context.tokenHash,
  );
}

/** Records the local ownership/payment-transfer commit in the same database
 * transaction that performs it. Only this explicit phase can make an expired
 * post-provider barrier eligible for automatic reconciliation. */
export async function markPaymentOwnerChangeLocalFinalized(
  tx: PaymentUserMergeTransactionClient,
  rawUserIds: string[],
) {
  const context = paymentOwnerChangeContext.getStore();
  if (!context) {
    paymentMergeRequired("Payment owner fence context is missing");
  }
  if (!context.upstreamMutationStarted) {
    return;
  }
  await markPaymentOwnerChangeTokenLocalFinalized(
    tx,
    rawUserIds,
    context.tokenHash,
  );
}

export async function withPaymentOwnerChangeFence<T>({
  userIds = [],
  upstreamAccountIds = [],
  emails = [],
  telegramIds = [],
  operationKey,
  targetUpstreamAccountId,
  claimGuard,
  work,
}: {
  userIds?: string[];
  upstreamAccountIds?: string[];
  emails?: Array<string | null | undefined>;
  telegramIds?: Array<string | number | null | undefined>;
  operationKey: string;
  targetUpstreamAccountId: string;
  claimGuard?: (tx: PaymentUserMergeTransactionClient) => Promise<void>;
  work: () => Promise<T>;
}) {
  if (!operationKey.trim() || !targetUpstreamAccountId.trim()) {
    paymentMergeRequired(
      "Payment owner change requires a durable operation and target owner",
    );
  }
  const selectors = normalizedPaymentOwnerChangeSelectors({
    userIds,
    upstreamAccountIds,
    emails,
    telegramIds,
  });
  const tokenHash = sha256(randomToken());
  const operationHash = sha256(operationKey);
  const expectedOwnerHash = paymentUpstreamOwnerHash(targetUpstreamAccountId);
  const claim = await claimPaymentOwnerChangeFence({
    ...selectors,
    tokenHash,
    operationHash,
    expectedOwnerHash,
    claimGuard,
  });
  const claimedUserIds = claim.userIds;

  let renewalFailure: unknown = null;
  let pendingRenewal = Promise.resolve();
  const renew = () => {
    pendingRenewal = pendingRenewal
      .then(() => renewPaymentOwnerChangeFence(claimedUserIds, tokenHash))
      .catch((error: unknown) => {
        renewalFailure = error;
      });
  };
  const renewalTimer = setInterval(renew, paymentOwnerFenceRenewIntervalMs);
  renewalTimer.unref?.();

  const context: PaymentOwnerChangeContext = {
    tokenHash,
    userIds: claimedUserIds,
    upstreamMutationStarted: claim.resumedAfterMutation,
    recoverable: true,
  };
  try {
    const result = await paymentOwnerChangeContext.run(context, work);
    clearInterval(renewalTimer);
    await pendingRenewal;
    if (renewalFailure) {
      throw renewalFailure;
    }
    await finalizePaymentOwnerChangeFence(claimedUserIds, tokenHash);
    return result;
  } catch (error) {
    clearInterval(renewalTimer);
    await pendingRenewal;
    if (!context.upstreamMutationStarted && !renewalFailure) {
      await releasePaymentOwnerChangeFence(claimedUserIds, tokenHash);
    }
    throw error;
  } finally {
    clearInterval(renewalTimer);
  }
}
