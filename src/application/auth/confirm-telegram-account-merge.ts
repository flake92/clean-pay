import {
  AccountMergeError,
  type AccountMergeConfirmation,
  type AccountMergePreflight,
  type TelegramAccountMergeGateway,
} from "@/application/auth/ports/telegram-account-merge";

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function terminal(error: unknown) {
  return error instanceof AccountMergeError
    && (error.code === "ACCOUNT_MERGE_REQUIRED" || error.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT");
}

function errorCode(error: unknown) {
  return error instanceof AccountMergeError ? error.code : "INTERNAL_ERROR";
}

function assertOwnerUnchanged(
  confirmation: AccountMergeConfirmation,
  owner: Awaited<ReturnType<TelegramAccountMergeGateway["loadCurrentOwner"]>>,
) {
  const telegramOwnerMatches = owner && (
    owner.telegramId === confirmation.targetTelegramId ||
    owner.telegramId === confirmation.telegramId
  );
  if (!owner || !owner.emailVerified
    || normalizedEmail(owner.email) !== confirmation.targetEmail
    || owner.upstreamAccountId !== confirmation.targetAccountId
    || !telegramOwnerMatches) {
    throw new AccountMergeError("ACCOUNT_MERGE_REQUIRED", "Current account owner changed");
  }
}

function assertPreflight(confirmation: AccountMergeConfirmation, result: AccountMergePreflight) {
  if (result.conflicts.some((item) => item.toLowerCase().includes("both users have current subscriptions"))) {
    throw new AccountMergeError("ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT");
  }
  const transient = (item: string) => {
    const value = item.toLowerCase();
    return value.includes("active payment operations") || value.includes("payment fulfillment in progress");
  };
  if (result.conflicts.some((item) => !transient(item))) throw new AccountMergeError("ACCOUNT_MERGE_REQUIRED");
  if (result.conflicts.length) throw new AccountMergeError("ACCOUNT_MERGE_IN_PROGRESS");
  if (!result.dryRun
    || result.sourceAccountId !== confirmation.sourceAccountId
    || result.targetAccountId !== confirmation.targetAccountId
    || result.target.accountId !== confirmation.targetAccountId
    || normalizedEmail(result.target.email) !== confirmation.targetEmail
    || !result.target.emailVerified
    || result.target.telegramId !== confirmation.targetTelegramId
    || !result.requiresRelogin) {
    throw new AccountMergeError("ACCOUNT_MERGE_REQUIRED", "Provider target ownership changed");
  }
}

async function loadAuthorizedConfirmation(gateway: TelegramAccountMergeGateway) {
  const actor = await gateway.loadActor();
  if (!actor) throw new AccountMergeError("UNAUTHORIZED");
  if (!actor.fullAssurance) throw new AccountMergeError("PASSKEY_REQUIRED");
  return gateway.loadConfirmation(actor.userId);
}

export async function confirmTelegramAccountMerge(gateway: TelegramAccountMergeGateway) {
  const confirmation = await loadAuthorizedConfirmation(gateway);
  await gateway.assertRateLimit(confirmation.telegramId);
  await gateway.audit({
    action: "telegram_account_merge_attempted",
    userId: confirmation.userId,
    metadata: { confirmationId: confirmation.id },
  });
  if (confirmation.status === "COMPLETED") {
    await gateway.reconcileCompletedOwnerChange(confirmation);
    await gateway.audit({
      action: "telegram_account_merge_succeeded",
      userId: confirmation.userId,
      metadata: { confirmationId: confirmation.id, replay: true },
    });
    return { merged: true, userId: confirmation.userId };
  }
  if (confirmation.status === "FAILED" || confirmation.expiresAt <= new Date()) {
    throw new AccountMergeError("ACCOUNT_MERGE_REQUIRED");
  }
  if (!await gateway.claim(confirmation, new Date())) {
    await gateway.audit({
      action: "telegram_account_merge_failed",
      userId: confirmation.userId,
      severity: "WARN",
      metadata: { confirmationId: confirmation.id, errorCode: "CONFLICT", retryable: true },
    });
    throw new AccountMergeError("CONFLICT");
  }

  try {
    return await gateway.withOwnerChangeFence(confirmation, async () => {
      assertOwnerUnchanged(confirmation, await gateway.loadCurrentOwner(confirmation.userId));
      let identity = await gateway.authenticateTelegram(confirmation);
      if (identity.accountId !== confirmation.sourceAccountId && identity.accountId !== confirmation.targetAccountId) {
        throw new AccountMergeError("ACCOUNT_MERGE_REQUIRED", "Telegram owner changed");
      }
      let expectedSubscription: boolean | null = null;
      if (identity.accountId === confirmation.sourceAccountId) {
        if (identity.telegramId !== confirmation.telegramId
          || normalizedEmail(identity.email) !== confirmation.sourceEmail) {
          throw new AccountMergeError("ACCOUNT_MERGE_REQUIRED", "Telegram identity changed");
        }
        const preflight = await gateway.preflight(confirmation);
        assertPreflight(confirmation, preflight);
        expectedSubscription = (await gateway.mergeProviderAccounts(confirmation)).targetHasSubscription;
      }
      identity = await gateway.authenticateTelegram(confirmation);
      const finalSubscription = await gateway.synchronizeSubscriptionIdentity(identity);
      if (identity.accountId !== confirmation.targetAccountId
        || identity.telegramId !== confirmation.telegramId
        || normalizedEmail(identity.email) !== confirmation.targetEmail
        || !identity.emailVerified
        || normalizedEmail(identity.pendingEmail) !== null
        || (expectedSubscription !== null && expectedSubscription !== finalSubscription)) {
        throw new AccountMergeError("ACCOUNT_MERGE_REQUIRED", "Provider returned inconsistent merge result");
      }
      const linked = await gateway.linkCurrentAccount(identity);
      if (!await gateway.complete(confirmation)) throw new AccountMergeError("INTERNAL_ERROR");
      try { await gateway.refreshLocalSession(); } catch { /* committed merge remains successful */ }
      try {
        await gateway.audit({
          action: "telegram_account_merge_succeeded",
          userId: linked.userId,
          metadata: { confirmationId: confirmation.id },
        });
      } catch { /* audit failure cannot roll back a committed merge */ }
      return { merged: true, userId: linked.userId };
    });
  } catch (error) {
    await gateway.release(confirmation, { terminal: terminal(error), errorCode: errorCode(error) });
    await gateway.audit({
      action: "telegram_account_merge_failed",
      userId: confirmation.userId,
      severity: "WARN",
      metadata: { confirmationId: confirmation.id, errorCode: errorCode(error), retryable: !terminal(error) },
    });
    throw error;
  }
}

export async function cancelTelegramAccountMerge(gateway: TelegramAccountMergeGateway) {
  const confirmation = await loadAuthorizedConfirmation(gateway);
  if (confirmation.status !== "PENDING" || !await gateway.cancel(confirmation)) {
    throw new AccountMergeError("CONFLICT", "Account merge can no longer be cancelled");
  }
}
