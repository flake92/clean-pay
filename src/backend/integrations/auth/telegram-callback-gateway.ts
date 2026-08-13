import {
  TelegramCallbackError,
  type TelegramCallbackGateway,
  type TelegramCallbackInput,
  type TelegramCallbackSession,
  type TelegramProviderSession,
} from "@/application/auth/ports/telegram-callback";
import { ServiceError } from "@/backend/errors/service-error";
import { prisma } from "@/backend/database/prisma";
import { AccountMergeConfirmationStatus } from "@prisma/client";
import {
  linkCurrentUserToRemnashopAuth,
  reconcileUserFromRemnashopAuth,
} from "@/backend/integrations/remnashop/session";
import {
  getAuthorizedRemnashopTokens,
  getJwtExpiresAt,
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  remnashopLinkTelegram,
  remnashopMergeUsers,
} from "@/backend/integrations/remnashop/client";
import {
  markPaymentOwnerChangeUpstreamMutationStarted,
  withPaymentOwnerChangeFence,
} from "@/backend/integrations/payments/payment-user-merge-service";
import {
  clearTelegramAuthCookies,
  verifyTelegramCallback,
  verifyTelegramWidgetCallbackPayload,
  verifyTelegramPopupToken,
} from "@/backend/integrations/telegram/oidc";
import { auditLog, logTechnicalWarning } from "@/backend/observability/audit";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { assertUserMergeFinalOwner, mergeLocalUsersIntoTarget } from "@/backend/integrations/auth/local-user-merge-service";
import { randomToken, sha256 } from "@/backend/security/crypto";
import { synchronizeProviderAccountIdentity } from "@/backend/integrations/auth/provider-account-identity-sync";

type ProviderSession = {
  cookies: { accessToken: string; refreshToken: string };
  data: { expires_at: string; refresh_expires_at: string };
};
type VerifiedResult = {
  authState: { id: string; userId: string | null; redirectTo: string | null };
  identity: {
    telegramId: string; telegramUsername: string | null; fullName: string | null; photoUrl: string | null;
    remnashopAuthResult?: ProviderSession | null;
  };
};

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

async function consume(input: TelegramCallbackInput): Promise<VerifiedResult> {
  switch (input.kind) {
    case "oidc":
      return verifyTelegramCallback(input.code, input.state) as Promise<VerifiedResult>;
    case "popup-oidc":
      return verifyTelegramPopupToken(input.idToken) as Promise<VerifiedResult>;
    case "login-widget":
      return verifyTelegramWidgetCallbackPayload(input.authData as never) as Promise<VerifiedResult>;
  }
}

