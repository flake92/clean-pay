import { Prisma } from "@prisma/client";

import {
  type TelegramRecoveryLocalSnapshot,
  type TelegramRecoveryPlan,
  type TelegramRecoveryProviderSession,
  type TelegramRecoverySession,
  type TelegramSessionRecoveryGateway,
} from "@/application/auth/ports/telegram-session-recovery";
import { getEnv } from "@/backend/config/env";
import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import {
  assertUserMergeFinalOwner,
  mergeLocalUsersIntoTarget,
} from "@/backend/integrations/auth/local-user-merge-service";
import { synchronizeProviderAccountIdentity } from "@/backend/integrations/auth/provider-account-identity-sync";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  remnashopAuthTelegramIdentity,
  remnashopMergeUsers,
} from "@/backend/integrations/remnashop/api-client";
import { protectRemnashopToken } from "@/backend/integrations/remnashop/token-protection";
import {
  assertPaymentOwnerChangeFenceHeld,
  markPaymentOwnerChangeLocalFinalized,
  markPaymentOwnerChangeUpstreamMutationStarted,
  preflightPaymentOperationsForUserMerge,
  transferPaymentOperationsForUserMerge,
  withPaymentOwnerChangeFence,
} from "@/backend/integrations/payments/payment-user-merge-service";
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { logger } from "@/backend/observability/logger";

const recoveryTransactionOptions = { maxWait: 5_000, timeout: 10_000 };
const ownerSelect = {
  id: true,
  remnashopUserId: true,
  email: true,
  emailVerified: true,
  telegramId: true,
} as const;

type CurrentSession = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
type OwnerSnapshot = Prisma.WebUserGetPayload<{ select: typeof ownerSelect }>;
type ProviderContext = {
  auth: Awaited<ReturnType<typeof remnashopAuthTelegramIdentity>>;
  profile: Awaited<ReturnType<typeof getRemnashopMe>>;
  deadlineAt?: number;
};
type LocalSnapshotContext = {
  mergeUserIds: string[];
  targetOwner: OwnerSnapshot | null;
  sourceOwner: OwnerSnapshot | null;
  emailOwner: OwnerSnapshot | null;
  currentUser: CurrentSession["user"];
  localMergeOwners: OwnerSnapshot[];
  sourceUserIds: string[];
  upstreamOwnerChanging: boolean;
  lookupSeparateSourceOwner: boolean;
  lookupSeparateEmailOwner: boolean;
};

function actualSession(session: TelegramRecoverySession) {
  return session.context as CurrentSession;
}

function providerContext(provider: TelegramRecoveryProviderSession) {
  return provider.context as ProviderContext;
}

function snapshotContext(snapshot: TelegramRecoveryLocalSnapshot) {
  return snapshot.context as LocalSnapshotContext;
}

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function sameOwnerSnapshot(left: OwnerSnapshot | null, right: OwnerSnapshot | null) {
  if (!left || !right) return left === right;
  return left.id === right.id
    && left.remnashopUserId === right.remnashopUserId
    && left.email === right.email
    && left.emailVerified === right.emailVerified
    && left.telegramId === right.telegramId;
}

function sameInstant(left: Date | null, right: Date | null) {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

export function telegramRecoveryOwnershipError(reason: string) {
  return new ServiceError(
    "ACCOUNT_MERGE_REQUIRED",
    409,
    "Telegram recovery did not prove the expected Remnashop account owner",
    { message: reason },
  );
}

function currentLocalIdentityMatches(
  plan: TelegramRecoveryPlan,
  currentUser: CurrentSession["user"] | null,
  currentSession: CurrentSession | null,
) {
  const expected = actualSession(plan.session);
  return Boolean(
    currentUser
    && currentSession
    && currentUser.remnashopUserId === plan.session.upstreamAccountId
    && currentUser.email === plan.session.email
    && currentUser.emailVerified === plan.session.emailVerified
    && currentUser.telegramId === plan.session.telegramId
    && currentUser.authPending === plan.session.authPending
    && currentUser.pendingRemnashopUserId === plan.session.pendingUpstreamAccountId
    && currentUser.pendingRemnashopEmail === plan.session.pendingEmail
    && currentSession.remnashopAccessTokenEncrypted === expected.remnashopAccessTokenEncrypted
    && currentSession.remnashopRefreshTokenEncrypted === expected.remnashopRefreshTokenEncrypted
    && sameInstant(currentSession.remnashopAccessExpiresAt, expected.remnashopAccessExpiresAt)
    && sameInstant(currentSession.remnashopRefreshExpiresAt, expected.remnashopRefreshExpiresAt)
  );
}

function requestTimeout(deadlineAt: number) {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 100) {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      502,
      "Telegram recovery exceeded its upstream merge deadline",
    );
  }
  return Math.min(8_000, remainingMs);
}

