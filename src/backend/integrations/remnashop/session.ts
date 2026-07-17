import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { prisma } from "@/backend/database/prisma";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { WebSessionAssuranceLevel, type Prisma } from "@prisma/client";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  protectRemnashopToken,
} from "@/backend/integrations/remnashop/client";
import type { RemnashopAuthResponse } from "@/shared/remnashop/types";
import {
  createWebSessionForRemnashopUser,
  getCurrentSession,
} from "@/backend/sessions/web-session";
import {
  assertUserMergeFinalOwner,
  mergeLocalUsersIntoTarget,
} from "@/backend/auth/user-merge";

type RemnashopProfileIdentity = {
  remnashopUserId: string;
  email: string | null;
  emailVerified: boolean;
  telegramId: string | null;
  telegramUsername: string | null;
  fullName: string | null;
};

function profileIdentity({
  remnashopUserId,
  profile,
}: {
  remnashopUserId: string;
  profile: Awaited<ReturnType<typeof getRemnashopMe>>;
}): RemnashopProfileIdentity {
  return {
    remnashopUserId,
    email: profile.email,
    emailVerified: profile.is_email_verified,
    telegramId:
      profile.telegram_id === null ? null : String(profile.telegram_id),
    telegramUsername: profile.username,
    fullName: profile.name,
  };
}

async function reconcileRemnashopUser(
  tx: Prisma.TransactionClient,
  identity: RemnashopProfileIdentity,
) {
  const [linkedByRemnashopId, linkedByEmail, linkedByTelegramId] =
    await Promise.all([
      tx.webUser.findUnique({
        where: { remnashopUserId: identity.remnashopUserId },
      }),
      identity.email
        ? tx.webUser.findUnique({ where: { email: identity.email } })
        : Promise.resolve(null),
      identity.telegramId
        ? tx.webUser.findUnique({
            where: { telegramId: identity.telegramId },
          })
        : Promise.resolve(null),
    ]);

  const targetCandidate =
    linkedByEmail ?? linkedByTelegramId ?? linkedByRemnashopId;
  const sourceUserIds = [
    linkedByRemnashopId,
    linkedByEmail,
    linkedByTelegramId,
  ]
    .filter((user): user is NonNullable<typeof user> => Boolean(user))
    .map((user) => user.id)
    .filter((userId, index, userIds) => {
      return userId !== targetCandidate?.id && userIds.indexOf(userId) === index;
    });

  authDebugLog("remnashop_user_reconcile_plan", {
    remnashopUserId: identity.remnashopUserId,
    hasEmailMatch: Boolean(linkedByEmail),
    hasRemnashopIdMatch: Boolean(linkedByRemnashopId),
    hasTelegramIdMatch: Boolean(linkedByTelegramId),
    targetUserId: targetCandidate?.id,
    sourceUserIds,
    mergeCount: sourceUserIds.length,
  });

  if (!targetCandidate) {
    const user = await tx.webUser.create({
      data: {
        remnashopUserId: identity.remnashopUserId,
        email: identity.email,
        telegramId: identity.telegramId ?? undefined,
        telegramUsername: identity.telegramUsername,
        fullName: identity.fullName,
        displayName: identity.fullName,
        emailVerified: identity.emailVerified,
        authPending: false,
        lastLoginAt: new Date(),
      },
    });
    authDebugLog("remnashop_user_reconcile_created", {
      userId: user.id,
      remnashopUserId: identity.remnashopUserId,
      hasEmail: Boolean(user.email),
      hasTelegramId: Boolean(user.telegramId),
    });

    return user;
  }

  if (sourceUserIds.length > 0) {
    authDebugLog("remnashop_user_reconcile_merge_started", {
      targetUserId: targetCandidate.id,
      sourceUserIds,
    });
    await mergeLocalUsersIntoTarget(tx, {
      targetUserId: targetCandidate.id,
      targetUpstreamAccountId: identity.remnashopUserId,
      sourceUserIds,
    });
    authDebugLog("remnashop_user_reconcile_merge_completed", {
      targetUserId: targetCandidate.id,
      sourceUserIds,
    });
  }

  const user = await tx.webUser.update({
    where: { id: targetCandidate.id },
    data: {
      remnashopUserId: identity.remnashopUserId,
      email: identity.email ?? targetCandidate.email,
      telegramId: identity.telegramId ?? targetCandidate.telegramId ?? undefined,
      telegramUsername: identity.telegramUsername ?? targetCandidate.telegramUsername,
      fullName: identity.fullName ?? targetCandidate.fullName,
      displayName: identity.fullName ?? targetCandidate.displayName ?? identity.telegramUsername ?? targetCandidate.telegramUsername,
      emailVerified: identity.email ? identity.emailVerified : targetCandidate.emailVerified,
      lastLoginAt: new Date(),
    },
  });

  if (sourceUserIds.length > 0) {
    await assertUserMergeFinalOwner(tx, {
      targetUserId: user.id,
      sourceUserIds,
      expected: {
        remnashopUserId: identity.remnashopUserId,
        ...(identity.email ? { email: identity.email } : {}),
        ...(identity.telegramId ? { telegramId: identity.telegramId } : {}),
      },
    });
  }
  authDebugLog("remnashop_user_reconcile_updated", {
    userId: user.id,
    remnashopUserId: identity.remnashopUserId,
    hasEmail: Boolean(user.email),
    hasTelegramId: Boolean(user.telegramId),
  });

  return user;
}

