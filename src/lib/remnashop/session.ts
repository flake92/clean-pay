import { auditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { BffError } from "@/lib/remnashop/errors";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  protectRemnashopToken,
} from "@/lib/remnashop/client";
import type { RemnashopAuthResponse } from "@/lib/remnashop/types";
import {
  createWebSessionForRemnashopUser,
  getCurrentSession,
} from "@/lib/session";

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
  const profile = await getRemnashopMe(accessToken);
  const user = await prisma.webUser.upsert({
    where: { remnashopUserId },
    create: {
      remnashopUserId,
      email: profile.email,
      telegramId:
        profile.telegram_id === null ? undefined : BigInt(profile.telegram_id),
      telegramUsername: profile.username,
      fullName: profile.name,
      displayName: profile.name,
      emailVerified: profile.is_email_verified,
      lastLoginAt: new Date(),
    },
    update: {
      email: profile.email,
      telegramId:
        profile.telegram_id === null ? undefined : BigInt(profile.telegram_id),
      telegramUsername: profile.username,
      fullName: profile.name,
      displayName: profile.name,
      emailVerified: profile.is_email_verified,
      lastLoginAt: new Date(),
    },
  });

  await createWebSessionForRemnashopUser({
    userId: user.id,
    remnashopAccessTokenEncrypted: protectRemnashopToken(accessToken),
    remnashopRefreshTokenEncrypted: protectRemnashopToken(refreshToken),
    remnashopAccessExpiresAt: new Date(auth.expires_at),
    remnashopRefreshExpiresAt: new Date(auth.refresh_expires_at),
  });

  return { user, profile };
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

  if (!session) {
    throw new BffError("UNAUTHORIZED", 401, "Login is required.");
  }

  const remnashopUserId = getRemnashopUserIdFromAccessToken(accessToken);
  const profile = await getRemnashopMe(accessToken);
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

  const sourceUserIds = [...mergeSourceIds];
  const protectedAccessToken = protectRemnashopToken(accessToken);
  const protectedRefreshToken = protectRemnashopToken(refreshToken);
  const user = await prisma.$transaction(async (tx) => {
    if (sourceUserIds.length > 0) {
      await tx.webUser.updateMany({
        where: { id: { in: sourceUserIds } },
        data: {
          remnashopUserId: null,
          email: null,
          telegramId: null,
        },
      });
      await tx.webSession.updateMany({
        where: { userId: { in: sourceUserIds } },
        data: { userId: session.userId },
      });
      await tx.auditLog.updateMany({
        where: { userId: { in: sourceUserIds } },
        data: { userId: session.userId },
      });
      await tx.paymentRecord.updateMany({
        where: { userId: { in: sourceUserIds } },
        data: { userId: session.userId },
      });
      await tx.emailVerificationCode.updateMany({
        where: { userId: { in: sourceUserIds } },
        data: { userId: session.userId },
      });
      await tx.telegramAuthState.updateMany({
        where: { userId: { in: sourceUserIds } },
        data: { userId: session.userId },
      });
      await tx.webUser.deleteMany({
        where: { id: { in: sourceUserIds } },
      });
    }

    const updatedUser = await tx.webUser.update({
      where: { id: session.userId },
      data: {
        remnashopUserId,
        email: profile.email,
        emailVerified: profile.is_email_verified,
        fullName: profile.name,
        displayName: profile.name,
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

    return updatedUser;
  });

  await auditLog({
    action: "remnashop_account_linked",
    userId: user.id,
    metadata: { remnashopUserId, mergedUserIds: sourceUserIds },
  });

  return { user, profile };
}