function numericAccountId(value: string, role: string) {
  if (!/^[1-9]\d*$/.test(value)) throw telegramRecoveryOwnershipError(`invalid_${role}_remnashop_user_id`);
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) throw telegramRecoveryOwnershipError(`unsafe_${role}_remnashop_user_id`);
  return numeric;
}

export function telegramRecoverySession(session: CurrentSession): TelegramRecoverySession {
  return {
    context: session,
    sessionId: session.id,
    userId: session.userId,
    upstreamAccountId: session.user.remnashopUserId,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    telegramId: session.user.telegramId,
    telegramUsername: session.user.telegramUsername,
    authPending: session.user.authPending,
    pendingUpstreamAccountId: session.user.pendingRemnashopUserId,
    pendingEmail: session.user.pendingRemnashopEmail,
  };
}

function providerSession(
  auth: Awaited<ReturnType<typeof remnashopAuthTelegramIdentity>>,
  profile: Awaited<ReturnType<typeof getRemnashopMe>>,
  deadlineAt?: number,
): TelegramRecoveryProviderSession {
  return {
    context: { auth, profile, ...(deadlineAt ? { deadlineAt } : {}) } satisfies ProviderContext,
    accountId: getRemnashopUserIdFromAccessToken(auth.cookies.accessToken),
    email: profile.email,
    emailVerified: profile.is_email_verified,
    pendingEmail: profile.pending_email,
    telegramId: profile.telegram_id === null ? null : String(profile.telegram_id),
  };
}

async function ownerByUpstream(tx: Prisma.TransactionClient, accountId: string) {
  return tx.webUser.findUnique({ where: { remnashopUserId: accountId }, select: ownerSelect });
}

