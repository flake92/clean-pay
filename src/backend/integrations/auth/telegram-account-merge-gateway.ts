import { AccountMergeConfirmationStatus } from "@prisma/client";
import { cookies } from "next/headers";

import {
  AccountMergeError,
  type AccountMergeConfirmation,
  type AccountMergeProviderIdentity,
  type TelegramAccountMergeGateway,
} from "@/application/auth/ports/telegram-account-merge";
import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import { telegramAccountMergeCookieName } from "@/backend/integrations/auth/telegram-account-merge-store";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  remnashopAuthTelegramIdentity,
  remnashopMergeUsers,
} from "@/backend/integrations/remnashop/client";
import { linkCurrentUserToRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { getCurrentSession, refreshCurrentAccessCookie } from "@/backend/integrations/sessions/web-session-service";
import {
  markPaymentOwnerChangeUpstreamMutationStarted,
  reconcileCompletedPaymentOwnerChange,
  withPaymentOwnerChangeFence,
} from "@/backend/integrations/payments/payment-user-merge-service";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { sha256 } from "@/backend/security/crypto";
import { synchronizeProviderAccountIdentity } from "@/backend/integrations/auth/provider-account-identity-sync";

const processingLeaseMs = 2 * 60 * 1000;
const mergeReason = "Clean Pay confirmed account merge: keep target e-mail and selected source Telegram";
type ProviderAuth = Awaited<ReturnType<typeof remnashopAuthTelegramIdentity>>;

function providerAuth(identity: AccountMergeProviderIdentity) {
  return identity.context as ProviderAuth;
}

function translate(error: unknown): never {
  if (error instanceof AccountMergeError) throw error;
  throw new AccountMergeError(error instanceof ServiceError ? error.code : "INTERNAL_ERROR");
}

async function adapt<T>(work: () => Promise<T>) {
  try { return await work(); } catch (error) { translate(error); }
}

function confirmationContext(confirmation: AccountMergeConfirmation) {
  return confirmation.context as {
    confirmationId: string;
    sessionUserId: string;
    claimLeaseExpiresAt?: Date;
  };
}

export const productionTelegramAccountMergeGateway: TelegramAccountMergeGateway = {
  async loadActor() {
    const session = await adapt(() => getCurrentSession());
    return session ? { userId: session.userId, fullAssurance: session.assuranceLevel === "FULL" } : null;
  },
  async loadConfirmation(userId) {
    const token = (await cookies()).get(telegramAccountMergeCookieName)?.value;
    if (!token) throw new AccountMergeError("NOT_FOUND");
    const record = await prisma.accountMergeConfirmation.findFirst({
      where: { tokenHash: sha256(token), userId },
    });
    if (!record) throw new AccountMergeError("NOT_FOUND");
    return {
      context: { confirmationId: record.id, sessionUserId: userId },
      id: record.id,
      userId,
      status: record.status,
      expiresAt: record.expiresAt,
      sourceAccountId: record.sourceRemnashopUserId,
      targetAccountId: record.targetRemnashopUserId,
      sourceEmail: record.sourceEmail,
      targetEmail: record.targetEmail,
      targetTelegramId: record.targetTelegramId,
      telegramId: record.telegramId,
      telegramUsername: record.telegramUsername,
    };
  },

  async assertRateLimit(telegramId) {
    await adapt(() => assertRateLimit({
      action: "telegram_account_merge_confirm",
      tgId: telegramId,
      limit: 5,
      windowSeconds: 15 * 60,
    }));
  },

  async audit(input) { await adapt(() => auditLog(input)); },

  async claim(confirmation, now) {
    const context = confirmationContext(confirmation);
    const claimLeaseExpiresAt = new Date(now.getTime() + processingLeaseMs);
    const claimed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "WebUser" WHERE "id" = ${context.sessionUserId} FOR UPDATE
      `;
      const owner = await tx.webUser.findUnique({
        where: { id: context.sessionUserId },
        select: {
          paymentOwnerChangeTokenHash: true,
          paymentOwnerChangeLeaseExpiresAt: true,
        },
      });
      if (
        owner?.paymentOwnerChangeTokenHash &&
        (!owner.paymentOwnerChangeLeaseExpiresAt ||
          owner.paymentOwnerChangeLeaseExpiresAt > now)
      ) {
        return { count: 0 };
      }
      return tx.accountMergeConfirmation.updateMany({
        where: {
          id: context.confirmationId,
          userId: context.sessionUserId,
          expiresAt: { gt: now },
          OR: [
            { status: AccountMergeConfirmationStatus.PENDING },
            { status: AccountMergeConfirmationStatus.PROCESSING, leaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: AccountMergeConfirmationStatus.PROCESSING,
          leaseExpiresAt: claimLeaseExpiresAt,
          attemptCount: { increment: 1 },
          lastErrorCode: null,
        },
      });
    });
    if (claimed.count === 1) {
      context.claimLeaseExpiresAt = claimLeaseExpiresAt;
      return true;
    }
    return false;
  },

  withOwnerChangeFence(confirmation, work) {
    const context = confirmationContext(confirmation);
    if (!context.claimLeaseExpiresAt) {
      throw new AccountMergeError("CONFLICT");
    }
    return withPaymentOwnerChangeFence({
      userIds: [confirmation.userId],
      upstreamAccountIds: [confirmation.sourceAccountId, confirmation.targetAccountId],
      emails: [confirmation.sourceEmail, confirmation.targetEmail],
      telegramIds: [confirmation.telegramId, confirmation.targetTelegramId],
      operationKey: `telegram-account-merge:v1:${confirmation.id}`,
      targetUpstreamAccountId: confirmation.targetAccountId,
      claimGuard: async (tx) => {
        const current = await tx.accountMergeConfirmation.findFirst({
          where: {
            id: context.confirmationId,
            userId: context.sessionUserId,
            status: AccountMergeConfirmationStatus.PROCESSING,
            AND: [
              { leaseExpiresAt: context.claimLeaseExpiresAt },
              { leaseExpiresAt: { gt: new Date() } },
            ],
          },
          select: { id: true },
        });
        if (!current) {
          throw new AccountMergeError("CONFLICT");
        }
      },
      work,
    });
  },

  async loadCurrentOwner(userId) {
    const user = await prisma.webUser.findUnique({ where: { id: userId } });
    return user ? {
      email: user.email,
      emailVerified: user.emailVerified,
      upstreamAccountId: user.remnashopUserId,
      telegramId: user.telegramId,
    } : null;
  },

  async authenticateTelegram(confirmation) {
    const auth = await adapt(() => remnashopAuthTelegramIdentity({
      telegramId: confirmation.telegramId,
      telegramUsername: confirmation.telegramUsername,
    }));
    const profile = await adapt(() => getRemnashopMe(auth.cookies.accessToken));
    return {
      context: auth,
      accountId: getRemnashopUserIdFromAccessToken(auth.cookies.accessToken),
      telegramId: profile.telegram_id === null ? null : String(profile.telegram_id),
      email: profile.email,
      emailVerified: profile.is_email_verified,
      pendingEmail: profile.pending_email,
    };
  },

  async preflight(confirmation) {
    const result = await adapt(() => remnashopMergeUsers({
      sourceUserId: confirmation.sourceAccountId,
      targetUserId: confirmation.targetAccountId,
      reason: `${mergeReason} (dry run)`,
      dryRun: true,
      emailResolution: "KEEP_TARGET",
      telegramResolution: "KEEP_SOURCE",
      paymentResolution: "REKEY_SOURCE",
    }));
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

  async mergeProviderAccounts(confirmation) {
    await markPaymentOwnerChangeUpstreamMutationStarted();
    const result = await adapt(() => remnashopMergeUsers({
      sourceUserId: confirmation.sourceAccountId,
      targetUserId: confirmation.targetAccountId,
      reason: mergeReason,
      dryRun: false,
      emailResolution: "KEEP_TARGET",
      telegramResolution: "KEEP_SOURCE",
      paymentResolution: "REKEY_SOURCE",
    }));
    return { targetHasSubscription: Boolean(result.target.current_subscription_id) };
  },

  async synchronizeSubscriptionIdentity(identity) {
    return adapt(() => synchronizeProviderAccountIdentity(providerAuth(identity).cookies.accessToken));
  },

  async linkCurrentAccount(identity) {
    const auth = providerAuth(identity);
    const linked = await adapt(() => linkCurrentUserToRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
      invalidateSiblingRemnashopTokens: true,
      paymentOwnerFenceHeld: true,
    }));
    return { userId: linked.user.id };
  },

  async complete(confirmation) {
    const context = confirmationContext(confirmation);
    if (!context.claimLeaseExpiresAt) return false;
    const result = await prisma.accountMergeConfirmation.updateMany({
      where: {
        id: context.confirmationId,
        userId: context.sessionUserId,
        status: AccountMergeConfirmationStatus.PROCESSING,
        leaseExpiresAt: context.claimLeaseExpiresAt,
      },
      data: { status: AccountMergeConfirmationStatus.COMPLETED, completedAt: new Date(), leaseExpiresAt: null, lastErrorCode: null },
    });
    return result.count === 1;
  },

  async cancel(confirmation) {
    const context = confirmationContext(confirmation);
    const result = await prisma.accountMergeConfirmation.updateMany({
      where: { id: context.confirmationId, userId: context.sessionUserId, status: AccountMergeConfirmationStatus.PENDING },
      data: { status: AccountMergeConfirmationStatus.FAILED, lastErrorCode: "USER_CANCELLED" },
    });
    return result.count === 1;
  },

  async release(confirmation, input) {
    const context = confirmationContext(confirmation);
    if (!context.claimLeaseExpiresAt) return;
    const identitySelectors = [
      confirmation.sourceEmail,
      confirmation.targetEmail,
    ].filter((value): value is string => Boolean(value));
    const telegramSelectors = [
      confirmation.telegramId,
      confirmation.targetTelegramId,
    ].filter((value): value is string => Boolean(value));
    const incompleteOwnerChange = await prisma.webUser.findFirst({
      where: {
        paymentOwnerChangeOperationHash: sha256(
          `telegram-account-merge:v1:${confirmation.id}`,
        ),
        paymentOwnerChangeMutationStartedAt: { not: null },
        OR: [
          { id: context.sessionUserId },
          {
            remnashopUserId: {
              in: [confirmation.sourceAccountId, confirmation.targetAccountId],
            },
          },
          ...(identitySelectors.length > 0
            ? [{ email: { in: identitySelectors } }]
            : []),
          ...(telegramSelectors.length > 0
            ? [{ telegramId: { in: telegramSelectors } }]
            : []),
        ],
      },
      select: { id: true },
    });
    // Once an upstream owner mutation may have crossed the provider boundary,
    // keep the durable confirmation retryable. A later attempt takes over the
    // expired owner lease and reconciles the provider/local result.
    const terminal = input.terminal && !incompleteOwnerChange;
    await prisma.accountMergeConfirmation.updateMany({
      where: {
        id: context.confirmationId,
        userId: context.sessionUserId,
        status: AccountMergeConfirmationStatus.PROCESSING,
        leaseExpiresAt: context.claimLeaseExpiresAt,
      },
      data: {
        status: terminal ? AccountMergeConfirmationStatus.FAILED : AccountMergeConfirmationStatus.PENDING,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode,
      },
    });
  },

  async refreshLocalSession() { await refreshCurrentAccessCookie(); },
  async reconcileCompletedOwnerChange(confirmation) {
    await adapt(() => reconcileCompletedPaymentOwnerChange(
      [confirmation.userId],
      `telegram-account-merge:v1:${confirmation.id}`,
    ));
  },
};
