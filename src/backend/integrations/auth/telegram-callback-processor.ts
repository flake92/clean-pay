import type {
  TelegramCallbackInput,
  TelegramCallbackOutcome,
  TelegramCallbackProcessor,
} from "@/backend/application/auth/ports/telegram-callback";
import { ServiceError } from "@/backend/errors/service-error";
import {
  linkCurrentUserToRemnashopAuth,
  reconcileUserFromRemnashopAuth,
} from "@/backend/integrations/remnashop/session";
import {
  getAuthorizedRemnashopTokens,
  getJwtExpiresAt,
  getRemnashopUserIdFromAccessToken,
  remnashopLinkTelegram,
  remnashopMergeUsers,
} from "@/backend/integrations/remnashop/client";
import { withPaymentOwnerChangeFence } from "@/backend/integrations/payments/payment-user-merge-service";
import {
  consumeTelegramCallback,
  consumeTelegramLoginWidgetPayload,
  consumeTelegramPopupToken,
} from "@/backend/integrations/telegram/oidc";
import { logTechnicalWarning } from "@/backend/observability/audit";

type ConsumedTelegramCallback = Awaited<ReturnType<typeof consumeTelegramCallback>>;

async function linkTelegramToCurrentRemnashopAccount({
  telegramId,
  telegramUsername,
  paymentOwnerFenceHeld = false,
}: {
  telegramId: string;
  telegramUsername: string | null;
  paymentOwnerFenceHeld?: boolean;
}) {
  const tokens = await getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true });

  await remnashopLinkTelegram({
    accessToken: tokens.accessToken,
    telegramId,
    telegramUsername,
  });

  return linkCurrentUserToRemnashopAuth({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    auth: {
      expires_at:
        getJwtExpiresAt(tokens.accessToken)?.toISOString()
        ?? tokens.session.remnashopAccessExpiresAt?.toISOString()
        ?? new Date(Date.now() + 60_000).toISOString(),
      refresh_expires_at:
        getJwtExpiresAt(tokens.refreshToken)?.toISOString()
        ?? tokens.session.remnashopRefreshExpiresAt?.toISOString()
        ?? new Date(Date.now() + 60_000).toISOString(),
    },
    paymentOwnerFenceHeld,
  });
}

function isBothSubscriptionsMergeConflict(error: unknown) {
  return (
    error instanceof ServiceError
    && error.code === "CONFLICT"
    && String(error.debug?.message ?? error.message).toLowerCase().includes("both users have current subscriptions")
  );
}

async function mergeCurrentRemnashopAccountIntoTelegramAccount({
  remnashopAuth,
  currentRemnashopUserId,
}: {
  remnashopAuth: NonNullable<ConsumedTelegramCallback["remnashopAuth"]>;
  currentRemnashopUserId: string | null;
}) {
  if (!currentRemnashopUserId) {
    throw new ServiceError(
      "ACCOUNT_MERGE_REQUIRED",
      409,
      "Current Clean Pay account is not linked to Remnashop.",
    );
  }

  const sourceUserId = currentRemnashopUserId;
  const targetUserId = getRemnashopUserIdFromAccessToken(remnashopAuth.cookies.accessToken);

  if (sourceUserId === targetUserId) return false;

  try {
    await remnashopMergeUsers({
      sourceUserId,
      targetUserId,
      reason: "Clean Pay Telegram link: merge current e-mail account into owned Telegram account",
    });
  } catch (error) {
    if (isBothSubscriptionsMergeConflict(error)) {
      throw new ServiceError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "У обеих учетных записей есть активные подписки. Объединение нужно выполнить через поддержку.",
        {
          message: "У обеих учетных записей есть активные подписки. Объединение нужно выполнить через поддержку.",
        },
      );
    }

    throw error;
  }

  return true;
}

