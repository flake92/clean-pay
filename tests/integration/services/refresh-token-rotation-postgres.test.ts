import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sha256 } from "@/backend/security/crypto";

const realDatabaseUrl = process.env.REAL_DATABASE_URL;
const describeWithPostgres = realDatabaseUrl ? describe : describe.skip;

describeWithPostgres("refresh token family PostgreSQL rotation", () => {
  let prisma: typeof import("@/backend/database/prisma")["prisma"];
  let rotateRefreshTokenFamily: typeof import("@/backend/sessions/web-session")["rotateRefreshTokenFamily"];
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = realDatabaseUrl as string;
    delete (globalThis as typeof globalThis & { prisma?: unknown }).prisma;
    ({ prisma } = await import("@/backend/database/prisma"));
    ({ rotateRefreshTokenFamily } = await import("@/backend/sessions/web-session"));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.webUser.deleteMany({ where: { id: { in: userIds } } });
  });

  it("gives parallel consumers one successor and revokes only that family on late reuse", async () => {
    const originalToken = `refresh-${Date.now()}-${Math.random()}`;
    const now = new Date();
    const user = await prisma.webUser.create({ data: {} });
    userIds.push(user.id);
    const session = await prisma.webSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: sha256(originalToken),
        accessTokenExpiresAt: new Date(now.getTime() + 60_000),
        refreshExpiresAt: new Date(now.getTime() + 86_400_000),
      },
    });

    const results = await Promise.all([
      rotateRefreshTokenFamily(originalToken, now),
      rotateRefreshTokenFamily(originalToken, new Date(now.getTime() + 1)),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ status: "ok" }),
      expect.objectContaining({ status: "ok" }),
    ]);
    const successful = results.filter((result) => result?.status === "ok");
    expect(successful.map((result) => result?.successorToken)).toEqual([
      successful[0]?.successorToken,
      successful[0]?.successorToken,
    ]);
    expect(successful.map((result) => result?.reusedPrevious).sort()).toEqual([false, true]);
    await expect(prisma.webRefreshToken.count({ where: { sessionId: session.id } })).resolves.toBe(1);

    await expect(
      rotateRefreshTokenFamily(originalToken, new Date(now.getTime() + 11_000)),
    ).resolves.toMatchObject({ status: "reuse", sessionId: session.id, userId: user.id });
    await expect(prisma.webSession.findUnique({ where: { id: session.id } }))
      .resolves.toMatchObject({ revokedAt: expect.any(Date) });
  });
});