async function captureLocalSnapshot(plan: TelegramRecoveryPlan): Promise<TelegramRecoveryLocalSnapshot> {
  const lookupSeparateEmailOwner = Boolean(
    plan.finalEmail && normalizedEmail(plan.finalEmail) !== normalizedEmail(plan.session.email),
  );
  const lookupSeparateSourceOwner = Boolean(
    plan.sourceAccountId
    && plan.sourceAccountId !== plan.targetAccountId
    && plan.sourceAccountId !== plan.session.upstreamAccountId,
  );

  const context = await prisma.$transaction(async (tx) => {
    const preflightTargetOwner = await ownerByUpstream(tx, plan.targetAccountId);
    const preflightSourceOwner = lookupSeparateSourceOwner && plan.sourceAccountId
      ? await ownerByUpstream(tx, plan.sourceAccountId)
      : null;
    const preflightEmailOwner = lookupSeparateEmailOwner && plan.finalEmail
      ? await tx.webUser.findUnique({ where: { email: plan.finalEmail }, select: ownerSelect })
      : null;
    const mergeUserIds = [...new Set([
      plan.session.userId,
      ...[preflightTargetOwner, preflightSourceOwner, preflightEmailOwner]
        .filter((owner): owner is OwnerSnapshot => Boolean(owner))
        .map(({ id }) => id),
    ])].sort();

    await assertPaymentOwnerChangeFenceHeld(tx, mergeUserIds);
    const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id" FROM "WebUser"
        WHERE "id" IN (${Prisma.join(mergeUserIds)})
        ORDER BY "id" FOR UPDATE
      `,
    );
    const lockedUserIds = new Set(lockedUsers.map(({ id }) => id));
    if (lockedUserIds.size !== mergeUserIds.length
      || mergeUserIds.some((id) => !lockedUserIds.has(id))) {
      throw telegramRecoveryOwnershipError("local_merge_owner_disappeared_before_recovery");
    }

    const currentUser = await tx.webUser.findUnique({ where: { id: plan.session.userId } });
    const currentTargetOwner = await ownerByUpstream(tx, plan.targetAccountId);
    const currentSourceOwner = lookupSeparateSourceOwner && plan.sourceAccountId
      ? await ownerByUpstream(tx, plan.sourceAccountId)
      : null;
    const currentEmailOwner = lookupSeparateEmailOwner && plan.finalEmail
      ? await tx.webUser.findUnique({ where: { email: plan.finalEmail }, select: ownerSelect })
      : null;
    if (!sameOwnerSnapshot(preflightTargetOwner, currentTargetOwner)
      || !sameOwnerSnapshot(preflightSourceOwner, currentSourceOwner)
      || !sameOwnerSnapshot(preflightEmailOwner, currentEmailOwner)) {
      throw telegramRecoveryOwnershipError("local_merge_owner_changed_before_recovery");
    }

    const lockedSessions = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id" FROM "WebSession"
        WHERE "userId" = ${plan.session.userId} AND "revokedAt" IS NULL
        ORDER BY "id" FOR UPDATE
      `,
    );
    const currentSession = await tx.webSession.findFirst({
      where: { id: plan.session.sessionId, userId: plan.session.userId, revokedAt: null },
    });
    if (!lockedSessions.some(({ id }) => id === plan.session.sessionId)
      || !currentLocalIdentityMatches(plan, currentUser, currentSession as CurrentSession | null)) {
      throw telegramRecoveryOwnershipError("local_identity_changed_before_recovery");
    }

    const localMergeOwners = [currentTargetOwner, currentSourceOwner, currentEmailOwner]
      .filter((owner): owner is OwnerSnapshot => Boolean(owner))
      .filter((owner, index, owners) =>
        owner.id !== plan.session.userId
        && owners.findIndex(({ id }) => id === owner.id) === index
      );
    for (const owner of localMergeOwners) {
      if (owner.telegramId && owner.telegramId !== plan.session.telegramId) {
        throw telegramRecoveryOwnershipError("local_owner_has_another_telegram_identity");
      }
      if (owner.emailVerified && owner.email && plan.finalEmail
        && normalizedEmail(owner.email) !== normalizedEmail(plan.finalEmail)) {
        throw telegramRecoveryOwnershipError("local_verified_email_conflict");
      }
    }

    const sourceUserIds = localMergeOwners.map(({ id }) => id);
    const upstreamOwnerChanging = plan.session.upstreamAccountId !== plan.targetAccountId;
    const upstreamMergeRequired = Boolean(
      plan.sourceAccountId && plan.sourceAccountId !== plan.targetAccountId,
    );
    if (sourceUserIds.length || upstreamOwnerChanging || upstreamMergeRequired) {
      const paymentPreflight = await preflightPaymentOperationsForUserMerge(
        tx,
        plan.session.userId,
        sourceUserIds,
      );
      if (paymentPreflight.targetUpstreamAccountId !== plan.session.upstreamAccountId) {
        throw telegramRecoveryOwnershipError("payment_owner_changed_before_recovery");
      }
    }

    return {
      mergeUserIds,
      targetOwner: currentTargetOwner,
      sourceOwner: currentSourceOwner,
      emailOwner: currentEmailOwner,
      currentUser: currentUser!,
      localMergeOwners,
      sourceUserIds,
      upstreamOwnerChanging,
      lookupSeparateSourceOwner,
      lookupSeparateEmailOwner,
    } satisfies LocalSnapshotContext;
  }, recoveryTransactionOptions);

  return { context };
}

