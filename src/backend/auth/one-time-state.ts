import { prismaOneTimeStateRepository } from "@/backend/integrations/auth/prisma-one-time-state";

export async function claimWebAuthnChallenge(id: string, now = new Date()) {
  return prismaOneTimeStateRepository.claim({ kind: "webauthn-challenge", id, consumedAt: now });
}

export async function claimTelegramAuthState(
  id: string,
  now = new Date(),
) {
  return prismaOneTimeStateRepository.claim({
    kind: "telegram-auth-state",
    id,
    consumedAt: now,
  });
}
