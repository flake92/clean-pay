import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
  },
  tx: {
    $queryRaw: vi.fn(),
    webSession: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  authDebugLog: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: mocks.authDebugLog,
}));

import { acquireRemnashopTokensForSession } from "@/backend/integrations/remnashop/session-token-lifecycle";
import { protectRemnashopToken } from "@/backend/integrations/remnashop/token-protection";

const future = new Date("2099-01-01T00:00:00.000Z");

function localSession({
  id,
  accessToken,
  refreshToken,
  accessExpiresAt = future,
  refreshExpiresAt = future,
}: {
  id: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  accessExpiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
}) {
  return {
    id,
    userId: "user-1",
    refreshTokenHash: `local-${id}`,
    remnashopAccessTokenEncrypted: accessToken
      ? protectRemnashopToken(accessToken)
      : null,
    remnashopRefreshTokenEncrypted: refreshToken
      ? protectRemnashopToken(refreshToken)
      : null,
    remnashopAccessExpiresAt: accessExpiresAt,
    remnashopRefreshExpiresAt: refreshExpiresAt,
    authMethod: "EMAIL",
    assuranceLevel: "FULL",
    userAgent: "vitest",
    ipHash: null,
    accessTokenExpiresAt: future,
    refreshExpiresAt: future,
    revokedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    user: {
      id: "user-1",
      email: "user@example.com",
      emailVerified: true,
      telegramId: null,
    },
  };
}

describe("Remnashop session token lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
    mocks.tx.webSession.updateMany.mockResolvedValue({ count: 1 });
  });

  it("moves one bundle to the requesting session and removes only duplicate owners", async () => {
    const target = localSession({ id: "target" });
    const owner = localSession({
      id: "owner",
      accessToken: "shared-access",
      refreshToken: "shared-refresh",
    });
    const duplicate = localSession({
      id: "duplicate",
      accessToken: "older-shared-access",
      refreshToken: "shared-refresh",
    });
    const independent = localSession({
      id: "independent",
      accessToken: "independent-access",
      refreshToken: "independent-refresh",
    });
    mocks.tx.$queryRaw.mockResolvedValue([
      { id: "duplicate" },
      { id: "independent" },
      { id: "owner" },
      { id: "target" },
    ]);
    mocks.tx.webSession.findMany.mockResolvedValue([
      owner,
      duplicate,
      independent,
      target,
    ]);
    const refresh = vi.fn();

    await expect(
      acquireRemnashopTokensForSession({
        session: target as never,
        refresh,
      }),
    ).resolves.toMatchObject({
      accessToken: "shared-access",
      refreshToken: "shared-refresh",
      session: { id: "target" },
      source: "stored",
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.tx.webSession.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: { in: expect.arrayContaining(["owner", "duplicate"]) },
        userId: "user-1",
      },
      data: {
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
        remnashopAccessExpiresAt: null,
        remnashopRefreshExpiresAt: null,
      },
    });
    const clearedIds = mocks.tx.webSession.updateMany.mock.calls[0]?.[0]?.where
      ?.id?.in as string[];
    expect(clearedIds).not.toContain("independent");
    expect(mocks.tx.webSession.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "target", userId: "user-1", revokedAt: null },
      data: {
        remnashopAccessTokenEncrypted: owner.remnashopAccessTokenEncrypted,
        remnashopRefreshTokenEncrypted: owner.remnashopRefreshTokenEncrypted,
        remnashopAccessExpiresAt: future,
        remnashopRefreshExpiresAt: future,
      },
    });
  });

  it("refreshes an expiring bundle once while its owner rows are locked", async () => {
    const target = localSession({
      id: "target",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessExpiresAt: new Date(Date.now() - 1_000),
    });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    const refresh = vi.fn().mockResolvedValue({
      data: {
        expires_at: "2099-02-01T00:00:00.000Z",
        refresh_expires_at: "2099-03-01T00:00:00.000Z",
      },
      cookies: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
      },
    });

    await expect(
      acquireRemnashopTokensForSession({
        session: target as never,
        refresh,
      }),
    ).resolves.toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      source: "refresh",
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("old-refresh");
    expect(mocks.tx.webSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: "target",
        userId: "user-1",
        revokedAt: null,
        remnashopRefreshTokenEncrypted:
          target.remnashopRefreshTokenEncrypted,
      },
      data: expect.objectContaining({
        remnashopAccessTokenEncrypted: expect.any(String),
        remnashopRefreshTokenEncrypted: expect.any(String),
        remnashopAccessExpiresAt: new Date("2099-02-01T00:00:00.000Z"),
        remnashopRefreshExpiresAt: new Date("2099-03-01T00:00:00.000Z"),
      }),
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 5_000, timeout: 20_000 },
    );
  });

  it("clears unusable token material without attempting an expired refresh", async () => {
    const target = localSession({
      id: "target",
      accessToken: "expired-access",
      refreshToken: "expired-refresh",
      accessExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
      refreshExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    const refresh = vi.fn();

    await expect(
      acquireRemnashopTokensForSession({
        session: target as never,
        refresh,
      }),
    ).resolves.toBeNull();

    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.tx.webSession.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["target"] }, userId: "user-1" },
      data: {
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
        remnashopAccessExpiresAt: null,
        remnashopRefreshExpiresAt: null,
      },
    });
  });

  it("fails closed when the requesting session was not part of the locked owner set", async () => {
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "other" }]);

    await expect(
      acquireRemnashopTokensForSession({
        session: { id: "target", userId: "user-1" },
        refresh: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    expect(mocks.tx.webSession.findMany).not.toHaveBeenCalled();
  });
});
