import { Prisma } from "@prisma/client";

import { getEnv } from "@/backend/config/env";
import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import {
  assertUserMergeFinalOwner,
  mergeLocalUsersIntoTarget,
} from "@/backend/integrations/auth/local-user-merge-service";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  remnashopAuthTelegramIdentity,
  remnashopMergeUsers,
} from "@/backend/integrations/remnashop/api-client";
import type { RemnashopMe } from "@/backend/integrations/remnashop/contracts";
import { protectRemnashopToken } from "@/backend/integrations/remnashop/token-protection";
import {
  assertNoActivePaymentDispatches,
  lockPaymentOwnerFence,
  preflightPaymentOperationsForUserMerge,
  transferPaymentOperationsForUserMerge,
} from "@/backend/integrations/payments/payment-user-merge-service";
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { logger } from "@/backend/observability/logger";

export async function attachRemnashopTokensForTelegramSession(
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>,
) {
  const env = getEnv();
  const telegramId = session.user.telegramId;

  if (!telegramId || !env.telegramBotToken) {
    logger.warn("remnashop_telegram_token_restore_skipped", {
      sessionId: session.id,
      userId: session.userId,
      hasTelegramId: Boolean(telegramId),
      hasTelegramBotToken: Boolean(env.telegramBotToken),
    }, {
      category: "auth",
      source: "remnashop.session",
      message: "Skipped Telegram Remnashop token restore",
    });
    return null;
  }

  logger.info("remnashop_telegram_token_restore_started", {
    sessionId: session.id,
    userId: session.userId,
    telegramId: telegramId.toString(),
    hasTelegramUsername: Boolean(session.user.telegramUsername),
  }, {
    category: "auth",
    source: "remnashop.session",
    message: "Restoring Remnashop session via Telegram",
  });
  authDebugLog("remnashop_telegram_token_restore_started", {
    sessionId: session.id,
    userId: session.userId,
    telegramId: telegramId.toString(),
    hasTelegramUsername: Boolean(session.user.telegramUsername),
  });

  const expectedIdentity = {
    remnashopUserId: session.user.remnashopUserId,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    telegramId: session.user.telegramId,
    authPending: session.user.authPending,
    pendingRemnashopUserId: session.user.pendingRemnashopUserId,
    pendingRemnashopEmail: session.user.pendingRemnashopEmail,
  };
  const pendingMergeIsProven = Boolean(
    expectedIdentity.authPending &&
    expectedIdentity.pendingRemnashopUserId &&
    expectedIdentity.pendingRemnashopEmail,
  );
  const recoverySourceRemnashopUserId = pendingMergeIsProven
    ? expectedIdentity.pendingRemnashopUserId
    : expectedIdentity.remnashopUserId;
  const recoveryEmail = pendingMergeIsProven
    ? expectedIdentity.pendingRemnashopEmail
    : expectedIdentity.emailVerified
      ? expectedIdentity.email
      : null;
  const normalizedExpectedEmail = recoveryEmail?.trim().toLowerCase() ?? null;
  const ownershipError = (reason: string) =>
    new ServiceError(
      "ACCOUNT_MERGE_REQUIRED",
      409,
      "Telegram recovery did not prove the expected Remnashop account owner",
      { message: reason },
    );
  const profileMatchesExpectedEmail = (profile: RemnashopMe) =>
    Boolean(
      normalizedExpectedEmail &&
        profile.email?.trim().toLowerCase() === normalizedExpectedEmail &&
        profile.is_email_verified,
    );
  const assertExpectedTelegramProfile = (
    profile: RemnashopMe,
    stage: "before_merge" | "after_merge",
  ) => {
    const profileTelegramId =
      profile.telegram_id === null || profile.telegram_id === undefined
        ? null
        : String(profile.telegram_id);

    if (profileTelegramId !== String(expectedIdentity.telegramId)) {
      throw ownershipError(`telegram_profile_mismatch_${stage}`);
    }
  };
  const sameOwnerSnapshot = (
    left: {
      id: string;
      remnashopUserId: string | null;
      email: string | null;
      emailVerified: boolean;
      telegramId: string | null;
    } | null,
    right: typeof left,
  ) => {
    if (!left || !right) {
      return left === right;
    }

    return (
      left.id === right.id &&
      left.remnashopUserId === right.remnashopUserId &&
      left.email === right.email &&
      left.emailVerified === right.emailVerified &&
      left.telegramId === right.telegramId
    );
  };
  const sameInstant = (left: Date | null, right: Date | null) =>
    (left?.getTime() ?? null) === (right?.getTime() ?? null);
  const numericRemnashopUserId = (value: string, role: string) => {
    if (!/^[1-9]\d*$/.test(value)) {
      throw ownershipError(`invalid_${role}_remnashop_user_id`);
    }

    const numeric = Number(value);

    if (!Number.isSafeInteger(numeric)) {
      throw ownershipError(`unsafe_${role}_remnashop_user_id`);
    }

    return numeric;
  };

  const initialAuth = await remnashopAuthTelegramIdentity({
    telegramId,
    telegramUsername: session.user.telegramUsername,
  });
  const initialRemnashopUserId = getRemnashopUserIdFromAccessToken(
    initialAuth.cookies.accessToken,
  );
  const initialProfile = await getRemnashopMe(initialAuth.cookies.accessToken);
  assertExpectedTelegramProfile(initialProfile, "before_merge");
  const verifiedRecoveryEmail = recoveryEmail ?? (
    initialProfile.is_email_verified ? initialProfile.email : null
  );
  const normalizedVerifiedRecoveryEmail =
    verifiedRecoveryEmail?.trim().toLowerCase() ?? null;

  if (
    recoverySourceRemnashopUserId &&
    recoverySourceRemnashopUserId !== initialRemnashopUserId
  ) {
    if (!normalizedExpectedEmail) {
      throw ownershipError("upstream_id_mismatch_without_verified_email");
    }

    const candidateEmail = initialProfile.email?.trim().toLowerCase() ?? null;

    if (candidateEmail && candidateEmail !== normalizedExpectedEmail) {
      throw ownershipError("telegram_candidate_has_another_email");
    }
  }

  const recovery = await prisma.$transaction(async (tx) => {
    const ownerSelect = {
      id: true,
      remnashopUserId: true,
      email: true,
      emailVerified: true,
      telegramId: true,
    } as const;
    const preflightTargetOwner = await tx.webUser.findUnique({
      where: { remnashopUserId: initialRemnashopUserId },
      select: ownerSelect,
    });
    const preflightSourceOwner =
      recoverySourceRemnashopUserId &&
      recoverySourceRemnashopUserId !== initialRemnashopUserId &&
      recoverySourceRemnashopUserId !== expectedIdentity.remnashopUserId
        ? await tx.webUser.findUnique({
            where: { remnashopUserId: recoverySourceRemnashopUserId },
            select: ownerSelect,
          })
        : null;
    const lookupSeparateEmailOwner = Boolean(
      verifiedRecoveryEmail &&
      verifiedRecoveryEmail.trim().toLowerCase() !==
        (expectedIdentity.email?.trim().toLowerCase() ?? null),
    );
    const preflightEmailOwner = lookupSeparateEmailOwner && verifiedRecoveryEmail
      ? await tx.webUser.findUnique({
          where: { email: verifiedRecoveryEmail },
          select: ownerSelect,
        })
      : null;
    const mergeUserIds = [
      ...new Set([
        session.userId,
        ...[
          preflightTargetOwner,
          preflightSourceOwner,
          preflightEmailOwner,
        ]
          .filter((owner): owner is NonNullable<typeof owner> => Boolean(owner))
          .map(({ id }) => id)
          .filter((id) => id !== session.userId),
      ]),
    ].sort();
    await lockPaymentOwnerFence(tx, mergeUserIds);
    await assertNoActivePaymentDispatches(tx, mergeUserIds);
    const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "WebUser"
        WHERE "id" IN (${Prisma.join(mergeUserIds)})
        ORDER BY "id"
        FOR UPDATE
      `,
    );
    const lockedUserIds = new Set(lockedUsers.map(({ id }) => id));

    if (
      lockedUserIds.size !== mergeUserIds.length ||
      mergeUserIds.some((id) => !lockedUserIds.has(id))
    ) {
      throw ownershipError("local_merge_owner_disappeared_before_recovery");
    }

    const currentUser = await tx.webUser.findUnique({
      where: { id: session.userId },
    });
    const currentTargetOwner = await tx.webUser.findUnique({
      where: { remnashopUserId: initialRemnashopUserId },
      select: ownerSelect,
    });
    const currentSourceOwner =
      recoverySourceRemnashopUserId &&
      recoverySourceRemnashopUserId !== initialRemnashopUserId &&
      recoverySourceRemnashopUserId !== expectedIdentity.remnashopUserId
        ? await tx.webUser.findUnique({
            where: { remnashopUserId: recoverySourceRemnashopUserId },
            select: ownerSelect,
          })
        : null;
    const currentEmailOwner = lookupSeparateEmailOwner && verifiedRecoveryEmail
      ? await tx.webUser.findUnique({
          where: { email: verifiedRecoveryEmail },
          select: ownerSelect,
        })
      : null;

    if (
      !sameOwnerSnapshot(preflightTargetOwner, currentTargetOwner) ||
      !sameOwnerSnapshot(preflightSourceOwner, currentSourceOwner) ||
      !sameOwnerSnapshot(preflightEmailOwner, currentEmailOwner)
    ) {
      throw ownershipError("local_merge_owner_changed_before_recovery");
    }

    const lockedSessions = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "WebSession"
        WHERE "userId" = ${session.userId}
          AND "revokedAt" IS NULL
        ORDER BY "id"
        FOR UPDATE
      `,
    );
    const lockedSessionIds = new Set(lockedSessions.map(({ id }) => id));
    const currentSession = await tx.webSession.findFirst({
      where: {
        id: session.id,
        userId: session.userId,
        revokedAt: null,
      },
    });

    if (
      !lockedSessionIds.has(session.id) ||
      !currentUser ||
      !currentSession ||
      currentUser.remnashopUserId !== expectedIdentity.remnashopUserId ||
      currentUser.email !== expectedIdentity.email ||
      currentUser.emailVerified !== expectedIdentity.emailVerified ||
      currentUser.telegramId !== expectedIdentity.telegramId ||
      currentUser.authPending !== expectedIdentity.authPending ||
      currentUser.pendingRemnashopUserId !==
        expectedIdentity.pendingRemnashopUserId ||
      currentUser.pendingRemnashopEmail !==
        expectedIdentity.pendingRemnashopEmail ||
      currentSession.remnashopAccessTokenEncrypted !==
        session.remnashopAccessTokenEncrypted ||
      currentSession.remnashopRefreshTokenEncrypted !==
        session.remnashopRefreshTokenEncrypted ||
      !sameInstant(
        currentSession.remnashopAccessExpiresAt,
        session.remnashopAccessExpiresAt,
      ) ||
      !sameInstant(
        currentSession.remnashopRefreshExpiresAt,
        session.remnashopRefreshExpiresAt,
      )
    ) {
      throw ownershipError("local_identity_changed_before_recovery");
    }

    const localMergeOwners = [
      currentTargetOwner,
      currentSourceOwner,
      currentEmailOwner,
    ]
      .filter((owner): owner is NonNullable<typeof owner> => Boolean(owner))
      .filter((owner, index, owners) =>
        owner.id !== session.userId &&
        owners.findIndex(({ id }) => id === owner.id) === index
      );
    const sourceUserIds = localMergeOwners.map(({ id }) => id);

    for (const owner of localMergeOwners) {
      if (
        owner.telegramId &&
        owner.telegramId !== expectedIdentity.telegramId
      ) {
        throw ownershipError("local_owner_has_another_telegram_identity");
      }

      if (
        owner.emailVerified &&
        owner.email &&
        normalizedVerifiedRecoveryEmail &&
        owner.email.trim().toLowerCase() !== normalizedVerifiedRecoveryEmail
      ) {
        throw ownershipError("local_verified_email_conflict");
      }
    }

    const finalEmail = verifiedRecoveryEmail ?? expectedIdentity.email;
    const finalEmailVerified = Boolean(verifiedRecoveryEmail);
    const upstreamOwnerChanging =
      expectedIdentity.remnashopUserId !== initialRemnashopUserId;
    const upstreamMergeRequired = Boolean(
      recoverySourceRemnashopUserId &&
      recoverySourceRemnashopUserId !== initialRemnashopUserId,
    );

    if (
      sourceUserIds.length > 0 ||
      upstreamOwnerChanging ||
      upstreamMergeRequired
    ) {
      const paymentPreflight =
        await preflightPaymentOperationsForUserMerge(
          tx,
          session.userId,
          sourceUserIds,
        );

      if (
        paymentPreflight.targetUpstreamAccountId !==
        expectedIdentity.remnashopUserId
      ) {
        throw ownershipError("payment_owner_changed_before_recovery");
      }
    }

    let auth = initialAuth;
    let profile = initialProfile;
    let remnashopUserId = initialRemnashopUserId;
    let upstreamMerged = false;

    if (
      recoverySourceRemnashopUserId &&
      recoverySourceRemnashopUserId !== remnashopUserId
    ) {
      if (!normalizedExpectedEmail) {
        throw ownershipError("upstream_id_mismatch_without_verified_email");
      }

      const candidateEmail = profile.email?.trim().toLowerCase() ?? null;

      if (candidateEmail && candidateEmail !== normalizedExpectedEmail) {
        throw ownershipError("telegram_candidate_has_another_email");
      }

      const sourceUserId = numericRemnashopUserId(
        recoverySourceRemnashopUserId,
        "source",
      );
      const targetUserId = numericRemnashopUserId(
        remnashopUserId,
        "target",
      );
      const lockedNetworkDeadline = Date.now() + 20_000;
      const nextLockedRequestTimeout = () => {
        const remainingMs = lockedNetworkDeadline - Date.now();

        if (remainingMs <= 100) {
          throw new ServiceError(
            "UPSTREAM_UNAVAILABLE",
            502,
            "Telegram recovery exceeded its upstream merge deadline",
          );
        }

        return Math.min(8_000, remainingMs);
      };
      let mergeResult: unknown;

      try {
        mergeResult = await remnashopMergeUsers({
          sourceUserId,
          targetUserId,
          reason:
            "Clean Pay Telegram recovery: verified local owner and Telegram identity",
          timeoutMs: nextLockedRequestTimeout(),
        });
      } catch (error) {
        if (error instanceof ServiceError && error.code === "CONFLICT") {
          throw ownershipError("upstream_merge_conflict");
        }

        throw error;
      }

      if (
        !mergeResult ||
        typeof mergeResult !== "object" ||
        !("dry_run" in mergeResult) ||
        mergeResult.dry_run !== false ||
        !("source_user_id" in mergeResult) ||
        mergeResult.source_user_id !== sourceUserId ||
        !("target_user_id" in mergeResult) ||
        mergeResult.target_user_id !== targetUserId ||
        !("target" in mergeResult) ||
        !mergeResult.target ||
        typeof mergeResult.target !== "object" ||
        !("id" in mergeResult.target) ||
        mergeResult.target.id !== targetUserId ||
        !("conflicts" in mergeResult) ||
        !Array.isArray(mergeResult.conflicts) ||
        mergeResult.conflicts.length !== 0 ||
        !("requires_relogin" in mergeResult) ||
        mergeResult.requires_relogin !== true
      ) {
        throw ownershipError("upstream_merge_result_mismatch");
      }

      auth = await remnashopAuthTelegramIdentity({
        telegramId,
        telegramUsername: session.user.telegramUsername,
        timeoutMs: nextLockedRequestTimeout(),
      });
      remnashopUserId = getRemnashopUserIdFromAccessToken(
        auth.cookies.accessToken,
      );
      profile = await getRemnashopMe(auth.cookies.accessToken, {
        timeoutMs: nextLockedRequestTimeout(),
      });
      assertExpectedTelegramProfile(profile, "after_merge");
      upstreamMerged = true;

      if (remnashopUserId !== initialRemnashopUserId) {
        throw ownershipError("post_merge_telegram_owner_changed");
      }
    }

    if (
      recoverySourceRemnashopUserId &&
      !upstreamMerged &&
      recoverySourceRemnashopUserId !== remnashopUserId
    ) {
      throw ownershipError("upstream_id_mismatch");
    }

    if (
      normalizedExpectedEmail &&
      !profileMatchesExpectedEmail(profile)
    ) {
      throw ownershipError("verified_email_mismatch");
    }

    if (
      finalEmailVerified &&
      (profile.email?.trim().toLowerCase() ?? null) !==
        (finalEmail?.trim().toLowerCase() ?? null)
    ) {
      throw ownershipError("final_local_email_does_not_match_upstream_owner");
    }

    const accessExpiresAt = new Date(auth.data.expires_at);
    const refreshExpiresAt = new Date(auth.data.refresh_expires_at);

    if (
      Number.isNaN(accessExpiresAt.getTime()) ||
      Number.isNaN(refreshExpiresAt.getTime())
    ) {
      throw ownershipError("upstream_auth_expiry_is_invalid");
    }

    if (sourceUserIds.length > 0) {
      await mergeLocalUsersIntoTarget(tx, {
        targetUserId: session.userId,
        targetUpstreamAccountId: remnashopUserId,
        sourceUserIds,
        ownerExpectations: [
          {
            id: currentUser.id,
            remnashopUserId: currentUser.remnashopUserId,
            email: currentUser.email,
            telegramId: currentUser.telegramId,
          },
          ...localMergeOwners.map((owner) => ({
            id: owner.id,
            remnashopUserId: owner.remnashopUserId,
            email: owner.email,
            telegramId: owner.telegramId,
          })),
        ],
      });
    } else if (upstreamOwnerChanging) {
      await transferPaymentOperationsForUserMerge(
        tx,
        session.userId,
        remnashopUserId,
        [],
      );
    }

    if (
      upstreamMerged &&
      lockedSessions.some(({ id }) => id !== session.id)
    ) {
      await tx.webSession.updateMany({
        where: {
          userId: session.userId,
          id: { not: session.id },
          revokedAt: null,
        },
        data: {
          remnashopAccessTokenEncrypted: null,
          remnashopRefreshTokenEncrypted: null,
          remnashopAccessExpiresAt: null,
          remnashopRefreshExpiresAt: null,
        },
      });
    }

    await tx.webUser.update({
      where: { id: session.userId },
      data: {
        remnashopUserId,
        email: finalEmail,
        emailVerified: finalEmailVerified,
        authPending: false,
        pendingRemnashopUserId: null,
        pendingRemnashopEmail: null,
        lastLoginAt: new Date(),
      },
    });
    const stored = await tx.webSession.updateMany({
      where: {
        id: session.id,
        userId: session.userId,
        revokedAt: null,
      },
      data: {
        remnashopAccessTokenEncrypted: protectRemnashopToken(
          auth.cookies.accessToken,
        ),
        remnashopRefreshTokenEncrypted: protectRemnashopToken(
          auth.cookies.refreshToken,
        ),
        remnashopAccessExpiresAt: accessExpiresAt,
        remnashopRefreshExpiresAt: refreshExpiresAt,
      },
    });

    if (stored.count !== 1) {
      throw ownershipError("local_session_changed_during_recovery");
    }

    await assertUserMergeFinalOwner(tx, {
      targetUserId: session.userId,
      sourceUserIds,
      expected: {
        remnashopUserId,
        email: finalEmail,
        telegramId: expectedIdentity.telegramId,
      },
    });

    return {
      auth,
      remnashopUserId,
      finalEmail,
      finalEmailVerified,
      upstreamMerged,
      accessExpiresAt,
      refreshExpiresAt,
    };
  }, {
    maxWait: 5_000,
    timeout: 30_000,
  });
  const {
    auth,
    remnashopUserId,
    finalEmail,
    finalEmailVerified,
    upstreamMerged,
    accessExpiresAt,
    refreshExpiresAt,
  } = recovery;

  authDebugLog("remnashop_telegram_token_restore_success", {
    sessionId: session.id,
    userId: session.userId,
    remnashopUserId,
    upstreamMerged,
    accessExpiresAt,
    refreshExpiresAt,
  });
  logger.info("remnashop_telegram_token_restore_success", {
    sessionId: session.id,
    userId: session.userId,
    remnashopUserId,
    upstreamMerged,
    accessExpiresAt,
    refreshExpiresAt,
  }, {
    category: "auth",
    source: "remnashop.session",
    message: "Restored Remnashop session via Telegram",
  });

  return {
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    session: {
      ...session,
      user: {
        ...session.user,
        remnashopUserId,
        email: finalEmail,
        emailVerified: finalEmailVerified,
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
}
