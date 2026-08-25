import {
  TelegramCallbackError,
  type ConsumedTelegramCallback,
  type TelegramCallbackGateway,
  type TelegramCallbackInput,
  type TelegramCallbackOutcome,
  type TelegramCallbackSession,
  type TelegramLocalUser,
  type TelegramProviderSession,
  type VerifiedTelegramCallback,
} from "@/application/auth/ports/telegram-callback";
import { paymentOwnerTransitionKey } from "@/shared/domain/payment-owner-transition";
import { safePostAuthContinuation } from "@/shared/domain/post-auth-continuation";

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

async function stageAccountMerge(
  gateway: TelegramCallbackGateway,
  target: TelegramLocalUser,
  identity: VerifiedTelegramCallback["identity"],
) {
  if (!target.email || !target.emailVerified || !target.upstreamAccountId) {
    throw new TelegramCallbackError("ACCOUNT_MERGE_REQUIRED");
  }
  const source = await gateway.loadProviderMergeIdentity(identity.providerSession!);
  if (source.telegramId !== identity.telegramId) throw new TelegramCallbackError("ACCOUNT_MERGE_REQUIRED");
  if (source.accountId === target.upstreamAccountId) return { required: false as const };
  const preflight = await gateway.preflightAccountMerge({
    sourceAccountId: source.accountId,
    targetAccountId: target.upstreamAccountId,
  });
  if (preflight.conflicts.some((item) => item.toLowerCase().includes("both users have current subscriptions"))) {
    throw new TelegramCallbackError("ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT");
  }
  const transient = (item: string) => {
    const value = item.toLowerCase();
    return value.includes("active payment operations") || value.includes("payment fulfillment in progress");
  };
  if (preflight.conflicts.some((item) => !transient(item))
    || !preflight.dryRun
    || preflight.sourceAccountId !== source.accountId
    || preflight.targetAccountId !== target.upstreamAccountId
    || preflight.target.accountId !== target.upstreamAccountId
    || normalizedEmail(preflight.target.email) !== normalizedEmail(target.email)
    || !preflight.target.emailVerified
    || preflight.target.telegramId !== target.telegramId
    || !preflight.requiresRelogin) {
    throw new TelegramCallbackError("ACCOUNT_MERGE_REQUIRED");
  }
  const persisted = await gateway.persistAccountMergeConfirmation({
    userId: target.id,
    telegramId: identity.telegramId,
    telegramUsername: identity.telegramUsername,
    sourceEmail: normalizedEmail(source.email),
    targetEmail: normalizedEmail(target.email)!,
    targetTelegramId: target.telegramId,
    sourceAccountId: source.accountId,
    targetAccountId: target.upstreamAccountId,
  });
  return { required: true as const, token: persisted.token };
}

async function resolveVerifiedIdentity(
  gateway: TelegramCallbackGateway,
  verified: VerifiedTelegramCallback,
): Promise<ConsumedTelegramCallback> {
  const { authState, identity } = verified;
  const linked = Boolean(authState.targetUserId);
  await gateway.assertIdentityRateLimit({ linked, telegramId: identity.telegramId });
  const [existingTelegramUser, targetUser] = await Promise.all([
    gateway.findUserByTelegramId(identity.telegramId),
    authState.targetUserId ? gateway.findUserById(authState.targetUserId) : Promise.resolve(null),
  ]);
  if (authState.targetUserId && targetUser && !identity.providerSession) {
    throw new TelegramCallbackError("UPSTREAM_UNAVAILABLE");
  }
  if (authState.targetUserId && targetUser && identity.providerSession) {
    const merge = await stageAccountMerge(gateway, targetUser, identity);
    if (merge.required) {
      await gateway.clearTemporaryAuth();
      return {
        user: targetUser,
        redirectTo: authState.redirectTo,
        providerSession: identity.providerSession,
        linked: true,
        telegramId: identity.telegramId,
        telegramUsername: identity.telegramUsername,
        mergeConfirmation: { required: true, token: merge.token! },
      };
    }
  }
  const provenProviderAccountId = identity.providerSession
    ? gateway.providerAccountId(identity.providerSession)
    : null;
  if (authState.targetUserId
    && existingTelegramUser
    && existingTelegramUser.id !== authState.targetUserId
    && existingTelegramUser.upstreamAccountId
    && existingTelegramUser.upstreamAccountId !== provenProviderAccountId) {
    throw new TelegramCallbackError("ACCOUNT_MERGE_REQUIRED");
  }
  const user = await gateway.applyTelegramIdentity({
    targetUserId: authState.targetUserId,
    existingTelegramUserId: existingTelegramUser?.id ?? null,
    expectedExistingUpstreamAccountId: existingTelegramUser?.upstreamAccountId ?? null,
    provenProviderAccountId,
    telegramId: identity.telegramId,
    telegramUsername: identity.telegramUsername,
    fullName: identity.fullName,
    photoUrl: identity.photoUrl,
  });
  await gateway.markAuthStateUser(authState.id, user.id);
  await gateway.auditIdentityResolved({ linked, userId: user.id });
  await gateway.clearTemporaryAuth();
  return {
    user,
    redirectTo: authState.redirectTo,
    providerSession: identity.providerSession,
    linked,
    telegramId: identity.telegramId,
    telegramUsername: identity.telegramUsername,
    mergeConfirmation: null,
  };
}

