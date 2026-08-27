import { claimTelegramAuthState as claimTelegramAuthStateRecord } from "@/backend/auth/one-time-state";
import { redisCommand } from "@/backend/cache/redis";
import { prisma } from "@/backend/database/prisma";
import type { TelegramAuthRequest } from "@/backend/integrations/remnashop/contracts";
import { telegramWidgetReplayTtlSeconds } from "@/backend/integrations/telegram/oidc-codec";
import { logTechnicalWarning } from "@/backend/observability/audit";
import { sha256 } from "@/backend/security/crypto";

export class TelegramAuthStateAlreadyConsumedError extends Error {
  constructor() {
    super("Telegram auth state was already consumed or has expired");
    this.name = "TelegramAuthStateAlreadyConsumedError";
  }
}

export async function createTelegramAuthState(input: {
  stateHash: string;
  nonceHash: string;
  codeVerifierHash: string;
  redirectTo: string | undefined;
  userId: string | undefined;
  expiresAt: Date;
}) {
  return prisma.telegramAuthState.create({ data: input });
}

export async function findTelegramAuthStateByProof(input: {
  stateHash: string;
  nonceHash: string;
  codeVerifierHash: string;
}) {
  return prisma.telegramAuthState.findFirst({
    where: {
      ...input,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

export async function findTelegramAuthStateByNonce(nonceHash: string) {
  return prisma.telegramAuthState.findFirst({
    where: {
      nonceHash,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

export async function claimTelegramLoginWidgetPayload(payload: TelegramAuthRequest) {
  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const ttlSeconds = telegramWidgetReplayTtlSeconds(
    Number(payload.auth_date),
    nowEpochSeconds,
  );
  const claimed = await redisCommand([
    "SET",
    `clean-pay:telegram-widget:v1:${sha256(payload.hash)}`,
    "1",
    "NX",
    "EX",
    ttlSeconds,
  ]);
  if (claimed !== "OK") {
    throw new Error("Telegram Login payload was already used");
  }
}

export async function claimTelegramAuthState(authState: { id: string }) {
  if (!await claimTelegramAuthStateRecord(authState.id)) {
    logTechnicalWarning("telegram_oidc_state_already_consumed", {
      authStateId: authState.id,
    });
    throw new TelegramAuthStateAlreadyConsumedError();
  }
}