export async function createSessionFromRemnashopAuth({
  accessToken,
  refreshToken,
  auth,
}: {
  accessToken: string;
  refreshToken: string;
  auth: RemnashopAuthResponse;
}) {
  const remnashopUserId = getRemnashopUserIdFromAccessToken(accessToken);
  authDebugLog("remnashop_session_create_started", {
    remnashopUserId,
    remnashopAccessExpiresAt: auth.expires_at,
    remnashopRefreshExpiresAt: auth.refresh_expires_at,
  });
  const profile = await getRemnashopMe(accessToken);
  authDebugLog("remnashop_profile_loaded", {
    remnashopUserId,
    hasEmail: Boolean(profile.email),
    emailVerified: profile.is_email_verified,
    hasTelegramId: profile.telegram_id !== null,
    authType: profile.auth_type,
  });
  const user = await prisma.$transaction(async (tx) => {
    const reconciledUser = await reconcileRemnashopUser(
      tx,
      profileIdentity({ remnashopUserId, profile }),
    );

    await createWebSessionForRemnashopUser({
      userId: reconciledUser.id,
      remnashopAccessTokenEncrypted: protectRemnashopToken(accessToken),
      remnashopRefreshTokenEncrypted: protectRemnashopToken(refreshToken),
      remnashopAccessExpiresAt: new Date(auth.expires_at),
      remnashopRefreshExpiresAt: new Date(auth.refresh_expires_at),
      assuranceLevel: WebSessionAssuranceLevel.FULL,
      tx,
    });

    return reconciledUser;
  });

  authDebugLog("remnashop_session_create_success", {
    userId: user.id,
    remnashopUserId,
    hasEmail: Boolean(user.email),
    emailVerified: user.emailVerified,
    hasTelegramId: Boolean(user.telegramId),
  });

  return { user, profile };
}

export async function reconcileUserFromRemnashopAuth({
  accessToken,
  refreshToken,
  auth,
}: {
  accessToken: string;
  refreshToken: string;
  auth: RemnashopAuthResponse;
}) {
  const remnashopUserId = getRemnashopUserIdFromAccessToken(accessToken);
  const profile = await getRemnashopMe(accessToken);
  const user = await prisma.$transaction(async (tx) => {
    return reconcileRemnashopUser(
      tx,
      profileIdentity({ remnashopUserId, profile }),
    );
  });

  await auditLog({
    action: "remnashop_account_linked",
    userId: user.id,
    metadata: { remnashopUserId, source: "telegram" },
  });

  return {
    user,
    profile,
    remnashopSession: {
      accessTokenEncrypted: protectRemnashopToken(accessToken),
      refreshTokenEncrypted: protectRemnashopToken(refreshToken),
      accessExpiresAt: new Date(auth.expires_at),
      refreshExpiresAt: new Date(auth.refresh_expires_at),
    },
  };
}

