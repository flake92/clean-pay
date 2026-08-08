import type { OneTimeStateRepository } from "@/backend/application/auth/ports/one-time-state";
import { prisma } from "@/backend/database/prisma";

export const prismaOneTimeStateRepository: OneTimeStateRepository = {
  async claim({ kind, id, consumedAt }) {
    const where = { id, consumedAt: null, expiresAt: { gt: consumedAt } };
    const result = kind === "webauthn-challenge"
      ? await prisma.webAuthnChallenge.updateMany({ where, data: { consumedAt } })
      : await prisma.telegramAuthState.updateMany({ where, data: { consumedAt } });
    return result.count === 1;
  },
};
