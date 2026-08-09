import {
  TelegramCallbackError,
  type ConsumedTelegramCallback,
  type TelegramCallbackGateway,
  type TelegramCallbackInput,
  type TelegramCallbackOutcome,
  type TelegramCallbackSession,
  type TelegramProviderSession,
} from "@/application/auth/ports/telegram-callback";

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

  return gateway.withOwnerChangeFence({
    userIds: [consumed.user.id],
    upstreamAccountIds: [consumed.user.upstreamAccountId, incomingAccountId]
      .filter((id): id is string => Boolean(id)),
    telegramIds: [consumed.telegramId],
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
        });
      }
    },
  });
}

export async function completeTelegramCallback(
  gateway: TelegramCallbackGateway,
  input: TelegramCallbackInput,
): Promise<TelegramCallbackOutcome> {
  const consumed = await gateway.consume(input);
  const redirectTo = consumed.mergeConfirmation?.required
    ? "/link-account?auth=telegram_email_replace"
    : consumed.redirectTo ?? "/cabinet";
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
