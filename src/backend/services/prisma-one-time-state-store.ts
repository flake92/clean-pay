import { prisma } from "@/backend/database/prisma";
import type { OneTimeStateStore } from "@/backend/services/one-time-state-store";

export const prismaOneTimeStateStore: OneTimeStateStore = {
  async claimWebAuthnChallenge(id: string, now = new Date()): Promise<boolean> {
    const result = await prisma.webAuthnChallenge.updateMany({
      where: {
        id,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    return result.count === 1;
  },

  async claimTelegramAuthState(id: string, now = new Date()): Promise<boolean> {
    const result = await prisma.telegramAuthState.updateMany({
      where: {
        id,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    return result.count === 1;
  },
};