export async function linkCurrentUserToRemnashopAuth({
  accessToken,
  refreshToken,
  auth,
}: {
  accessToken: string;
  refreshToken: string;
  auth: RemnashopAuthResponse;
}) {
  const session = await getCurrentSession();
  authDebugLog("remnashop_link_started", {
    hasSession: Boolean(session),
    sessionId: session?.id,
    currentUserId: session?.userId,
  });

  if (!session) {
    throw new BffError("UNAUTHORIZED", 401, "Login is required.");
  }

  const remnashopUserId = getRemnashopUserIdFromAccessToken(accessToken);
  const profile = await getRemnashopMe(accessToken);
  authDebugLog("remnashop_link_profile_loaded", {
    sessionId: session.id,
    currentUserId: session.userId,
    remnashopUserId,
    hasEmail: Boolean(profile.email),
    emailVerified: profile.is_email_verified,
    hasTelegramId: profile.telegram_id !== null,
  });
  const mergeSourceIds = new Set<string>();
  const linkedByRemnashopId = await prisma.webUser.findUnique({
    where: { remnashopUserId },
  });

  if (linkedByRemnashopId && linkedByRemnashopId.id !== session.userId) {
    mergeSourceIds.add(linkedByRemnashopId.id);
  }

  if (profile.email) {
    const linkedByEmail = await prisma.webUser.findUnique({
      where: { email: profile.email },
    });

    if (linkedByEmail && linkedByEmail.id !== session.userId) {
      mergeSourceIds.add(linkedByEmail.id);
    }
  }

  if (profile.telegram_id !== null) {
    const linkedByTelegramId = await prisma.webUser.findUnique({
      where: { telegramId: String(profile.telegram_id) },
    });

    if (linkedByTelegramId && linkedByTelegramId.id !== session.userId) {
      mergeSourceIds.add(linkedByTelegramId.id);
    }
  }

  const sourceUserIds = [...mergeSourceIds];
  authDebugLog("remnashop_link_merge_plan", {
    sessionId: session.id,
    targetUserId: session.userId,
    remnashopUserId,
    sourceUserIds,
    mergeCount: sourceUserIds.length,
  });
  const protectedAccessToken = protectRemnashopToken(accessToken);
  const protectedRefreshToken = protectRemnashopToken(refreshToken);
  const user = await prisma.$transaction(async (tx) => {
    if (sourceUserIds.length > 0) {
      authDebugLog("remnashop_link_merge_started", {
        targetUserId: session.userId,
        sourceUserIds,
      });
      await mergeLocalUsersIntoTarget(tx, {
        targetUserId: session.userId,
        targetUpstreamAccountId: remnashopUserId,
        sourceUserIds,
      });
      authDebugLog("remnashop_link_merge_completed", {
        targetUserId: session.userId,
        sourceUserIds,
      });
    }

    const updatedUser = await tx.webUser.update({
      where: { id: session.userId },
      data: {
        remnashopUserId,
        email: profile.email ?? session.user.email,
        emailVerified: profile.email ? profile.is_email_verified : session.user.emailVerified,
        telegramId: profile.telegram_id === null ? session.user.telegramId : String(profile.telegram_id),
        telegramUsername: profile.username ?? session.user.telegramUsername,
        fullName: profile.name ?? session.user.fullName,
        displayName: profile.name ?? session.user.displayName ?? profile.username ?? session.user.telegramUsername,
        lastLoginAt: new Date(),
      },
    });

    await tx.webSession.update({
      where: { id: session.id },
      data: {
        remnashopAccessTokenEncrypted: protectedAccessToken,
        remnashopRefreshTokenEncrypted: protectedRefreshToken,
        remnashopAccessExpiresAt: new Date(auth.expires_at),
        remnashopRefreshExpiresAt: new Date(auth.refresh_expires_at),
      },
    });

    if (sourceUserIds.length > 0) {
      await assertUserMergeFinalOwner(tx, {
        targetUserId: updatedUser.id,
        sourceUserIds,
        expected: {
          remnashopUserId,
          ...(profile.email ? { email: profile.email } : {}),
          ...(profile.telegram_id === null
            ? {}
            : { telegramId: String(profile.telegram_id) }),
        },
      });
    }

    return updatedUser;
  });

  await auditLog({
    action: "remnashop_account_linked",
    userId: user.id,
    metadata: { remnashopUserId, mergedUserIds: sourceUserIds },
  });

  authDebugLog("remnashop_link_success", {
    userId: user.id,
    sessionId: session.id,
    remnashopUserId,
    mergedUserIds: sourceUserIds,
    hasEmail: Boolean(user.email),
    emailVerified: user.emailVerified,
  });

  return { user, profile };
}
