import { claimOneTimeState } from "@/application/auth/claim-one-time-state";
import { prismaOneTimeStateRepository } from "@/backend/integrations/auth/prisma-one-time-state";

export async function claimWebAuthnChallenge(id: string, now = new Date()) {
  return claimOneTimeState(prismaOneTimeStateRepository, "webauthn-challenge", id, now);
}

export async function claimTelegramAuthState(id: string, now = new Date()) {
  return claimOneTimeState(prismaOneTimeStateRepository, "telegram-auth-state", id, now);
}
