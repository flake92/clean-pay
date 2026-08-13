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
  assertPaymentOwnerChangeFenceHeld,
  markPaymentOwnerChangeUpstreamMutationStarted,
  markPaymentOwnerChangeLocalFinalized,
  preflightPaymentOperationsForUserMerge,
  transferPaymentOperationsForUserMerge,
  withPaymentOwnerChangeFence,
} from "@/backend/integrations/payments/payment-user-merge-service";
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { logger } from "@/backend/observability/logger";
import { paymentOwnerTransitionKey } from "@/shared/domain/payment-owner-transition";

const recoveryTransactionOptions = { maxWait: 5_000, timeout: 10_000 };

const ownerSelect = {
  id: true,
  remnashopUserId: true,
  email: true,
  emailVerified: true,
  telegramId: true,
} as const;

type OwnerSnapshot = Prisma.WebUserGetPayload<{ select: typeof ownerSelect }>;

function sameOwnerSnapshot(
  left: OwnerSnapshot | null,
  right: OwnerSnapshot | null,
) {
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
}

function sameInstant(left: Date | null, right: Date | null) {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

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
  const localIdentityIsCurrent = (
    currentUser: {
      remnashopUserId: string | null;
      email: string | null;
      emailVerified: boolean;
      telegramId: string | null;
      authPending: boolean;
      pendingRemnashopUserId: string | null;
      pendingRemnashopEmail: string | null;
    } | null,
    currentSession: {
      remnashopAccessTokenEncrypted: string | null;
      remnashopRefreshTokenEncrypted: string | null;
      remnashopAccessExpiresAt: Date | null;
      remnashopRefreshExpiresAt: Date | null;
    } | null,
  ) => Boolean(
    currentUser &&
    currentSession &&
    currentUser.remnashopUserId === expectedIdentity.remnashopUserId &&
    currentUser.email === expectedIdentity.email &&
    currentUser.emailVerified === expectedIdentity.emailVerified &&
    currentUser.telegramId === expectedIdentity.telegramId &&
    currentUser.authPending === expectedIdentity.authPending &&
    currentUser.pendingRemnashopUserId ===
      expectedIdentity.pendingRemnashopUserId &&
    currentUser.pendingRemnashopEmail === expectedIdentity.pendingRemnashopEmail &&
    currentSession.remnashopAccessTokenEncrypted ===
      session.remnashopAccessTokenEncrypted &&
    currentSession.remnashopRefreshTokenEncrypted ===
      session.remnashopRefreshTokenEncrypted &&
    sameInstant(
      currentSession.remnashopAccessExpiresAt,
      session.remnashopAccessExpiresAt,
    ) &&
    sameInstant(
      currentSession.remnashopRefreshExpiresAt,
      session.remnashopRefreshExpiresAt,
    )
  );

  // Authentication and the initial owner proof are read-only upstream calls.
  // They happen before claiming local owners so an invalid Telegram response
  // cannot leave a durable payment-owner barrier behind.
  const initialAuth = await remnashopAuthTelegramIdentity({
    telegramId,
    telegramUsername: session.user.telegramUsername,
  });
  const initialRemnashopUserId = getRemnashopUserIdFromAccessToken(
    initialAuth.cookies.accessToken,
  );
  const initialProfile = await getRemnashopMe(initialAuth.cookies.accessToken);
  assertExpectedTelegramProfile(initialProfile, "before_merge");
  // A staged password/e-mail account is the durable merge target. Telegram
  // authentication may still resolve the old source when the previous merge
  // timed out before reaching the provider, so never reverse that direction.
  const targetRemnashopUserId = pendingMergeIsProven
    ? expectedIdentity.pendingRemnashopUserId!
    : initialRemnashopUserId;
  const recoverySourceRemnashopUserId = expectedIdentity.remnashopUserId;
  if (pendingMergeIsProven) {
    const durableSource = expectedIdentity.remnashopUserId;
    const initialMatchesTransition = durableSource
      ? initialRemnashopUserId === durableSource ||
        initialRemnashopUserId === targetRemnashopUserId
      : initialRemnashopUserId === targetRemnashopUserId;
    if (!initialMatchesTransition) {
      throw ownershipError("pending_merge_telegram_owner_is_unrelated");
    }
  }
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

  const lookupSeparateEmailOwner = Boolean(
    verifiedRecoveryEmail &&
    verifiedRecoveryEmail.trim().toLowerCase() !==
      (expectedIdentity.email?.trim().toLowerCase() ?? null),
  );
  const lookupSeparateSourceOwner = Boolean(
    recoverySourceRemnashopUserId &&
    recoverySourceRemnashopUserId !== initialRemnashopUserId &&
    recoverySourceRemnashopUserId !== expectedIdentity.remnashopUserId,
  );
  const fenceUpstreamAccountIds = [
    initialRemnashopUserId,
    targetRemnashopUserId,
    recoverySourceRemnashopUserId,
    expectedIdentity.remnashopUserId,
  ].filter((value): value is string => Boolean(value));

  const recovery = await withPaymentOwnerChangeFence({
    userIds: [session.userId],
    upstreamAccountIds: fenceUpstreamAccountIds,
    emails: [
      expectedIdentity.email,
      expectedIdentity.pendingRemnashopEmail,
      verifiedRecoveryEmail,
    ],
    telegramIds: [expectedIdentity.telegramId],
    operationKey: paymentOwnerTransitionKey({
      actorUserId: session.userId,
      sourceUpstreamAccountId:
        expectedIdentity.remnashopUserId ??
        recoverySourceRemnashopUserId ??
        initialRemnashopUserId,
      targetUpstreamAccountId: targetRemnashopUserId,
      telegramId,
    }),
    targetUpstreamAccountId: targetRemnashopUserId,
    work: async () => {
      // This transaction only captures and validates local ownership. The
      // durable fence remains claimed after it commits, across all HTTP below.
      const snapshot = await prisma.$transaction(async (tx) => {
        const preflightTargetOwner = await tx.webUser.findUnique({
          where: { remnashopUserId: targetRemnashopUserId },
          select: ownerSelect,
        });
        const preflightSourceOwner =
          lookupSeparateSourceOwner && recoverySourceRemnashopUserId
            ? await tx.webUser.findUnique({
                where: { remnashopUserId: recoverySourceRemnashopUserId },
                select: ownerSelect,
              })
            : null;
        const preflightEmailOwner =
          lookupSeparateEmailOwner && verifiedRecoveryEmail
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
              .filter((owner): owner is OwnerSnapshot => Boolean(owner))
              .map(({ id }) => id)
              .filter((id) => id !== session.userId),
          ]),
        ].sort();

        await assertPaymentOwnerChangeFenceHeld(tx, mergeUserIds);
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
          where: { remnashopUserId: targetRemnashopUserId },
          select: ownerSelect,
        });
        const currentSourceOwner =
          lookupSeparateSourceOwner && recoverySourceRemnashopUserId
            ? await tx.webUser.findUnique({
                where: { remnashopUserId: recoverySourceRemnashopUserId },
                select: ownerSelect,
              })
            : null;
        const currentEmailOwner =
          lookupSeparateEmailOwner && verifiedRecoveryEmail
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
        const currentSession = await tx.webSession.findFirst({
          where: {
            id: session.id,
            userId: session.userId,
            revokedAt: null,
          },
        });

        if (
          !lockedSessions.some(({ id }) => id === session.id) ||
          !localIdentityIsCurrent(currentUser, currentSession)
        ) {
          throw ownershipError("local_identity_changed_before_recovery");
        }

        const localMergeOwners = [
          currentTargetOwner,
          currentSourceOwner,
          currentEmailOwner,
        ]
          .filter((owner): owner is OwnerSnapshot => Boolean(owner))
          .filter((owner, index, owners) =>
            owner.id !== session.userId &&
            owners.findIndex(({ id }) => id === owner.id) === index
          );
        const sourceUserIds = localMergeOwners.map(({ id }) => id);

        for (const owner of localMergeOwners) {
          if (owner.telegramId && owner.telegramId !== expectedIdentity.telegramId) {
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

        const upstreamOwnerChanging =
            expectedIdentity.remnashopUserId !== targetRemnashopUserId;
        const upstreamMergeRequired = Boolean(
          recoverySourceRemnashopUserId &&
          recoverySourceRemnashopUserId !== targetRemnashopUserId,
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

        return {
          mergeUserIds,
          targetOwner: currentTargetOwner,
          sourceOwner: currentSourceOwner,
          emailOwner: currentEmailOwner,
          currentUser: currentUser!,
          localMergeOwners,
          sourceUserIds,
          upstreamOwnerChanging,
        };
      }, recoveryTransactionOptions);

      let auth = initialAuth;
      let profile = initialProfile;
      let remnashopUserId = initialRemnashopUserId;
      let upstreamMerged = Boolean(
        pendingMergeIsProven &&
        initialRemnashopUserId === targetRemnashopUserId &&
        expectedIdentity.remnashopUserId !== targetRemnashopUserId,
      );

      if (
        recoverySourceRemnashopUserId &&
        recoverySourceRemnashopUserId !== targetRemnashopUserId &&
        !upstreamMerged
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
          targetRemnashopUserId,
          "target",
        );
        const networkDeadline = Date.now() + 20_000;
        const nextRequestTimeout = () => {
          const remainingMs = networkDeadline - Date.now();

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
          await markPaymentOwnerChangeUpstreamMutationStarted();
          mergeResult = await remnashopMergeUsers({
            sourceUserId,
            targetUserId,
            reason:
              "Clean Pay Telegram recovery: verified local owner and Telegram identity",
            timeoutMs: nextRequestTimeout(),
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
          timeoutMs: nextRequestTimeout(),
        });
        remnashopUserId = getRemnashopUserIdFromAccessToken(
          auth.cookies.accessToken,
        );
        profile = await getRemnashopMe(auth.cookies.accessToken, {
          timeoutMs: nextRequestTimeout(),
        });
        assertExpectedTelegramProfile(profile, "after_merge");
        upstreamMerged = true;

        if (remnashopUserId !== targetRemnashopUserId) {
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

      if (normalizedExpectedEmail && !profileMatchesExpectedEmail(profile)) {
        throw ownershipError("verified_email_mismatch");
      }

      const finalEmail = verifiedRecoveryEmail ?? expectedIdentity.email;
      const finalEmailVerified = Boolean(verifiedRecoveryEmail);

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

      // Revalidate the exact snapshot while holding the durable fence. This is
      // the only transaction that mutates local ownership or stores tokens.
      return prisma.$transaction(async (tx) => {
        await assertPaymentOwnerChangeFenceHeld(tx, snapshot.mergeUserIds);
        const currentUser = await tx.webUser.findUnique({
          where: { id: session.userId },
        });
        const currentSession = await tx.webSession.findFirst({
          where: {
            id: session.id,
            userId: session.userId,
            revokedAt: null,
          },
        });
        const currentTargetOwner = await tx.webUser.findUnique({
          where: { remnashopUserId: targetRemnashopUserId },
          select: ownerSelect,
        });
        const currentSourceOwner =
          lookupSeparateSourceOwner && recoverySourceRemnashopUserId
            ? await tx.webUser.findUnique({
                where: { remnashopUserId: recoverySourceRemnashopUserId },
                select: ownerSelect,
              })
            : null;
        const currentEmailOwner =
          lookupSeparateEmailOwner && verifiedRecoveryEmail
            ? await tx.webUser.findUnique({
                where: { email: verifiedRecoveryEmail },
                select: ownerSelect,
              })
            : null;

        if (
          !localIdentityIsCurrent(currentUser, currentSession) ||
          !sameOwnerSnapshot(snapshot.targetOwner, currentTargetOwner) ||
          !sameOwnerSnapshot(snapshot.sourceOwner, currentSourceOwner) ||
          !sameOwnerSnapshot(snapshot.emailOwner, currentEmailOwner)
        ) {
          throw ownershipError("local_identity_changed_before_recovery");
        }

        if (snapshot.sourceUserIds.length > 0) {
          await mergeLocalUsersIntoTarget(tx, {
            targetUserId: session.userId,
            targetUpstreamAccountId: remnashopUserId,
            sourceUserIds: snapshot.sourceUserIds,
            ownerExpectations: [
              {
                id: snapshot.currentUser.id,
                remnashopUserId: snapshot.currentUser.remnashopUserId,
                email: snapshot.currentUser.email,
                telegramId: snapshot.currentUser.telegramId,
              },
              ...snapshot.localMergeOwners.map((owner) => ({
                id: owner.id,
                remnashopUserId: owner.remnashopUserId,
                email: owner.email,
                telegramId: owner.telegramId,
              })),
            ],
            paymentOwnerFenceHeld: true,
          });
        } else if (snapshot.upstreamOwnerChanging) {
          await transferPaymentOperationsForUserMerge(
            tx,
            session.userId,
            remnashopUserId,
            [],
          );
        }

        if (upstreamMerged) {
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
              remnashopRefreshClaimTokenHash: null,
              remnashopRefreshLeaseExpiresAt: null,
              remnashopRefreshDispatchedAt: null,
              remnashopRefreshRecoveryEncrypted: null,
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
            remnashopRefreshClaimTokenHash: null,
            remnashopRefreshLeaseExpiresAt: null,
            remnashopRefreshDispatchedAt: null,
            remnashopRefreshRecoveryEncrypted: null,
          },
        });

        if (stored.count !== 1) {
          throw ownershipError("local_session_changed_during_recovery");
        }

        await assertUserMergeFinalOwner(tx, {
          targetUserId: session.userId,
          sourceUserIds: snapshot.sourceUserIds,
          expected: {
            remnashopUserId,
            email: finalEmail,
            telegramId: expectedIdentity.telegramId,
          },
        });

        await markPaymentOwnerChangeLocalFinalized(tx, [session.userId]);

        return {
          auth,
          remnashopUserId,
          finalEmail,
          finalEmailVerified,
          upstreamMerged,
          accessExpiresAt,
          refreshExpiresAt,
        };
      }, recoveryTransactionOptions);
    },
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
