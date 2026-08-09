import {
  TelegramCallbackError,
  type TelegramCallbackGateway,
  type TelegramCallbackInput,
  type TelegramCallbackSession,
  type TelegramProviderSession,
} from "@/application/auth/ports/telegram-callback";
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

type RawConsumedCallback = Awaited<ReturnType<typeof consumeTelegramCallback>>;
type ProviderSession = NonNullable<RawConsumedCallback["remnashopAuth"]>;

function providerSession(session: TelegramProviderSession) {
  return session.context as ProviderSession;
}

function reconciliationResult(
  result: Awaited<ReturnType<typeof reconcileUserFromRemnashopAuth>>,
): TelegramCallbackSession {
  return {
    userId: result.user.id,
    remnashopSession: result.remnashopSession,
    requiresTelegramRecovery: result.requiresTelegramRecovery,
  };
}

async function consume(input: TelegramCallbackInput): Promise<RawConsumedCallback> {
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

function subscriptionsConflict(error: unknown) {
  return error instanceof ServiceError
    && error.code === "CONFLICT"
    && String(error.debug?.message ?? error.message)
      .toLowerCase()
      .includes("both users have current subscriptions");
}

export const productionTelegramCallbackGateway: TelegramCallbackGateway = {
  async consume(input) {
    const result = await consume(input);
    return {
      user: { id: result.user.id, upstreamAccountId: result.user.remnashopUserId },
      redirectTo: result.redirectTo,
      providerSession: result.remnashopAuth ? { context: result.remnashopAuth } : null,
      linked: result.linked,
      telegramId: result.telegramId,
      telegramUsername: result.telegramUsername,
      mergeConfirmation: result.mergeConfirmation,
    };
  },

  providerAccountId(session) {
    return getRemnashopUserIdFromAccessToken(providerSession(session).cookies.accessToken);
  },

  async attachTelegramToCurrentAccount({ telegramId, telegramUsername, ownerFenceHeld }) {
    const tokens = await getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true });
    await remnashopLinkTelegram({ accessToken: tokens.accessToken, telegramId, telegramUsername });
    await linkCurrentUserToRemnashopAuth({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      auth: {
        expires_at: getJwtExpiresAt(tokens.accessToken)?.toISOString()
          ?? tokens.session.remnashopAccessExpiresAt?.toISOString()
          ?? new Date(Date.now() + 60_000).toISOString(),
        refresh_expires_at: getJwtExpiresAt(tokens.refreshToken)?.toISOString()
          ?? tokens.session.remnashopRefreshExpiresAt?.toISOString()
          ?? new Date(Date.now() + 60_000).toISOString(),
      },
      paymentOwnerFenceHeld: ownerFenceHeld,
    });
  },

  async mergeProviderAccounts({ sourceAccountId, targetAccountId }) {
    if (sourceAccountId === targetAccountId) return false;
    try {
      await remnashopMergeUsers({
        sourceUserId: sourceAccountId,
        targetUserId: targetAccountId,
        reason: "Clean Pay Telegram link: merge current e-mail account into owned Telegram account",
      });
      return true;
    } catch (error) {
      if (subscriptionsConflict(error)) {
        throw new TelegramCallbackError("ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT");
      }
      throw error;
    }
  },

  async linkProviderSession({ session, ownerFenceHeld, invalidateSiblingTokens }) {
    const auth = providerSession(session);
    const result = await linkCurrentUserToRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
      paymentOwnerFenceHeld: ownerFenceHeld,
      ...(invalidateSiblingTokens ? { invalidateSiblingRemnashopTokens: true } : {}),
    });
    return { userId: result.user.id, requiresTelegramRecovery: false };
  },

  async reconcileProviderSession(session) {
    const auth = providerSession(session);
    const result = await reconcileUserFromRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
    });
    return reconciliationResult(result);
  },

  withOwnerChangeFence: withPaymentOwnerChangeFence,

  logAttachFailure(error, telegramId) {
    logTechnicalWarning("telegram_link_remnashop_attach_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      telegramId,
    });
  },
};
