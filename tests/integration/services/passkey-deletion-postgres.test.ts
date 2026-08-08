import { afterAll, beforeAll, describe, expect, it } from "vitest";

const realDatabaseUrl = process.env.REAL_DATABASE_URL;
const describeWithPostgres = realDatabaseUrl ? describe : describe.skip;

describeWithPostgres("passkey deletion PostgreSQL serialization", () => {
  let prisma: typeof import("@/backend/database/prisma")["prisma"];
  let deleteOwnedPasskey: typeof import("@/backend/auth/passkeys")["deleteOwnedPasskey"];
  let recordPasskeyUse: typeof import("@/backend/auth/passkeys")["recordPasskeyUse"];
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = realDatabaseUrl as string;
    delete (globalThis as typeof globalThis & { prisma?: unknown }).prisma;

    ({ prisma } = await import("@/backend/database/prisma"));
    ({ deleteOwnedPasskey, recordPasskeyUse } = await import("@/backend/auth/passkeys"));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.webUser.deleteMany({ where: { id: { in: userIds } } });
  });

  it("allows only one of two concurrent deletions and preserves the last passkey", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.webUser.create({ data: {} });
    userIds.push(user.id);
    const credentials = await Promise.all([
      prisma.webAuthnCredential.create({
        data: {
          userId: user.id,
          credentialId: `concurrent-passkey-a-${suffix}`,
          publicKey: Buffer.from(`public-key-a-${suffix}`),
          transports: [],
        },
      }),
      prisma.webAuthnCredential.create({
        data: {
          userId: user.id,
          credentialId: `concurrent-passkey-b-${suffix}`,
          publicKey: Buffer.from(`public-key-b-${suffix}`),
          transports: [],
        },
      }),
    ]);

    const results = await Promise.allSettled([
      deleteOwnedPasskey(user.id, credentials[0].id),
      deleteOwnedPasskey(user.id, credentials[1].id),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "FORBIDDEN", status: 403 },
    });
    await expect(prisma.webAuthnCredential.count({ where: { userId: user.id } })).resolves.toBe(1);
  });

  it("allows exactly one concurrent non-zero counter advancement", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.webUser.create({ data: {} });
    userIds.push(user.id);
    const credential = await prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: `counter-passkey-${suffix}`,
        publicKey: Buffer.from(`counter-public-key-${suffix}`),
        counter: 1n,
        transports: [],
      },
    });
    const advance = () => recordPasskeyUse({
      id: credential.id,
      userId: user.id,
      credentialId: credential.credentialId,
      oldCounter: 1n,
      newCounter: 2n,
    });

    const results = await Promise.allSettled([advance(), advance()]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: { code: "UNAUTHORIZED", status: 401 },
    });
    await expect(prisma.webAuthnCredential.findUnique({ where: { id: credential.id } }))
      .resolves.toMatchObject({ counter: 2n, lastUsedAt: expect.any(Date) });
  });
});
