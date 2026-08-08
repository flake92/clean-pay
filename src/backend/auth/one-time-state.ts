import { prisma } from "@/backend/database/prisma";

export async function claimWebAuthnChallenge(id: string, now = new Date()) {
  const result = await prisma.webAuthnChallenge.updateMany({
    where: {
      id,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });

  return result.count === 1;
}

export async function claimTelegramAuthState(id: string, now = new Date()) {
  const result = await prisma.telegramAuthState.updateMany({
    where: {
      id,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });

  return result.count === 1;
}
