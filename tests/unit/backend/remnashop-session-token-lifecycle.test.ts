import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
  },
  tx: {
    $queryRaw: vi.fn(),
    webSession: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
import {
  protectRemnashopToken,
  revealRemnashopToken,
} from "@/backend/integrations/remnashop/token-protection";

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
    remnashopRefreshClaimTokenHash: null,
    remnashopRefreshLeaseExpiresAt: null,
    remnashopRefreshDispatchedAt: null,
    remnashopRefreshRecoveryEncrypted: null,
    remnashopRefreshAttemptCount: 0,
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
  function refreshResponse() {
    return {
      data: {
        expires_at: "2099-02-01T00:00:00.000Z",
        refresh_expires_at: "2099-03-01T00:00:00.000Z",
      },
      cookies: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
      },
    };
  }

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
        remnashopRefreshClaimTokenHash: null,
        remnashopRefreshLeaseExpiresAt: null,
        remnashopRefreshDispatchedAt: null,
        remnashopRefreshRecoveryEncrypted: null,
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
        remnashopRefreshClaimTokenHash: null,
        remnashopRefreshLeaseExpiresAt: null,
        remnashopRefreshDispatchedAt: null,
        remnashopRefreshRecoveryEncrypted: null,
      },
    });
  });

  it("commits the claim before refreshing, then stores recovery before finalizing", async () => {
    const target = localSession({
      id: "target",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessExpiresAt: new Date(Date.now() - 1_000),
    });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    const events: string[] = [];
    let transactionNumber = 0;
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => {
        transactionNumber += 1;
        const current = transactionNumber;
        events.push(`tx-${current}-start`);
        const result = await callback(mocks.tx);
        events.push(`tx-${current}-commit`);
        return result;
      },
    );
    const claimed = {
      ...target,
      remnashopRefreshClaimTokenHash: "claim-hash",
      remnashopRefreshLeaseExpiresAt: new Date(Date.now() + 60_000),
    };
    let recoveryEncrypted: string | null = null;
    let claimHash: string | null = null;
    mocks.tx.webSession.updateMany.mockImplementation(async (input) => {
      if (
        input.data?.remnashopRefreshClaimTokenHash &&
        !input.data?.remnashopRefreshRecoveryEncrypted
      ) {
        claimHash = input.data.remnashopRefreshClaimTokenHash;
      }
      if (input.data?.remnashopRefreshRecoveryEncrypted) {
        events.push("recovery-stored");
        recoveryEncrypted = input.data.remnashopRefreshRecoveryEncrypted;
      }
      if (input.data?.remnashopRefreshDispatchedAt) {
        events.push("dispatch-marked");
      }
      return { count: 1 };
    });
    mocks.tx.webSession.findFirst.mockImplementation(async () => {
      if (recoveryEncrypted) {
        return {
          ...claimed,
          remnashopRefreshClaimTokenHash: claimHash,
          remnashopRefreshRecoveryEncrypted: recoveryEncrypted,
        };
      }
      return claimed;
    });
    const refresh = vi.fn().mockImplementation(async () => {
      events.push("upstream-refresh");
      return refreshResponse();
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
    expect(events.indexOf("tx-1-commit")).toBeLessThan(
      events.indexOf("dispatch-marked"),
    );
    expect(events.indexOf("dispatch-marked")).toBeLessThan(
      events.indexOf("tx-2-commit"),
    );
    expect(events.indexOf("tx-2-commit")).toBeLessThan(
      events.indexOf("upstream-refresh"),
    );
    expect(events.indexOf("upstream-refresh")).toBeLessThan(
      events.indexOf("recovery-stored"),
    );
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(4);
    for (const call of mocks.prisma.$transaction.mock.calls) {
      expect(call[1]).toEqual({ maxWait: 5_000, timeout: 10_000 });
    }
    const recoveryWrite = mocks.tx.webSession.updateMany.mock.calls.find(
      ([input]) => input.data?.remnashopRefreshRecoveryEncrypted,
    )?.[0];
    const dispatchWrite = mocks.tx.webSession.updateMany.mock.calls.find(
      ([input]) => input.data?.remnashopRefreshDispatchedAt,
    )?.[0];
    expect(recoveryWrite?.where.remnashopRefreshDispatchedAt).toEqual(
      dispatchWrite?.data.remnashopRefreshDispatchedAt,
    );
    const recoveryPayload = recoveryWrite?.data
      .remnashopRefreshRecoveryEncrypted as string;
    expect(JSON.parse(revealRemnashopToken(recoveryPayload))).toMatchObject({
      version: 1,
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    const finalWrite = mocks.tx.webSession.updateMany.mock.calls.find(
      ([input]) => input.data?.remnashopAccessTokenEncrypted,
    )?.[0];
    expect(finalWrite?.data).toMatchObject({
      remnashopAccessTokenEncrypted: expect.any(String),
      remnashopRefreshTokenEncrypted: expect.any(String),
      remnashopAccessExpiresAt: new Date("2099-02-01T00:00:00.000Z"),
      remnashopRefreshExpiresAt: new Date("2099-03-01T00:00:00.000Z"),
      remnashopRefreshClaimTokenHash: null,
      remnashopRefreshLeaseExpiresAt: null,
      remnashopRefreshDispatchedAt: null,
      remnashopRefreshRecoveryEncrypted: null,
    });
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
        remnashopRefreshClaimTokenHash: null,
        remnashopRefreshLeaseExpiresAt: null,
        remnashopRefreshDispatchedAt: null,
        remnashopRefreshRecoveryEncrypted: null,
      },
    });
  });

  it("clears token material that cannot be decrypted", async () => {
    const target = {
      ...localSession({ id: "target", refreshToken: "refresh" }),
      remnashopAccessTokenEncrypted: "not-an-encrypted-token",
    };
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    const refresh = vi.fn();

    await expect(
      acquireRemnashopTokensForSession({ session: target, refresh }),
    ).resolves.toBeNull();

    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.tx.webSession.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["target"] }, userId: "user-1" },
      data: expect.objectContaining({
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
      }),
    });
  });

  it("rejects invalid tokens and expiry dates returned by refresh", async () => {
    const target = localSession({
      id: "target",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessExpiresAt: new Date(Date.now() - 1_000),
    });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);

    await expect(acquireRemnashopTokensForSession({
      session: target,
      refresh: vi.fn().mockResolvedValue({
        ...refreshResponse(),
        cookies: { accessToken: "", refreshToken: "new-refresh" },
      }),
    })).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 502 });

    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
    mocks.tx.webSession.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    await expect(acquireRemnashopTokensForSession({
      session: target,
      refresh: vi.fn().mockResolvedValue({
        ...refreshResponse(),
        data: {
          expires_at: "not-a-date",
          refresh_expires_at: "2099-03-01T00:00:00.000Z",
        },
      }),
    })).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 502 });
  });

  it("clears a corrupt durable refresh recovery and detects a competing cleanup", async () => {
    const corrupt = {
      ...localSession({
        id: "target",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        accessExpiresAt: new Date(Date.now() - 1_000),
      }),
      remnashopRefreshRecoveryEncrypted: protectRemnashopToken(
        JSON.stringify({ version: 2, accessToken: "bad" }),
      ),
    };
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([corrupt]);

    await expect(acquireRemnashopTokensForSession({
      session: corrupt,
      refresh: vi.fn(),
    })).resolves.toBeNull();
    expect(mocks.authDebugLog).toHaveBeenCalledWith(
      "remnashop_token_refresh_recovery_corrupt",
      { sessionId: "target", userId: "user-1" },
    );

    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([corrupt]);
    mocks.tx.webSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(acquireRemnashopTokensForSession({
      session: corrupt,
      refresh: vi.fn(),
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("rejects when the locked session set changes before it is loaded", async () => {
    const target = localSession({ id: "target" });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }, { id: "other" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);

    await expect(acquireRemnashopTokensForSession({
      session: target,
      refresh: vi.fn(),
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("detects competing stale-dispatch cleanup and token transfer", async () => {
    const stale = {
      ...localSession({
        id: "target",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        accessExpiresAt: new Date(Date.now() - 1_000),
      }),
      remnashopRefreshClaimTokenHash: "stale-claim",
      remnashopRefreshLeaseExpiresAt: new Date(Date.now() - 1_000),
      remnashopRefreshDispatchedAt: new Date(Date.now() - 2_000),
    };
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([stale]);
    mocks.tx.webSession.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(acquireRemnashopTokensForSession({
      session: stale,
      refresh: vi.fn(),
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
    );
    const target = localSession({ id: "target" });
    const owner = localSession({
      id: "owner",
      accessToken: "owner-access",
      refreshToken: "owner-refresh",
    });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "owner" }, { id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([owner, target]);
    mocks.tx.webSession.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(acquireRemnashopTokensForSession({
      session: target,
      refresh: vi.fn(),
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("clears an obsolete refresh fence from a still-valid stored bundle", async () => {
    const target = {
      ...localSession({
        id: "target",
        accessToken: "access",
        refreshToken: "refresh",
      }),
      remnashopRefreshClaimTokenHash: "expired-claim",
      remnashopRefreshLeaseExpiresAt: new Date(Date.now() - 1_000),
    };
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);

    await expect(acquireRemnashopTokensForSession({
      session: target,
      refresh: vi.fn(),
    })).resolves.toMatchObject({
      source: "stored",
      session: {
        remnashopRefreshClaimTokenHash: null,
        remnashopRefreshLeaseExpiresAt: null,
      },
    });
    expect(mocks.tx.webSession.updateMany).toHaveBeenCalledWith({
      where: { id: "target", userId: "user-1", revokedAt: null },
      data: expect.objectContaining({ remnashopRefreshClaimTokenHash: null }),
    });
  });

  it("rejects when another worker wins the refresh claim", async () => {
    const target = localSession({
      id: "target",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessExpiresAt: new Date(Date.now() - 1_000),
    });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    mocks.tx.webSession.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(acquireRemnashopTokensForSession({
      session: target,
      refresh: vi.fn(),
    })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
      debug: { retryAfterSeconds: 1 },
    });
  });

  it("returns retryable contention without consuming a refresh token while a lease is active", async () => {
    const target = {
      ...localSession({
        id: "target",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        accessExpiresAt: new Date(Date.now() - 1_000),
      }),
      remnashopRefreshClaimTokenHash: "other-claim",
      remnashopRefreshLeaseExpiresAt: new Date(Date.now() + 45_000),
    };
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    const refresh = vi.fn();

    await expect(
      acquireRemnashopTokensForSession({ session: target, refresh }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
      debug: { retryAfterSeconds: 5 },
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.tx.webSession.updateMany).not.toHaveBeenCalled();
  });

  it("takes over an expired lease with a new fenced claim", async () => {
    const target = {
      ...localSession({
        id: "target",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        accessExpiresAt: new Date(Date.now() - 1_000),
      }),
      remnashopRefreshClaimTokenHash: "expired-claim",
      remnashopRefreshLeaseExpiresAt: new Date(Date.now() - 1_000),
      remnashopRefreshAttemptCount: 4,
    };
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    let recoveryEncrypted: string | null = null;
    mocks.tx.webSession.updateMany.mockImplementation(async (input) => {
      if (input.data?.remnashopRefreshRecoveryEncrypted) {
        recoveryEncrypted = input.data.remnashopRefreshRecoveryEncrypted;
      }
      return { count: 1 };
    });
    mocks.tx.webSession.findFirst.mockImplementation(async () => ({
      ...target,
      remnashopRefreshClaimTokenHash:
        mocks.tx.webSession.updateMany.mock.calls[0]?.[0]?.data
          ?.remnashopRefreshClaimTokenHash,
      remnashopRefreshRecoveryEncrypted: recoveryEncrypted,
    }));
    const refresh = vi.fn().mockResolvedValue(refreshResponse());

    await expect(
      acquireRemnashopTokensForSession({ session: target, refresh }),
    ).resolves.toMatchObject({ source: "refresh" });

    expect(refresh).toHaveBeenCalledOnce();
    expect(mocks.tx.webSession.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { remnashopRefreshLeaseExpiresAt: { lte: expect.any(Date) } },
          ]),
        }),
        data: expect.objectContaining({
          remnashopRefreshClaimTokenHash: expect.not.stringMatching(
            /^expired-claim$/,
          ),
          remnashopRefreshAttemptCount: { increment: 1 },
        }),
      }),
    );
  });

  it("never replays a one-time token after a dispatched claim expires without recovery", async () => {
    const target = {
      ...localSession({
        id: "target",
        accessToken: "old-access",
        refreshToken: "consumed-refresh",
        accessExpiresAt: new Date(Date.now() - 1_000),
      }),
      remnashopRefreshClaimTokenHash: "expired-dispatched-claim",
      remnashopRefreshLeaseExpiresAt: new Date(Date.now() - 1_000),
      remnashopRefreshDispatchedAt: new Date(Date.now() - 2_000),
    };
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    const refresh = vi.fn();

    await expect(
      acquireRemnashopTokensForSession({ session: target, refresh }),
    ).resolves.toBeNull();

    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.tx.webSession.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webSession.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: ["target"] },
        userId: "user-1",
        remnashopRefreshDispatchedAt: { not: null },
        remnashopRefreshRecoveryEncrypted: null,
      }),
      data: expect.objectContaining({
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
        remnashopRefreshClaimTokenHash: null,
        remnashopRefreshLeaseExpiresAt: null,
        remnashopRefreshDispatchedAt: null,
        remnashopRefreshRecoveryEncrypted: null,
      }),
    });
  });

  it("promotes an encrypted recovery without calling the provider again", async () => {
    const recovery = {
      version: 1,
      accessToken: "recovered-access",
      refreshToken: "recovered-refresh",
      accessExpiresAt: "2099-02-01T00:00:00.000Z",
      refreshExpiresAt: "2099-03-01T00:00:00.000Z",
    };
    const target = {
      ...localSession({
        id: "target",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        accessExpiresAt: new Date(Date.now() - 1_000),
      }),
      remnashopRefreshClaimTokenHash: "claim-hash",
      remnashopRefreshLeaseExpiresAt: new Date(Date.now() - 1_000),
      remnashopRefreshRecoveryEncrypted: protectRemnashopToken(
        JSON.stringify(recovery),
      ),
    };
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    const refresh = vi.fn();

    await expect(
      acquireRemnashopTokensForSession({ session: target, refresh }),
    ).resolves.toMatchObject({
      accessToken: "recovered-access",
      refreshToken: "recovered-refresh",
      source: "stored",
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.tx.webSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          remnashopRefreshRecoveryEncrypted:
            target.remnashopRefreshRecoveryEncrypted,
        }),
        data: expect.objectContaining({
          remnashopRefreshClaimTokenHash: null,
          remnashopRefreshLeaseExpiresAt: null,
          remnashopRefreshDispatchedAt: null,
          remnashopRefreshRecoveryEncrypted: null,
        }),
      }),
    );
  });

  it("retries transient recovery storage and finalization failures without another provider call", async () => {
    const target = localSession({
      id: "target",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessExpiresAt: new Date(Date.now() - 1_000),
    });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    const refresh = vi.fn().mockResolvedValue(refreshResponse());
    let call = 0;
    let recoveryEncrypted: string | null = null;
    let claimHash: string | null = null;
    mocks.tx.webSession.updateMany.mockImplementation(async (input) => {
      call += 1;

      if (call === 1) {
        claimHash = input.data.remnashopRefreshClaimTokenHash;
        return { count: 1 };
      }

      if (input.data?.remnashopRefreshRecoveryEncrypted) {
        if (!recoveryEncrypted) {
          recoveryEncrypted = input.data.remnashopRefreshRecoveryEncrypted;
          throw new Error("transient recovery commit failure");
        }
        return { count: 1 };
      }

      if (input.data?.remnashopAccessTokenEncrypted && call < 5) {
        throw new Error("transient finalization commit failure");
      }

      return { count: 1 };
    });
    mocks.tx.webSession.findFirst.mockImplementation(async () => ({
      ...target,
      remnashopRefreshClaimTokenHash: claimHash,
      remnashopRefreshLeaseExpiresAt: new Date(Date.now() + 60_000),
      remnashopRefreshRecoveryEncrypted: recoveryEncrypted,
    }));

    await expect(
      acquireRemnashopTokensForSession({ session: target, refresh }),
    ).resolves.toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      source: "refresh",
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(mocks.prisma.$transaction.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps a failed upstream claim fenced until its lease expires", async () => {
    const target = localSession({
      id: "target",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessExpiresAt: new Date(Date.now() - 1_000),
    });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    const refresh = vi.fn().mockRejectedValue(new Error("upstream failed"));

    await expect(
      acquireRemnashopTokensForSession({ session: target, refresh }),
    ).rejects.toThrow("upstream failed");

    expect(refresh).toHaveBeenCalledOnce();
    expect(mocks.tx.webSession.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.tx.webSession.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          remnashopRefreshClaimTokenHash: expect.any(String),
          remnashopRefreshLeaseExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.tx.webSession.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          remnashopRefreshClaimTokenHash: expect.any(String),
          remnashopRefreshDispatchedAt: null,
        }),
        data: { remnashopRefreshDispatchedAt: expect.any(Date) },
      }),
    );
  });

  it("does not call the provider unless the dispatch marker commits", async () => {
    const target = localSession({
      id: "target",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessExpiresAt: new Date(Date.now() - 1_000),
    });
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "target" }]);
    mocks.tx.webSession.findMany.mockResolvedValue([target]);
    mocks.tx.webSession.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const refresh = vi.fn();

    await expect(
      acquireRemnashopTokensForSession({ session: target, refresh }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(refresh).not.toHaveBeenCalled();
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
