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
    throw new BffError("UNAUTHORIZED", 401, "Нужно войти в аккаунт.");
  }

  const remnashopUserId = getRemnashopUserIdFromAccessToken(accessToken);
  const profile = await getRemnashopMe(accessToken);
  const linkedByRemnashopId = await prisma.webUser.findUnique({
    where: { remnashopUserId },
  });

  if (linkedByRemnashopId && linkedByRemnashopId.id !== session.userId) {
    throw new BffError(
      "CONFLICT",
      409,
      "Этот e-mail уже привязан к другому web-аккаунту.",
    );
  }

  if (profile.email) {
    const linkedByEmail = await prisma.webUser.findUnique({
      where: { email: profile.email },
    });

    if (linkedByEmail && linkedByEmail.id !== session.userId) {
      throw new BffError(
        "CONFLICT",
        409,
        "Этот e-mail уже привязан к другому web-аккаунту.",
      );
    }
  }

  const user = await prisma.webUser.update({
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

  await prisma.webSession.update({
    where: { id: session.id },
    data: {
      remnashopAccessTokenEncrypted: protectRemnashopToken(accessToken),
      remnashopRefreshTokenEncrypted: protectRemnashopToken(refreshToken),
      remnashopAccessExpiresAt: new Date(auth.expires_at),
      remnashopRefreshExpiresAt: new Date(auth.refresh_expires_at),
    },
  });

  await auditLog({
    action: "remnashop_account_linked",
    userId: user.id,
    metadata: { remnashopUserId },
  });

  return { user, profile };
}
