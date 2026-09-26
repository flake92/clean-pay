import {
  TelegramSessionRecoveryError,
  type TelegramRecoveryPlan,
  type TelegramRecoveryProviderSession,
  type TelegramRecoverySession,
  type TelegramSessionRecoveryGateway,
} from "@/application/auth/ports/telegram-session-recovery";
import { paymentOwnerTransitionKey } from "@/shared/domain/payment-owner-transition";

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function recoveryError(reason: string): never {
  throw new TelegramSessionRecoveryError(reason);
}

function assertTelegramOwner(
  provider: TelegramRecoveryProviderSession,
  expectedTelegramId: string,
  stage: "before_merge" | "after_merge",
) {
  if (provider.telegramId !== expectedTelegramId) {
    recoveryError(`telegram_profile_mismatch_${stage}`);
  }
}

function buildPlan(
  session: TelegramRecoverySession,
  initialProvider: TelegramRecoveryProviderSession,
): TelegramRecoveryPlan {
  const pendingMergeIsProven = Boolean(
    session.authPending && session.pendingUpstreamAccountId && session.pendingEmail,
  );
  const recoveryEmail = pendingMergeIsProven
    ? session.pendingEmail
    : session.emailVerified
      ? session.email
      : null;
  const expectedEmail = normalizedEmail(recoveryEmail);
  const targetAccountId = pendingMergeIsProven
    ? session.pendingUpstreamAccountId!
    : initialProvider.accountId;
  const sourceAccountId = session.upstreamAccountId;

  if (pendingMergeIsProven) {
    const initialMatchesTransition = sourceAccountId
      ? initialProvider.accountId === sourceAccountId || initialProvider.accountId === targetAccountId
      : initialProvider.accountId === targetAccountId;
    if (!initialMatchesTransition) recoveryError("pending_merge_telegram_owner_is_unrelated");
  }

  if (sourceAccountId && sourceAccountId !== initialProvider.accountId) {
    if (!expectedEmail) recoveryError("upstream_id_mismatch_without_verified_email");
    const candidateEmail = normalizedEmail(initialProvider.email);
    if (candidateEmail && candidateEmail !== expectedEmail) {
      recoveryError("telegram_candidate_has_another_email");
    }
  }

  const verifiedRecoveryEmail = recoveryEmail
    ?? (initialProvider.emailVerified ? initialProvider.email : null);

  return {
    session,
    initialProvider,
    sourceAccountId,
    targetAccountId,
    expectedEmail,
    finalEmail: verifiedRecoveryEmail,
    finalEmailVerified: Boolean(verifiedRecoveryEmail),
  };
}

function assertFinalProvider(
  plan: TelegramRecoveryPlan,
  provider: TelegramRecoveryProviderSession,
  upstreamMerged: boolean,
) {
  if (plan.sourceAccountId
    && !upstreamMerged
    && plan.sourceAccountId !== provider.accountId) {
    recoveryError("upstream_id_mismatch");
  }
  if (provider.accountId !== plan.targetAccountId) {
    recoveryError("post_merge_telegram_owner_changed");
  }
  if (plan.expectedEmail
    && (normalizedEmail(provider.email) !== plan.expectedEmail || !provider.emailVerified)) {
    recoveryError("verified_email_mismatch");
  }
  if (plan.finalEmailVerified
    && normalizedEmail(provider.email) !== normalizedEmail(plan.finalEmail)) {
    recoveryError("final_local_email_does_not_match_upstream_owner");
  }
}

export async function recoverTelegramSession<TResult>(
  gateway: TelegramSessionRecoveryGateway<TResult>,
  session: TelegramRecoverySession,
) {
  if (!session.telegramId || !gateway.configurationAvailable()) {
    gateway.recoverySkipped(session);
    return null;
  }
  const telegramId = session.telegramId;
  gateway.recoveryStarted(session);

  const initialProvider = await gateway.authenticateTelegram({
    telegramId,
    telegramUsername: session.telegramUsername,
  });
  assertTelegramOwner(initialProvider, telegramId, "before_merge");
  const plan = buildPlan(session, initialProvider);
  const operationKey = paymentOwnerTransitionKey({
    actorUserId: session.userId,
    sourceUpstreamAccountId: plan.sourceAccountId ?? initialProvider.accountId,
    targetUpstreamAccountId: plan.targetAccountId,
    telegramId,
  });

  const recovered = await gateway.withOwnerChangeFence({
    plan,
    operationKey,
    work: async () => {
      const snapshot = await gateway.captureLocalSnapshot(plan);
      let provider = initialProvider;
      let upstreamMerged = Boolean(
        session.authPending
        && session.pendingUpstreamAccountId
        && initialProvider.accountId === plan.targetAccountId
        && plan.sourceAccountId !== plan.targetAccountId,
      );

      if (plan.sourceAccountId
        && plan.sourceAccountId !== plan.targetAccountId
        && !upstreamMerged) {
        const deadlineAt = Date.now() + 20_000;
        const merged = await gateway.mergeProviderAccounts({
          sourceAccountId: plan.sourceAccountId,
          targetAccountId: plan.targetAccountId,
          reason: "Clean Pay Telegram recovery: verified local owner and Telegram identity",
          emailResolution: "KEEP_TARGET",
          telegramResolution: "KEEP_SOURCE",
          paymentResolution: "REKEY_SOURCE",
          deadlineAt,
        });
        if (merged.dryRun
          || merged.sourceAccountId !== plan.sourceAccountId
          || merged.targetAccountId !== plan.targetAccountId
          || !merged.targetAccountMatches
          || merged.conflicts.length !== 0
          || !merged.requiresRelogin) {
          recoveryError("upstream_merge_result_mismatch");
        }
        provider = await gateway.authenticateTelegram({
          telegramId,
          telegramUsername: session.telegramUsername,
          deadlineAt,
        });
        assertTelegramOwner(provider, telegramId, "after_merge");
        upstreamMerged = true;
      }

      assertFinalProvider(plan, provider, upstreamMerged);
      provider = await gateway.synchronizeProviderIdentity({
        provider,
        expected: {
          accountId: plan.targetAccountId,
          email: plan.finalEmail,
          emailVerified: plan.finalEmailVerified,
          pendingEmail: null,
          telegramId,
        },
      });
      assertFinalProvider(plan, provider, upstreamMerged);
      const result = await gateway.commitLocalRecovery({
        plan,
        snapshot,
        provider,
        upstreamMerged,
      });
      return { result, provider, upstreamMerged };
    },
  });

  gateway.recoverySucceeded({
    session,
    provider: recovered.provider,
    upstreamMerged: recovered.upstreamMerged,
  });
  return recovered.result;
}