function localUser(user: { id: string; remnashopUserId: string | null; email: string | null; emailVerified: boolean; telegramId: string | null }) {
  return { id: user.id, upstreamAccountId: user.remnashopUserId, email: user.email, emailVerified: user.emailVerified, telegramId: user.telegramId };
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
      authState: {
        id: result.authState.id,
        targetUserId: result.authState.userId,
        redirectTo: result.authState.redirectTo,
      },
      identity: {
        telegramId: result.identity.telegramId,
        telegramUsername: result.identity.telegramUsername,
        fullName: result.identity.fullName,
        photoUrl: result.identity.photoUrl,
        providerSession: result.identity.remnashopAuthResult ? { context: result.identity.remnashopAuthResult } : null,
      },
    };
  },

  async assertIdentityRateLimit(input) {
    await assertRateLimit({
      action: input.linked ? "telegram_link_confirm" : "telegram_login_confirm",
      tgId: input.telegramId,
      limit: 10,
      windowSeconds: 15 * 60,
    });
  },

  async findUserByTelegramId(telegramId) {
    const user = await prisma.webUser.findUnique({ where: { telegramId } });
    return user ? localUser(user) : null;
  },

  async findUserById(userId) {
    const user = await prisma.webUser.findUnique({ where: { id: userId } });
    return user ? localUser(user) : null;
  },

  async loadProviderMergeIdentity(session) {
    const auth = providerSession(session);
    const profile = await getRemnashopMe(auth.cookies.accessToken);
    return {
      accountId: getRemnashopUserIdFromAccessToken(auth.cookies.accessToken),
      email: profile.email,
      emailVerified: profile.is_email_verified,
      pendingEmail: profile.pending_email,
      telegramId: profile.telegram_id === null ? null : String(profile.telegram_id),
    };
  },

  async preflightAccountMerge(input) {
    const result = await remnashopMergeUsers({
      sourceUserId: input.sourceAccountId,
      targetUserId: input.targetAccountId,
      reason: "Clean Pay confirmed account merge: keep target e-mail and selected source Telegram (dry run)",
      dryRun: true,
      emailResolution: "KEEP_TARGET",
      telegramResolution: "KEEP_SOURCE",
      paymentResolution: "REKEY_SOURCE",
    });
    return {
      conflicts: result.conflicts,
      dryRun: result.dry_run,
      sourceAccountId: String(result.source_user_id),
      targetAccountId: String(result.target_user_id),
      target: {
        accountId: String(result.target.id),
        email: result.target.email,
        emailVerified: result.target.is_email_verified,
        telegramId: result.target.telegram_id === null ? null : String(result.target.telegram_id),
      },
      requiresRelogin: result.requires_relogin,
    };
  },

  async persistAccountMergeConfirmation(input) {
    const token = randomToken();
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "WebUser" WHERE "id" = ${input.userId} FOR UPDATE
      `;
      const owner = await tx.webUser.findUnique({
        where: { id: input.userId },
        select: { paymentOwnerChangeTokenHash: true },
      });
      if (owner?.paymentOwnerChangeTokenHash) {
        throw new ServiceError(
          "CONFLICT",
          409,
          "The previous account merge still owns the payment transition.",
        );
      }
      const active = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AccountMergeConfirmation"
        WHERE "userId" = ${input.userId} AND "status" = 'PROCESSING'
          AND "leaseExpiresAt" > clock_timestamp() LIMIT 1 FOR UPDATE
      `;
      if (active.length) throw new ServiceError("CONFLICT", 409, "Another account merge is already being processed.");
      await tx.accountMergeConfirmation.updateMany({
        where: {
          userId: input.userId,
          OR: [
            { status: AccountMergeConfirmationStatus.PENDING },
            { status: AccountMergeConfirmationStatus.PROCESSING, leaseExpiresAt: { lte: now } },
          ],
        },
        data: { status: AccountMergeConfirmationStatus.FAILED, lastErrorCode: "SUPERSEDED" },
      });
      await tx.accountMergeConfirmation.create({
        data: {
          userId: input.userId,
          tokenHash: sha256(token),
          telegramId: input.telegramId,
          telegramUsername: input.telegramUsername,
          sourceEmail: input.sourceEmail,
          targetEmail: input.targetEmail,
          targetTelegramId: input.targetTelegramId,
          sourceRemnashopUserId: input.sourceAccountId,
          targetRemnashopUserId: input.targetAccountId,
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        },
      });
    });
    return { token };
  },

  async applyTelegramIdentity(input) {
    const existing = input.existingTelegramUserId
      ? await prisma.webUser.findUnique({ where: { id: input.existingTelegramUserId } })
      : null;
    const user = input.targetUserId
      ? await prisma.$transaction(async (tx) => {
          const target = await tx.webUser.findUniqueOrThrow({ where: { id: input.targetUserId! } });
          const source = existing && existing.id !== input.targetUserId ? existing : null;
          if (source) {
            await mergeLocalUsersIntoTarget(tx, {
              targetUserId: input.targetUserId!,
              targetUpstreamAccountId: target.remnashopUserId ?? source.remnashopUserId,
              sourceUserIds: [source.id],
              ownerExpectations: [target, source].map((owner) => ({
                id: owner.id, remnashopUserId: owner.remnashopUserId, email: owner.email, telegramId: owner.telegramId,
              })),
            });
          }
          const updated = await tx.webUser.update({
            where: { id: input.targetUserId! },
            data: {
              remnashopUserId: target.remnashopUserId ?? source?.remnashopUserId,
              email: target.email ?? source?.email,
              emailVerified: target.emailVerified || Boolean(source?.emailVerified),
              telegramId: input.telegramId,
              telegramUsername: input.telegramUsername,
              fullName: input.fullName,
              photoUrl: input.photoUrl,
              displayName: input.fullName ?? input.telegramUsername,
              authPending: false,
              pendingRemnashopUserId: null,
              pendingRemnashopEmail: null,
              lastLoginAt: new Date(),
            },
          });
          if (source) {
            await assertUserMergeFinalOwner(tx, {
              targetUserId: updated.id,
              sourceUserIds: [source.id],
              expected: { telegramId: input.telegramId, ...(updated.remnashopUserId ? { remnashopUserId: updated.remnashopUserId } : {}), ...(updated.email ? { email: updated.email } : {}) },
            });
          }
          return updated;
        })
      : await prisma.webUser.upsert({
          where: { telegramId: input.telegramId },
          create: { telegramId: input.telegramId, telegramUsername: input.telegramUsername, fullName: input.fullName, photoUrl: input.photoUrl, displayName: input.fullName ?? input.telegramUsername, lastLoginAt: new Date() },
          update: { telegramUsername: input.telegramUsername, fullName: input.fullName, photoUrl: input.photoUrl, displayName: input.fullName ?? input.telegramUsername, lastLoginAt: new Date() },
        });
    return localUser(user);
  },

  async markAuthStateUser(authStateId, userId) {
    await prisma.telegramAuthState.update({ where: { id: authStateId }, data: { userId } });
  },

  async auditIdentityResolved(input) {
    await auditLog({ action: input.linked ? "telegram_link_success" : "telegram_login", userId: input.userId });
  },

  clearTemporaryAuth: clearTelegramAuthCookies,

  providerAccountId(session) {
    return getRemnashopUserIdFromAccessToken(providerSession(session).cookies.accessToken);
  },

  async attachTelegramToCurrentAccount({ telegramId, telegramUsername, ownerFenceHeld }) {
    const tokens = await getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true });
    await markPaymentOwnerChangeUpstreamMutationStarted();
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
      await markPaymentOwnerChangeUpstreamMutationStarted();
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
    await synchronizeProviderAccountIdentity(auth.cookies.accessToken);
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
