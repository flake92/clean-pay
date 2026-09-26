import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  decryptKeyringSecret,
  encryptKeyringSecret,
  encryptSecret,
  sha256,
} from "@/backend/security/crypto";
import {
  encryptionRewrapPurposes,
  runEncryptionRewrap,
} from "../../../deploy/prod/encryption-rewrap.mjs";

const realDatabaseUrl = process.env.REAL_DATABASE_URL;
const describeWithPostgres = realDatabaseUrl ? describe : describe.skip;

describeWithPostgres("encryption key rotation on persisted non-empty rows", () => {
  let prisma: typeof import("@/backend/database/prisma")["prisma"];
  let userId = "";
  let telegramStateId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = realDatabaseUrl as string;
    delete (globalThis as typeof globalThis & { prisma?: unknown }).prisma;
    ({ prisma } = await import("@/backend/database/prisma"));
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      if (telegramStateId) {
        await prisma.telegramAuthState.deleteMany({
          where: { id: telegramStateId },
        });
      }
      if (userId) {
        await prisma.webUser.deleteMany({ where: { id: userId } });
      }
      await prisma.$disconnect();
    }
    vi.unstubAllEnvs();
  });

  it("moves every ciphertext family through A+B, B-only and a CAS rollback to A", async () => {
    const secretA = "postgres-rotation-secret-A-7Vr3Nm8Wp2Kq5Xs9";
    const secretB = "postgres-rotation-secret-B-4Lc8Kq2Vr9Nm5Xs7";
    const keyA = {
      primary: { id: "pg-shared-key", secret: secretA },
      previous: [],
    };
    const mixed = {
      primary: { id: "pg-shared-key", secret: secretB },
      previous: [{ id: "pg-shared-key", secret: secretA }],
    };
    const keyB = { primary: mixed.primary, previous: [] };
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const predecessor = `predecessor-${suffix}`;
    const successor = `successor-${suffix}`;
    const now = new Date();
    const user = await prisma.webUser.create({
      data: { email: `key-rotation-${suffix}@example.test`, emailVerified: true },
    });
    userId = user.id;
    const webSession = await prisma.webSession.create({
      data: {
        userId,
        refreshTokenHash: sha256(successor),
        remnashopAccessTokenEncrypted: encryptSecret("provider-access", secretA),
        remnashopRefreshTokenEncrypted: encryptKeyringSecret(
          "provider-refresh",
          keyA,
          encryptionRewrapPurposes.providerToken,
        ),
        remnashopAccessExpiresAt: new Date(now.getTime() + 5 * 60_000),
        remnashopRefreshExpiresAt: new Date(now.getTime() + 60 * 60_000),
        remnashopRefreshRecoveryEncrypted: encryptKeyringSecret(
          JSON.stringify({
            version: 1,
            accessToken: "recovery-access",
            refreshToken: "recovery-refresh",
            accessExpiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
            refreshExpiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
          }),
          keyA,
          encryptionRewrapPurposes.providerToken,
        ),
        accessTokenExpiresAt: new Date(now.getTime() + 5 * 60_000),
        refreshExpiresAt: new Date(now.getTime() + 60 * 60_000),
      },
    });
    const consumed = await prisma.webRefreshToken.create({
      data: {
        sessionId: webSession.id,
        tokenHash: sha256(predecessor),
        successorTokenEncrypted: encryptKeyringSecret(
          successor,
          keyA,
          encryptionRewrapPurposes.refreshSuccessor,
        ),
        graceExpiresAt: new Date(now.getTime() + 60_000),
        consumedAt: now,
      },
    });
    const telegramState = await prisma.telegramAuthState.create({
      data: {
        stateHash: sha256(`state-${suffix}`),
        nonceHash: sha256(`nonce-${suffix}`),
        codeVerifierHash: sha256(`verifier-${suffix}`),
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        consumedAt: now,
        callbackStatus: "COMPLETED",
        callbackCodeHash: sha256(`code-${suffix}`),
        callbackResultEncrypted: encryptKeyringSecret(
          JSON.stringify({ version: 1, session: { webSessionId: webSession.id } }),
          keyA,
          encryptionRewrapPurposes.telegramCallback,
        ),
        callbackResultExpiresAt: new Date(now.getTime() + 10 * 60_000),
        callbackCompletedAt: now,
        userId,
      },
    });
    telegramStateId = telegramState.id;

    const scopedPrisma = {
      webSession: {
        findMany: (args: Parameters<typeof prisma.webSession.findMany>[0]) =>
          prisma.webSession.findMany({
            ...args,
            where: { AND: [args?.where ?? {}, { id: webSession.id }] },
          }),
        updateMany: (args: Parameters<typeof prisma.webSession.updateMany>[0]) =>
          prisma.webSession.updateMany(args),
      },
      webRefreshToken: {
        findMany: (args: Parameters<typeof prisma.webRefreshToken.findMany>[0]) =>
          prisma.webRefreshToken.findMany({
            ...args,
            where: { AND: [args?.where ?? {}, { id: consumed.id }] },
          }),
        updateMany: (args: Parameters<typeof prisma.webRefreshToken.updateMany>[0]) =>
          prisma.webRefreshToken.updateMany(args),
      },
      telegramAuthState: {
        findMany: (args: Parameters<typeof prisma.telegramAuthState.findMany>[0]) =>
          prisma.telegramAuthState.findMany({
            ...args,
            where: { AND: [args?.where ?? {}, { id: telegramState.id }] },
          }),
        updateMany: (args: Parameters<typeof prisma.telegramAuthState.updateMany>[0]) =>
          prisma.telegramAuthState.updateMany(args),
      },
    };

    await expect(runEncryptionRewrap(scopedPrisma, mixed, {
      apply: true,
      batchSize: 1,
      maxBatches: 10,
    })).resolves.toMatchObject({
      complete: true,
      needsRewrap: 5,
      rewrapped: 5,
      conflicts: 0,
      unreadable: 0,
      oldKeyUsage: { "pg-shared-key": 5 },
    });

    const [storedSession, storedSuccessor, storedCallback] = await Promise.all([
      prisma.webSession.findUniqueOrThrow({ where: { id: webSession.id } }),
      prisma.webRefreshToken.findUniqueOrThrow({ where: { id: consumed.id } }),
      prisma.telegramAuthState.findUniqueOrThrow({ where: { id: telegramState.id } }),
    ]);
    expect(decryptKeyringSecret(
      storedSession.remnashopAccessTokenEncrypted!,
      keyB,
      encryptionRewrapPurposes.providerToken,
    ).value).toBe("provider-access");
    expect(decryptKeyringSecret(
      storedSession.remnashopRefreshTokenEncrypted!,
      keyB,
      encryptionRewrapPurposes.providerToken,
    ).value).toBe("provider-refresh");
    expect(decryptKeyringSecret(
      storedSession.remnashopRefreshRecoveryEncrypted!,
      keyB,
      encryptionRewrapPurposes.providerToken,
    ).value).toContain("recovery-refresh");
    expect(decryptKeyringSecret(
      storedSuccessor.successorTokenEncrypted,
      keyB,
      encryptionRewrapPurposes.refreshSuccessor,
    ).value).toBe(successor);
    expect(decryptKeyringSecret(
      storedCallback.callbackResultEncrypted!,
      keyB,
      encryptionRewrapPurposes.telegramCallback,
    ).value).toContain(webSession.id);

    vi.stubEnv("WEB_REFRESH_KEY_ID", "pg-shared-key");
    vi.stubEnv("WEB_REFRESH_SECRET", secretB);
    vi.stubEnv("WEB_REFRESH_PREVIOUS_KEYS", "");
    const { rotateRefreshTokenFamily } = await import(
      "@/backend/integrations/sessions/web-session-service"
    );
    await expect(rotateRefreshTokenFamily(
      predecessor,
      new Date(now.getTime() + 1_000),
    )).resolves.toMatchObject({
      status: "ok",
      session: { id: webSession.id, userId },
      successorToken: successor,
      reusedPrevious: true,
    });

    await expect(runEncryptionRewrap(scopedPrisma, keyB, {
      retirementCheck: true,
      batchSize: 1,
      maxBatches: 10,
    })).resolves.toMatchObject({
      complete: true,
      needsRewrap: 0,
      unreadable: 0,
      retirementReady: true,
    });

    const rollback = {
      primary: keyA.primary,
      previous: [mixed.primary],
    };
    await expect(runEncryptionRewrap(scopedPrisma, rollback, {
      apply: true,
      batchSize: 1,
      maxBatches: 10,
    })).resolves.toMatchObject({
      complete: true,
      needsRewrap: 5,
      rewrapped: 5,
      conflicts: 0,
      unreadable: 0,
      oldKeyUsage: { "pg-shared-key": 5 },
    });
    const [rolledBackSession, rolledBackSuccessor, rolledBackCallback] = await Promise.all([
      prisma.webSession.findUniqueOrThrow({ where: { id: webSession.id } }),
      prisma.webRefreshToken.findUniqueOrThrow({ where: { id: consumed.id } }),
      prisma.telegramAuthState.findUniqueOrThrow({ where: { id: telegramState.id } }),
    ]);
    expect(decryptKeyringSecret(
      rolledBackSession.remnashopAccessTokenEncrypted!,
      keyA,
      encryptionRewrapPurposes.providerToken,
    ).value).toBe("provider-access");
    expect(decryptKeyringSecret(
      rolledBackSession.remnashopRefreshTokenEncrypted!,
      keyA,
      encryptionRewrapPurposes.providerToken,
    ).value).toBe("provider-refresh");
    expect(decryptKeyringSecret(
      rolledBackSession.remnashopRefreshRecoveryEncrypted!,
      keyA,
      encryptionRewrapPurposes.providerToken,
    ).value).toContain("recovery-refresh");
    expect(decryptKeyringSecret(
      rolledBackSuccessor.successorTokenEncrypted,
      keyA,
      encryptionRewrapPurposes.refreshSuccessor,
    ).value).toBe(successor);
    expect(decryptKeyringSecret(
      rolledBackCallback.callbackResultEncrypted!,
      keyA,
      encryptionRewrapPurposes.telegramCallback,
    ).value).toContain(webSession.id);
    await expect(runEncryptionRewrap(scopedPrisma, keyA, {
      retirementCheck: true,
      batchSize: 1,
      maxBatches: 10,
    })).resolves.toMatchObject({
      complete: true,
      needsRewrap: 0,
      unreadable: 0,
      retirementReady: true,
    });
  }, 120_000);
});