async function mergeIntoTelegramAccount(
  gateway: TelegramCallbackGateway,
  providerSession: TelegramProviderSession,
  currentAccountId: string | null,
) {
  if (!currentAccountId) throw new TelegramCallbackError("ACCOUNT_MERGE_REQUIRED");
  return gateway.mergeProviderAccounts({
    sourceAccountId: currentAccountId,
    targetAccountId: gateway.providerAccountId(providerSession),
  });
}

async function reconcileLinkedCallback(
  gateway: TelegramCallbackGateway,
  consumed: ConsumedTelegramCallback,
): Promise<TelegramCallbackSession> {
  const incomingAccountId = consumed.providerSession
    ? gateway.providerAccountId(consumed.providerSession)
    : null;
  const targetAccountId = incomingAccountId ?? consumed.user.upstreamAccountId;
  if (!targetAccountId) {
    throw new TelegramCallbackError("ACCOUNT_MERGE_REQUIRED");
  }

  return gateway.withOwnerChangeFence({
    userIds: [consumed.user.id],
    upstreamAccountIds: [consumed.user.upstreamAccountId, incomingAccountId]
      .filter((id): id is string => Boolean(id)),
    telegramIds: [consumed.telegramId],
    operationKey: paymentOwnerTransitionKey({
      actorUserId: consumed.user.id,
      sourceUpstreamAccountId:
        consumed.user.upstreamAccountId ?? targetAccountId,
      targetUpstreamAccountId: targetAccountId,
      telegramId: consumed.telegramId,
    }),
    targetUpstreamAccountId: targetAccountId,
    work: async () => {
      try {
        await gateway.attachTelegramToCurrentAccount({
          telegramId: consumed.telegramId,
          telegramUsername: consumed.telegramUsername,
          ownerFenceHeld: true,
        });
        return { userId: consumed.user.id, requiresTelegramRecovery: false };
      } catch (error) {
        gateway.logAttachFailure(error, consumed.telegramId);
        if (!consumed.providerSession) {
          return { userId: consumed.user.id, requiresTelegramRecovery: false };
        }
        const merged = await mergeIntoTelegramAccount(
          gateway,
          consumed.providerSession,
          consumed.user.upstreamAccountId,
        );
        return gateway.linkProviderSession({
          session: consumed.providerSession,
          ownerFenceHeld: true,
          invalidateSiblingTokens: merged,
          expectedIdentity: {
            accountId: targetAccountId,
            email: consumed.user.email,
            emailVerified: consumed.user.emailVerified,
            pendingEmail: null,
            telegramId: consumed.telegramId,
          },
        });
      }
    },
  });
}

export async function completeTelegramCallback(
  gateway: TelegramCallbackGateway,
  input: TelegramCallbackInput,
): Promise<TelegramCallbackOutcome> {
  const consumed = await resolveVerifiedIdentity(gateway, await gateway.consume(input));
  const redirectTo = consumed.mergeConfirmation?.required
    ? "/link-account?auth=telegram_email_replace"
    : safePostAuthContinuation(consumed.redirectTo) ?? "/cabinet";
  const audit = {
    userId: consumed.user.id,
    remnashopLinked: consumed.linked || Boolean(consumed.providerSession),
  };

  if (consumed.mergeConfirmation?.required) {
    return { redirectTo, mergeConfirmation: { token: consumed.mergeConfirmation.token }, audit };
  }

  const session = consumed.linked
    ? await reconcileLinkedCallback(gateway, consumed)
    : consumed.providerSession
      ? await gateway.reconcileProviderSession(consumed.providerSession)
      : { userId: consumed.user.id, requiresTelegramRecovery: false };

  return { redirectTo, session, audit };
}
