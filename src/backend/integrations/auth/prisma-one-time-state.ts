import { prisma } from "@/backend/database/prisma";

export const prismaOneTimeStateRepository = {
  async claim({
    kind,
    id,
    consumedAt,
  }: {
    kind: "webauthn-challenge" | "telegram-auth-state";
    id: string;
    consumedAt: Date;
  }) {
    const where = { id, consumedAt: null, expiresAt: { gt: consumedAt } };
    const result = kind === "webauthn-challenge"
      ? await prisma.webAuthnChallenge.updateMany({ where, data: { consumedAt } })
      : await prisma.telegramAuthState.updateMany({ where, data: { consumedAt } });
    return result.count === 1;
  },
};