async function reconcileTelegramCallbackResult({
  linked,
  userId,
  currentRemnashopUserId,
  telegramId,
  telegramUsername,
  remnashopAuth,
}: {
  linked: boolean;
  userId: string;
  currentRemnashopUserId: string | null;
  telegramId: string;
  telegramUsername: string | null;
  remnashopAuth: ConsumedTelegramCallback["remnashopAuth"];
}) {
  if (linked) {
    const incomingRemnashopUserId = remnashopAuth
      ? getRemnashopUserIdFromAccessToken(remnashopAuth.cookies.accessToken)
      : null;

    return withPaymentOwnerChangeFence({
      userIds: [userId],
      upstreamAccountIds: [currentRemnashopUserId, incomingRemnashopUserId]
        .filter((ownerId): ownerId is string => Boolean(ownerId)),
      telegramIds: [telegramId],
      work: async () => {
        try {
          await linkTelegramToCurrentRemnashopAccount({
            telegramId,
            telegramUsername,
            paymentOwnerFenceHeld: true,
          });

          return {
            userId,
            remnashopSession: undefined,
            requiresTelegramRecovery: false,
          };
        } catch (error) {
          logTechnicalWarning("telegram_link_remnashop_attach_failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            telegramId,
          });

          if (!remnashopAuth) {
            return {
              userId,
              remnashopSession: undefined,
              requiresTelegramRecovery: false,
            };
          }

          const upstreamMerged = await mergeCurrentRemnashopAccountIntoTelegramAccount({
            remnashopAuth,
            currentRemnashopUserId,
          });
          const linkedUser = await linkCurrentUserToRemnashopAuth({
            accessToken: remnashopAuth.cookies.accessToken,
            refreshToken: remnashopAuth.cookies.refreshToken,
            auth: remnashopAuth.data,
            paymentOwnerFenceHeld: true,
            ...(upstreamMerged ? { invalidateSiblingRemnashopTokens: true } : {}),
          });

          return {
            userId: linkedUser.user.id,
            remnashopSession: undefined,
            requiresTelegramRecovery: false,
          };
        }
      },
    });
  }

  if (!remnashopAuth) {
    return {
      userId,
      remnashopSession: undefined,
      requiresTelegramRecovery: false,
    };
  }

  const reconciled = await reconcileUserFromRemnashopAuth({
    accessToken: remnashopAuth.cookies.accessToken,
    refreshToken: remnashopAuth.cookies.refreshToken,
    auth: remnashopAuth.data,
  });

  return {
    userId: reconciled.user.id,
    remnashopSession: reconciled.remnashopSession,
    requiresTelegramRecovery: reconciled.requiresTelegramRecovery,
  };
}

async function completeConsumedCallback(
  consumed: ConsumedTelegramCallback,
): Promise<TelegramCallbackOutcome> {
  const {
    user,
    redirectTo,
    remnashopAuth,
    linked,
    telegramId,
    telegramUsername,
    mergeConfirmation,
  } = consumed;
  const redirectPath = mergeConfirmation?.required
    ? "/link-account?auth=telegram_email_replace"
    : redirectTo ?? "/cabinet";
  const audit = {
    userId: user.id,
    remnashopLinked: linked || Boolean(remnashopAuth),
  };

  if (mergeConfirmation?.required) {
    return {
      redirectTo: redirectPath,
      mergeConfirmation: { token: mergeConfirmation.token },
      audit,
    };
  }

  const reconciled = await reconcileTelegramCallbackResult({
    linked,
    userId: user.id,
    currentRemnashopUserId: user.remnashopUserId,
    telegramId,
    telegramUsername,
    remnashopAuth,
  });

  return {
    redirectTo: redirectPath,
    session: reconciled,
    audit,
  };
}

async function consumeInput(input: TelegramCallbackInput): Promise<ConsumedTelegramCallback> {
  switch (input.kind) {
    case "oidc":
      return consumeTelegramCallback(input.code, input.state);
    case "popup-oidc":
      return consumeTelegramPopupToken(input.idToken);
    case "login-widget":
      return consumeTelegramLoginWidgetPayload(
        input.authData as Parameters<typeof consumeTelegramLoginWidgetPayload>[0],
      );
  }
}

export const productionTelegramCallbackProcessor: TelegramCallbackProcessor = {
  async complete(input) {
    return completeConsumedCallback(await consumeInput(input));
  },
};
