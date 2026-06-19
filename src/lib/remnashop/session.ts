import { prisma } from "@/lib/prisma";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  protectRemnashopToken,
} from "@/lib/remnashop/client";
import type { RemnashopAuthResponse } from "@/lib/remnashop/types";
import { createWebSessionForRemnashopUser } from "@/lib/session";

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