export const productionTelegramSessionRecoveryGateway: TelegramSessionRecoveryGateway<{
  accessToken: string;
  refreshToken: string;
  session: CurrentSession;
}> = {
  configurationAvailable() {
    return Boolean(getEnv().telegramBotToken);
  },

  recoverySkipped(session) {
    logger.warn("remnashop_telegram_token_restore_skipped", {
      sessionId: session.sessionId,
      userId: session.userId,
      hasTelegramId: Boolean(session.telegramId),
      hasTelegramBotToken: Boolean(getEnv().telegramBotToken),
    }, { category: "auth", source: "remnashop.session", message: "Skipped Telegram Remnashop token restore" });
  },

  recoveryStarted(session) {
    logger.info("remnashop_telegram_token_restore_started", {
      sessionId: session.sessionId,
      userId: session.userId,
      telegramId: session.telegramId,
      hasTelegramUsername: Boolean(session.telegramUsername),
    }, { category: "auth", source: "remnashop.session", message: "Restoring Remnashop session via Telegram" });
    authDebugLog("remnashop_telegram_token_restore_started", {
      sessionId: session.sessionId,
      userId: session.userId,
      telegramId: session.telegramId,
      hasTelegramUsername: Boolean(session.telegramUsername),
    });
  },

  async authenticateTelegram(input) {
    const timeoutMs = input.deadlineAt ? requestTimeout(input.deadlineAt) : undefined;
    const auth = await remnashopAuthTelegramIdentity({
      telegramId: input.telegramId,
      telegramUsername: input.telegramUsername,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    const profile = await getRemnashopMe(
      auth.cookies.accessToken,
      timeoutMs ? { timeoutMs: input.deadlineAt ? requestTimeout(input.deadlineAt) : timeoutMs } : undefined,
    );
    return providerSession(auth, profile, input.deadlineAt);
  },

  withOwnerChangeFence({ plan, operationKey, work }) {
    return withPaymentOwnerChangeFence({
      userIds: [plan.session.userId],
      upstreamAccountIds: [
        plan.initialProvider.accountId,
        plan.targetAccountId,
        plan.sourceAccountId,
        plan.session.upstreamAccountId,
      ].filter((value): value is string => Boolean(value)),
      emails: [plan.session.email, plan.session.pendingEmail, plan.finalEmail],
      telegramIds: [plan.session.telegramId],
      operationKey,
      targetUpstreamAccountId: plan.targetAccountId,
      work,
    });
  },

  captureLocalSnapshot,

  async mergeProviderAccounts(input) {
    const sourceUserId = numericAccountId(input.sourceAccountId, "source");
    const targetUserId = numericAccountId(input.targetAccountId, "target");
    try {
      await markPaymentOwnerChangeUpstreamMutationStarted();
      const result = await remnashopMergeUsers({
        sourceUserId,
        targetUserId,
        reason: input.reason,
        emailResolution: input.emailResolution,
        telegramResolution: input.telegramResolution,
        paymentResolution: input.paymentResolution,
        timeoutMs: requestTimeout(input.deadlineAt),
      });
      return {
        dryRun: result.dry_run,
        sourceAccountId: String(result.source_user_id),
        targetAccountId: String(result.target_user_id),
        targetAccountMatches: String(result.target.id) === input.targetAccountId,
        conflicts: result.conflicts,
        requiresRelogin: result.requires_relogin,
      };
    } catch (error) {
      if (error instanceof ServiceError && error.code === "CONFLICT") {
        throw telegramRecoveryOwnershipError("upstream_merge_conflict");
      }
      throw error;
    }
  },

  async synchronizeProviderIdentity({ provider, expected }) {
    const context = providerContext(provider);
    const result = await synchronizeProviderAccountIdentity(
      context.auth.cookies.accessToken,
      expected,
      {
        verifiedProfile: context.profile,
        ...(context.deadlineAt ? { timeoutMs: requestTimeout(context.deadlineAt) } : {}),
      },
    );
    return providerSession(context.auth, result.profile, context.deadlineAt);
  },

  async commitLocalRecovery({ plan, snapshot, provider, upstreamMerged }) {
    const session = actualSession(plan.session);
    const local = snapshotContext(snapshot);
    const { auth } = providerContext(provider);
    const accessExpiresAt = new Date(auth.data.expires_at);
    const refreshExpiresAt = new Date(auth.data.refresh_expires_at);
    if (Number.isNaN(accessExpiresAt.getTime()) || Number.isNaN(refreshExpiresAt.getTime())) {
      throw telegramRecoveryOwnershipError("upstream_auth_expiry_is_invalid");
    }

    await prisma.$transaction(async (tx) => {
      await assertPaymentOwnerChangeFenceHeld(tx, local.mergeUserIds);
      const currentUser = await tx.webUser.findUnique({ where: { id: plan.session.userId } });
      const currentSession = await tx.webSession.findFirst({
        where: { id: plan.session.sessionId, userId: plan.session.userId, revokedAt: null },
      });
      const currentTargetOwner = await ownerByUpstream(tx, plan.targetAccountId);
      const currentSourceOwner = local.lookupSeparateSourceOwner && plan.sourceAccountId
        ? await ownerByUpstream(tx, plan.sourceAccountId)
        : null;
      const currentEmailOwner = local.lookupSeparateEmailOwner && plan.finalEmail
        ? await tx.webUser.findUnique({ where: { email: plan.finalEmail }, select: ownerSelect })
        : null;
      if (!currentLocalIdentityMatches(plan, currentUser, currentSession as CurrentSession | null)
        || !sameOwnerSnapshot(local.targetOwner, currentTargetOwner)
        || !sameOwnerSnapshot(local.sourceOwner, currentSourceOwner)
        || !sameOwnerSnapshot(local.emailOwner, currentEmailOwner)) {
        throw telegramRecoveryOwnershipError("local_identity_changed_before_recovery");
      }

      if (local.sourceUserIds.length) {
        await mergeLocalUsersIntoTarget(tx, {
          targetUserId: plan.session.userId,
          targetUpstreamAccountId: provider.accountId,
          sourceUserIds: local.sourceUserIds,
          ownerExpectations: [
            {
              id: local.currentUser.id,
              remnashopUserId: local.currentUser.remnashopUserId,
              email: local.currentUser.email,
              telegramId: local.currentUser.telegramId,
            },
            ...local.localMergeOwners.map((owner) => ({
              id: owner.id,
              remnashopUserId: owner.remnashopUserId,
              email: owner.email,
              telegramId: owner.telegramId,
            })),
          ],
          paymentOwnerFenceHeld: true,
        });
      } else if (local.upstreamOwnerChanging) {
        await transferPaymentOperationsForUserMerge(tx, plan.session.userId, provider.accountId, []);
      }

      if (upstreamMerged) {
        await tx.webSession.updateMany({
          where: { userId: plan.session.userId, id: { not: plan.session.sessionId }, revokedAt: null },
          data: {
            remnashopAccessTokenEncrypted: null,
            remnashopRefreshTokenEncrypted: null,
            remnashopAccessExpiresAt: null,
            remnashopRefreshExpiresAt: null,
            remnashopRefreshClaimTokenHash: null,
            remnashopRefreshLeaseExpiresAt: null,
            remnashopRefreshDispatchedAt: null,
            remnashopRefreshRecoveryEncrypted: null,
          },
        });
      }

      await tx.webUser.update({
        where: { id: plan.session.userId },
        data: {
          remnashopUserId: provider.accountId,
          email: plan.finalEmail,
          emailVerified: plan.finalEmailVerified,
          authPending: false,
          pendingRemnashopUserId: null,
          pendingRemnashopEmail: null,
          lastLoginAt: new Date(),
        },
      });
      const stored = await tx.webSession.updateMany({
        where: { id: plan.session.sessionId, userId: plan.session.userId, revokedAt: null },
        data: {
          remnashopAccessTokenEncrypted: protectRemnashopToken(auth.cookies.accessToken),
          remnashopRefreshTokenEncrypted: protectRemnashopToken(auth.cookies.refreshToken),
          remnashopAccessExpiresAt: accessExpiresAt,
          remnashopRefreshExpiresAt: refreshExpiresAt,
          remnashopRefreshClaimTokenHash: null,
          remnashopRefreshLeaseExpiresAt: null,
          remnashopRefreshDispatchedAt: null,
          remnashopRefreshRecoveryEncrypted: null,
        },
      });
      if (stored.count !== 1) throw telegramRecoveryOwnershipError("local_session_changed_during_recovery");

      await assertUserMergeFinalOwner(tx, {
        targetUserId: plan.session.userId,
        sourceUserIds: local.sourceUserIds,
        expected: {
          remnashopUserId: provider.accountId,
          email: plan.finalEmail,
          telegramId: plan.session.telegramId,
        },
      });
      await markPaymentOwnerChangeLocalFinalized(tx, [plan.session.userId]);
    }, recoveryTransactionOptions);

    return {
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      session: {
        ...session,
        user: {
          ...session.user,
          remnashopUserId: provider.accountId,
          email: plan.finalEmail,
          emailVerified: plan.finalEmailVerified,
          authPending: false,
          pendingRemnashopUserId: null,
          pendingRemnashopEmail: null,
        },
        remnashopAccessTokenEncrypted: protectRemnashopToken(auth.cookies.accessToken),
        remnashopRefreshTokenEncrypted: protectRemnashopToken(auth.cookies.refreshToken),
        remnashopAccessExpiresAt: accessExpiresAt,
        remnashopRefreshExpiresAt: refreshExpiresAt,
      },
    };
  },

  recoverySucceeded({ session, provider, upstreamMerged }) {
    const { auth } = providerContext(provider);
    const accessExpiresAt = new Date(auth.data.expires_at);
    const refreshExpiresAt = new Date(auth.data.refresh_expires_at);
    const metadata = {
      sessionId: session.sessionId,
      userId: session.userId,
      remnashopUserId: provider.accountId,
      upstreamMerged,
      accessExpiresAt,
      refreshExpiresAt,
    };
    authDebugLog("remnashop_telegram_token_restore_success", metadata);
    logger.info("remnashop_telegram_token_restore_success", metadata, {
      category: "auth",
      source: "remnashop.session",
      message: "Restored Remnashop session via Telegram",
    });
  },
};
