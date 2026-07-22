import { afterAll, beforeAll, describe, expect, it } from "vitest";

const realDatabaseUrl = process.env.REAL_DATABASE_URL;
const describeWithPostgres = realDatabaseUrl ? describe : describe.skip;

describeWithPostgres("one-time auth state PostgreSQL claims", () => {
  let prisma: typeof import("@/backend/database/prisma")["prisma"];
  let claimWebAuthnChallenge: typeof import("@/backend/auth/one-time-state")["claimWebAuthnChallenge"];
  let claimTelegramAuthState: typeof import("@/backend/auth/one-time-state")["claimTelegramAuthState"];
  const challengeIds: string[] = [];
  const telegramStateIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = realDatabaseUrl as string;
    delete (globalThis as typeof globalThis & { prisma?: unknown }).prisma;

    ({ prisma } = await import("@/backend/database/prisma"));
    ({ claimWebAuthnChallenge, claimTelegramAuthState } = await import(
      "@/backend/auth/one-time-state"
    ));
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    await prisma.webAuthnChallenge.deleteMany({ where: { id: { in: challengeIds } } });
    await prisma.telegramAuthState.deleteMany({ where: { id: { in: telegramStateIds } } });
  });

  it("allows exactly one concurrent WebAuthn challenge claimant", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const challenge = await prisma.webAuthnChallenge.create({
      data: {
        challenge: `integration-challenge-${suffix}`,
        type: "AUTHENTICATION",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    challengeIds.push(challenge.id);

    const claims = await Promise.all(
      Array.from({ length: 16 }, () => claimWebAuthnChallenge(challenge.id)),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(prisma.webAuthnChallenge.findUnique({ where: { id: challenge.id } }))
      .resolves.toMatchObject({ consumedAt: expect.any(Date) });
  });

  it("allows exactly one concurrent Telegram state claimant", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const authState = await prisma.telegramAuthState.create({
      data: {
        stateHash: `state-${suffix}`,
        nonceHash: `nonce-${suffix}`,
        codeVerifierHash: `verifier-${suffix}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    telegramStateIds.push(authState.id);

    const claims = await Promise.all(
      Array.from({ length: 16 }, () => claimTelegramAuthState(authState.id)),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(prisma.telegramAuthState.findUnique({ where: { id: authState.id } }))
      .resolves.toMatchObject({ consumedAt: expect.any(Date) });
  });

  it("never consumes expired state", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const challenge = await prisma.webAuthnChallenge.create({
      data: {
        challenge: `expired-challenge-${suffix}`,
        type: "AUTHENTICATION",
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    challengeIds.push(challenge.id);

    await expect(claimWebAuthnChallenge(challenge.id)).resolves.toBe(false);
    await expect(prisma.webAuthnChallenge.findUnique({ where: { id: challenge.id } }))
      .resolves.toMatchObject({ consumedAt: null });
  });
});
