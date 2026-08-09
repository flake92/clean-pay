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
  remnashopRequest,
} from "@/backend/integrations/remnashop/client";
import { linkCurrentUserToRemnashopAuth } from "@/backend/integrations/remnashop/session";
import type { CurrentSubscriptionResponse } from "@/backend/integrations/remnashop/contracts";
import { getCurrentSession, refreshCurrentAccessCookie } from "@/backend/integrations/sessions/web-session-service";
import { withPaymentOwnerChangeFence } from "@/backend/integrations/payments/payment-user-merge-service";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { sha256 } from "@/backend/security/crypto";

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
  return confirmation.context as { confirmationId: string; sessionUserId: string };
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
    const claimed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "WebUser" WHERE "id" = ${context.sessionUserId} FOR UPDATE
      `;
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
          leaseExpiresAt: new Date(now.getTime() + processingLeaseMs),
          attemptCount: { increment: 1 },
          lastErrorCode: null,
        },
      });
    });
    return claimed.count === 1;
  },

  withOwnerChangeFence(confirmation, work) {
    return withPaymentOwnerChangeFence({
      userIds: [confirmation.userId],
      upstreamAccountIds: [confirmation.sourceAccountId, confirmation.targetAccountId],
      emails: [confirmation.sourceEmail, confirmation.targetEmail],
      telegramIds: [confirmation.telegramId],
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

  async loadCurrentSubscription(identity) {
    return Boolean(await adapt(() => remnashopRequest<CurrentSubscriptionResponse | null>(
      "/subscription/current",
      { accessToken: providerAuth(identity).cookies.accessToken },
    )));
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
    const result = await prisma.accountMergeConfirmation.updateMany({
      where: { id: context.confirmationId, userId: context.sessionUserId, status: AccountMergeConfirmationStatus.PROCESSING },
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
    await prisma.accountMergeConfirmation.updateMany({
      where: { id: context.confirmationId, userId: context.sessionUserId, status: AccountMergeConfirmationStatus.PROCESSING },
      data: {
        status: input.terminal ? AccountMergeConfirmationStatus.FAILED : AccountMergeConfirmationStatus.PENDING,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode,
      },
    });
  },

  async refreshLocalSession() { await refreshCurrentAccessCookie(); },
};
