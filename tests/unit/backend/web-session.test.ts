import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  setCalls: [] as Array<{ name: string; value: string; options: unknown }>,
  deleteCalls: [] as string[],
  headers: new Headers({ "user-agent": "vitest" }),
}));

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    webSession: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    webRefreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    webUser: {
      findUnique: vi.fn(),
    },
    webAuthnCredential: {
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  authDebugLog: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = state.cookies.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string, options: unknown) => {
      state.cookies.set(name, value);
      state.setCalls.push({ name, value, options });
    },
    delete: (name: string) => {
      state.cookies.delete(name);
      state.deleteCalls.push(name);
    },
  })),
  headers: vi.fn(async () => state.headers),
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: mocks.authDebugLog,
}));

vi.mock("@/backend/observability/audit", () => ({
  auditLog: mocks.auditLog,
}));

import {
  assertEmailVerificationPolicy,
  clearWebSession,
  createWebSession,
  createWebSessionForRemnashopUser,
  createWebSessionOnResponse,
  getCurrentSession,
  getCurrentUser,
  getWebSessionUserIdFromAccessCookie,
  replaceWebSessionAfterPasswordChange,
  refreshCurrentAccessCookie,
  rotateRefreshTokenFamily,
  upgradeCurrentSessionToFull,
} from "@/backend/integrations/sessions/web-session-service";
import { hmacSha256, jsonBase64Url, sha256 } from "@/backend/security/crypto";

function accessToken(payload: Record<string, unknown>) {
  const encoded = jsonBase64Url(payload);
  return `${encoded}.${hmacSha256(encoded, process.env.WEB_JWT_SECRET ?? "test-web-jwt-secret")}`;
}

const user = {
  id: "user-1",
  email: "user@example.com",
  emailVerified: true,
  telegramId: "123",
  telegramUsername: "clean_user",
};

const session = {
  id: "session-1",
  userId: "user-1",
  user,
  authMethod: "EMAIL",
  assuranceLevel: "FULL",
  accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  refreshExpiresAt: new Date("2099-02-01T00:00:00.000Z"),
  remnashopAccessTokenEncrypted: "ra",
  remnashopRefreshTokenEncrypted: "rr",
  remnashopAccessExpiresAt: new Date("2099-01-02T00:00:00.000Z"),
  remnashopRefreshExpiresAt: new Date("2099-02-02T00:00:00.000Z"),
};

describe("web session lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.cookies.clear();
    state.setCalls = [];
    state.deleteCalls = [];
    mocks.prisma.webSession.findFirst.mockResolvedValue(null);
    mocks.prisma.webUser.findUnique.mockResolvedValue(user);
    mocks.prisma.webSession.create.mockResolvedValue(session);
    mocks.prisma.webSession.update.mockResolvedValue(session);
    mocks.prisma.webSession.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.webSession.findUnique.mockResolvedValue({ id: "session-1", userId: "user-1" });
    mocks.prisma.webRefreshToken.create.mockResolvedValue({ id: "consumed-1" });
    mocks.prisma.webRefreshToken.findUnique.mockResolvedValue(null);
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: "session-1" }]);
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.prisma) => unknown) =>
        callback(mocks.prisma),
    );
  });

  it.each([
    [
      { email: null, emailVerified: false, telegramId: "123" },
      "EMAIL_REQUIRED",
      401,
    ],
    [
      {
        email: "pending@example.com",
        emailVerified: false,
        telegramId: "123",
      },
      "EMAIL_NOT_VERIFIED",
      403,
    ],
  ])(
    "blocks commerce before verified e-mail even for Telegram sessions",
    (policyUser, code, status) => {
      expect(() =>
        assertEmailVerificationPolicy(policyUser, {
          requireVerifiedEmail: true,
        }),
      ).toThrow(
        expect.objectContaining({
          code,
          status,
        }),
      );
    },
  );

  it("allows commerce after the e-mail is verified", () => {
    expect(() =>
      assertEmailVerificationPolicy(
        {
          email: "verified@example.com",
          emailVerified: true,
          telegramId: "123",
        },
        { requireVerifiedEmail: true },
      ),
    ).not.toThrow();
  });

  it("creates email and Remnashop-backed sessions and sets access/refresh cookies", async () => {
    await expect(createWebSession("user-1")).resolves.toEqual(session);

    expect(mocks.prisma.webSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        authMethod: "EMAIL",
        assuranceLevel: "FULL",
        userAgent: "vitest",
      }),
    });
    const localSessionData = mocks.prisma.webSession.create.mock.calls[0]?.[0]
      ?.data as Record<string, unknown>;
    expect(localSessionData).not.toHaveProperty("remnashopAccessTokenEncrypted");
    expect(localSessionData).not.toHaveProperty("remnashopRefreshTokenEncrypted");
    expect(state.setCalls.map((call) => call.name)).toEqual(["clean_pay_access", "clean_pay_refresh"]);

    await createWebSessionForRemnashopUser({
      userId: "user-1",
      remnashopAccessTokenEncrypted: "protected-access",
      remnashopRefreshTokenEncrypted: "protected-refresh",
      remnashopAccessExpiresAt: new Date("2099-01-02T00:00:00.000Z"),
      remnashopRefreshExpiresAt: new Date("2099-02-02T00:00:00.000Z"),
    });

    expect(mocks.prisma.webSession.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        remnashopAccessTokenEncrypted: "protected-access",
        remnashopRefreshTokenEncrypted: "protected-refresh",
      }),
    });
  });

  it("atomically revokes prior sessions before a password-reset session is created", async () => {
    const transactionClient = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "user-1" }]),
      webSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        create: vi.fn().mockResolvedValue(session),
      },
      webUser: {
        findUnique: vi.fn().mockResolvedValue(user),
      },
    };

    await createWebSessionForRemnashopUser({
      userId: "user-1",
      remnashopAccessTokenEncrypted: "reset-access",
      remnashopRefreshTokenEncrypted: "reset-refresh",
      remnashopAccessExpiresAt: new Date("2099-01-02T00:00:00.000Z"),
      remnashopRefreshExpiresAt: new Date("2099-02-02T00:00:00.000Z"),
      replaceExistingSessions: true,
      tx: transactionClient as never,
    });

    expect(transactionClient.webSession.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: {
        revokedAt: expect.any(Date),
        accessTokenExpiresAt: expect.any(Date),
        refreshExpiresAt: expect.any(Date),
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
        remnashopAccessExpiresAt: null,
        remnashopRefreshExpiresAt: null,
      },
    });
    expect(
      transactionClient.webSession.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      transactionClient.webSession.create.mock.invocationCallOrder[0],
    );
    expect(transactionClient.webSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        remnashopAccessTokenEncrypted: "reset-access",
        remnashopRefreshTokenEncrypted: "reset-refresh",
      }),
    });
    expect(mocks.prisma.webSession.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.webSession.create).not.toHaveBeenCalled();
  });

  it("loads current session and current user from a valid access cookie", async () => {
    state.cookies.set(
      "clean_pay_access",
      accessToken({ sid: "session-1", uid: "user-1", exp: Math.floor(Date.now() / 1000) + 60 }),
    );
    mocks.prisma.webSession.findFirst.mockResolvedValue(session);

    await expect(getCurrentSession()).resolves.toEqual(session);
    await expect(getCurrentUser()).resolves.toEqual(user);

    expect(mocks.prisma.webSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        userId: "user-1",
        revokedAt: null,
        accessTokenExpiresAt: { gt: expect.any(Date) },
      },
      include: { user: true },
    });
  });

  it("fails closed across missing, malformed, expired and database-missing access sessions", async () => {
    await expect(getCurrentUser()).resolves.toBeNull();
    await expect(refreshCurrentAccessCookie()).resolves.toBeNull();
    await expect(upgradeCurrentSessionToFull()).resolves.toBeNull();

    state.cookies.set("clean_pay_access", "malformed");
    await expect(getCurrentUser()).resolves.toBeNull();

    state.cookies.set("clean_pay_access", `${jsonBase64Url({
      sid: "session-1",
      uid: "user-1",
      exp: Math.floor(Date.now() / 1000) + 60,
    })}.wrong-signature`);
    await expect(getCurrentUser()).resolves.toBeNull();

    state.cookies.set("clean_pay_access", accessToken({
      sid: "session-expired",
      uid: "user-1",
      exp: Math.floor(Date.now() / 1000) - 1,
    }));
    await expect(getCurrentUser()).resolves.toBeNull();

    state.cookies.set("clean_pay_access", accessToken({
      sid: "session-missing",
      uid: "user-1",
      exp: Math.floor(Date.now() / 1000) + 60,
    }));
    mocks.prisma.webSession.findFirst.mockResolvedValue(null);
    await expect(getCurrentUser()).resolves.toBeNull();
    await expect(getCurrentSession()).resolves.toBeNull();
  });

  it("requires an explicit transaction when replacing Remnashop sessions", async () => {
    await expect(createWebSessionForRemnashopUser({
      userId: "user-1",
      remnashopAccessTokenEncrypted: "access",
      remnashopRefreshTokenEncrypted: "refresh",
      remnashopAccessExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      remnashopRefreshExpiresAt: new Date("2099-02-01T00:00:00.000Z"),
      replaceExistingSessions: true,
    })).rejects.toThrow("requires an existing database transaction");
  });

  it("falls back to refresh cookie when access is missing or invalid", async () => {
    state.cookies.set("clean_pay_refresh", "refresh-token");
    mocks.prisma.webSession.findUnique.mockResolvedValueOnce({
      ...session,
      refreshTokenHash: sha256("refresh-token"),
      revokedAt: null,
    });
    mocks.prisma.webSession.update.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
      ...session,
      ...data,
    }));

    await expect(getCurrentSession()).resolves.toMatchObject({ id: "session-1" });

    expect(mocks.prisma.webRefreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: "session-1",
        tokenHash: sha256("refresh-token"),
        successorTokenEncrypted: expect.any(String),
        graceExpiresAt: expect.any(Date),
      }),
    });
    expect(state.setCalls.some((call) => call.name === "clean_pay_access")).toBe(true);
    const nextRefresh = state.setCalls.find((call) => call.name === "clean_pay_refresh")?.value;
    expect(nextRefresh).toBeTruthy();
    expect(nextRefresh).not.toBe("refresh-token");
  });

  it("clears access and refresh cookies after a definitive refresh miss", async () => {
    state.cookies.set("clean_pay_access", "expired-or-invalid-access");
    state.cookies.set("clean_pay_refresh", "unknown-refresh");
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(getCurrentSession()).resolves.toBeNull();

    expect(state.cookies.has("clean_pay_access")).toBe(false);
    expect(state.cookies.has("clean_pay_refresh")).toBe(false);
    expect(state.deleteCalls).toEqual([
      "clean_pay_access",
      "clean_pay_refresh",
    ]);
  });

  it("does not clear cookies when refresh lookup fails before a definitive result", async () => {
    state.cookies.set("clean_pay_access", "expired-or-invalid-access");
    state.cookies.set("clean_pay_refresh", "refresh-to-retry");
    mocks.prisma.$queryRaw.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(getCurrentSession()).rejects.toThrow("database unavailable");

    expect(state.cookies.get("clean_pay_access")).toBe(
      "expired-or-invalid-access",
    );
    expect(state.cookies.get("clean_pay_refresh")).toBe("refresh-to-retry");
    expect(state.deleteCalls).toEqual([]);
  });

  it("returns the same successor when the previous token is repeated within grace", async () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const originalToken = "original-refresh";
    mocks.prisma.webSession.findUnique.mockResolvedValueOnce({
      ...session,
      refreshTokenHash: sha256(originalToken),
      revokedAt: null,
    });
    mocks.prisma.webSession.update.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
      ...session,
      ...data,
    }));

    const first = await rotateRefreshTokenFamily(originalToken, now);
    expect(first).toMatchObject({ status: "ok", reusedPrevious: false });
    if (!first || first.status !== "ok") throw new Error("rotation did not produce a successor");
    const historyData = mocks.prisma.webRefreshToken.create.mock.calls[0]?.[0].data;

    mocks.prisma.webSession.findUnique.mockResolvedValueOnce({
      ...session,
      refreshTokenHash: sha256(first.successorToken),
      revokedAt: null,
    });
    mocks.prisma.webRefreshToken.findUnique.mockResolvedValueOnce({
      ...historyData,
      sessionId: "session-1",
    });
    mocks.prisma.webSession.update.mockResolvedValueOnce({
      ...session,
      refreshTokenHash: sha256(first.successorToken),
    });

    const repeated = await rotateRefreshTokenFamily(
      originalToken,
      new Date(now.getTime() + 1_000),
    );

    expect(repeated).toMatchObject({
      status: "ok",
      reusedPrevious: true,
      successorToken: first.successorToken,
    });
    expect(mocks.prisma.webRefreshToken.create).toHaveBeenCalledTimes(1);
  });

  it("revokes only the reused token family outside the grace window", async () => {
    state.cookies.set("clean_pay_refresh", "reused-refresh");
    mocks.prisma.webSession.findUnique.mockResolvedValueOnce({
      ...session,
      refreshTokenHash: sha256("current-successor"),
      revokedAt: null,
    });
    mocks.prisma.webRefreshToken.findUnique.mockResolvedValueOnce({
      sessionId: "session-1",
      tokenHash: sha256("reused-refresh"),
      successorTokenEncrypted: "unused",
      graceExpiresAt: new Date(Date.now() - 1_000),
    });

    await expect(getCurrentSession()).resolves.toBeNull();

    expect(state.setCalls).toEqual([]);
    expect(state.deleteCalls).toEqual(["clean_pay_access", "clean_pay_refresh"]);
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "refresh_token_reuse_detected",
      severity: "WARN",
      userId: "user-1",
    }));
  });

  it("sets cookies on explicit NextResponse and can refresh access cookie", async () => {
    mocks.prisma.webSession.findFirst.mockResolvedValue(null);
    const response = NextResponse.json({ ok: true });

    await createWebSessionOnResponse(response, "user-1");
    expect(response.cookies.get("clean_pay_access")?.value).toBeTruthy();
    expect(response.cookies.get("clean_pay_refresh")?.value).toBeTruthy();
    const responseSessionData = mocks.prisma.webSession.create.mock.calls.at(-1)?.[0]
      ?.data as Record<string, unknown>;
    expect(responseSessionData.remnashopAccessTokenEncrypted).toBeUndefined();
    expect(responseSessionData.remnashopRefreshTokenEncrypted).toBeUndefined();

    state.cookies.set(
      "clean_pay_access",
      accessToken({ sid: "session-1", uid: "user-1", exp: Math.floor(Date.now() / 1000) + 60 }),
    );
    mocks.prisma.webSession.findFirst.mockResolvedValue(session);
    await expect(refreshCurrentAccessCookie()).resolves.toEqual(session);
    expect(state.setCalls.some((call) => call.name === "clean_pay_access")).toBe(true);
  });

  it("revokes every old session, creates a new session and rejects the old refresh token", async () => {
    const currentSession = {
      ...session,
      revokedAt: null,
      userAgent: "old-browser",
      ipHash: "old-ip-hash",
    };
    const newSession = {
      ...session,
      id: "session-2",
      revokedAt: null,
      userAgent: "old-browser",
      ipHash: "old-ip-hash",
    };
    mocks.prisma.webSession.findUnique.mockResolvedValueOnce(currentSession);
    mocks.prisma.webSession.updateMany.mockResolvedValueOnce({ count: 3 });
    mocks.prisma.webSession.create.mockResolvedValueOnce(newSession);

    await expect(
      replaceWebSessionAfterPasswordChange({
        sessionId: "session-1",
        userId: "user-1",
        remnashopAccessTokenEncrypted: "new-remna-access",
        remnashopRefreshTokenEncrypted: "new-remna-refresh",
        remnashopAccessExpiresAt: new Date("2099-01-02T00:00:00.000Z"),
        remnashopRefreshExpiresAt: new Date("2099-02-02T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      session: { id: "session-2" },
      revokedSessionCount: 3,
    });

    expect(mocks.prisma.webSession.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: {
        revokedAt: expect.any(Date),
        accessTokenExpiresAt: expect.any(Date),
        refreshExpiresAt: expect.any(Date),
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
        remnashopAccessExpiresAt: null,
        remnashopRefreshExpiresAt: null,
      },
    });
    const refreshCookie = state.setCalls.find(
      ({ name }) => name === "clean_pay_refresh",
    );
    expect(refreshCookie?.value).toBeTruthy();
    expect(refreshCookie?.value).not.toBe("old-refresh");
    expect(mocks.prisma.webSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        refreshTokenHash: sha256(refreshCookie?.value ?? ""),
        remnashopAccessTokenEncrypted: "new-remna-access",
        remnashopRefreshTokenEncrypted: "new-remna-refresh",
        authMethod: "EMAIL",
        assuranceLevel: "FULL",
        userAgent: "old-browser",
        ipHash: "old-ip-hash",
      }),
    });
    expect(mocks.prisma.webAuthnCredential.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.webAuthnCredential.deleteMany).not.toHaveBeenCalled();

    state.cookies.clear();
    state.setCalls = [];
    state.cookies.set("clean_pay_refresh", "old-refresh");
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(getCurrentSession()).resolves.toBeNull();
    expect(state.setCalls).toEqual([]);
    expect(state.deleteCalls).toEqual([
      "clean_pay_access",
      "clean_pay_refresh",
    ]);
  });

  it("rejects password replacement when the locked session disappears or cannot be revoked", async () => {
    const input = {
      sessionId: "session-1",
      userId: "user-1",
      remnashopAccessTokenEncrypted: "reset-access",
      remnashopRefreshTokenEncrypted: "reset-refresh",
      remnashopAccessExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      remnashopRefreshExpiresAt: new Date("2099-02-01T00:00:00.000Z"),
    };

    mocks.prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(replaceWebSessionAfterPasswordChange(input))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });

    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ id: "session-1" }]);
    mocks.prisma.webSession.findUnique.mockResolvedValueOnce(null);
    await expect(replaceWebSessionAfterPasswordChange(input))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });

    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ id: "session-1" }]);
    mocks.prisma.webSession.findUnique.mockResolvedValueOnce({
      ...session,
      revokedAt: null,
    });
    mocks.prisma.webSession.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(replaceWebSessionAfterPasswordChange(input))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("fails closed and clears cookies when replacement creation fails", async () => {
    state.cookies.set("clean_pay_access", "old-access");
    state.cookies.set("clean_pay_refresh", "old-refresh");
    mocks.prisma.$transaction.mockRejectedValueOnce(
      new Error("replacement insert failed"),
    );

    await expect(
      replaceWebSessionAfterPasswordChange({
        sessionId: "session-1",
        userId: "user-1",
        remnashopAccessTokenEncrypted: "new-remna-access",
        remnashopRefreshTokenEncrypted: "new-remna-refresh",
        remnashopAccessExpiresAt: new Date("2099-01-02T00:00:00.000Z"),
        remnashopRefreshExpiresAt: new Date("2099-02-02T00:00:00.000Z"),
      }),
    ).rejects.toThrow("replacement insert failed");

    expect(mocks.prisma.webSession.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
      }),
    });
    expect(state.deleteCalls).toEqual([
      "clean_pay_access",
      "clean_pay_refresh",
    ]);
  });

  it("upgrades partial sessions and clears only the current session by access or refresh token", async () => {
    state.cookies.set(
      "clean_pay_access",
      accessToken({ sid: "session-1", uid: "user-1", exp: Math.floor(Date.now() / 1000) + 60 }),
    );
    mocks.prisma.webSession.findFirst.mockResolvedValue({ ...session, assuranceLevel: "PARTIAL" });
    mocks.prisma.webSession.update.mockResolvedValue({ ...session, assuranceLevel: "FULL" });

    await expect(upgradeCurrentSessionToFull()).resolves.toMatchObject({ assuranceLevel: "FULL" });

    await clearWebSession();
    expect(mocks.prisma.webSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        userId: "user-1",
        revokedAt: null,
      },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
      }),
    });
    expect(state.deleteCalls).toEqual(["clean_pay_access", "clean_pay_refresh"]);

    state.cookies.set("clean_pay_refresh", "refresh-only");
    mocks.prisma.webSession.findFirst.mockResolvedValueOnce({ id: "refresh-session" });
    await clearWebSession();
    expect(mocks.prisma.webSession.updateMany).toHaveBeenLastCalledWith({
      where: { id: "refresh-session", revokedAt: null },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
      }),
    });
    expect(mocks.prisma.webSession.findFirst).toHaveBeenLastCalledWith({
      where: {
        revokedAt: null,
        OR: [
          { refreshTokenHash: sha256("refresh-only") },
          {
            refreshTokenHistory: {
              some: {
                tokenHash: sha256("refresh-only"),
                graceExpiresAt: { gte: expect.any(Date) },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
  });

  it("always deletes browser cookies when database revocation fails", async () => {
    state.cookies.set(
      "clean_pay_access",
      accessToken({ sid: "session-1", uid: "user-1", exp: Math.floor(Date.now() / 1000) + 60 }),
    );
    state.cookies.set("clean_pay_refresh", "refresh-token");
    mocks.prisma.webSession.findFirst.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(clearWebSession()).rejects.toThrow("database unavailable");

    expect(state.cookies.size).toBe(0);
    expect(state.deleteCalls).toEqual(["clean_pay_access", "clean_pay_refresh"]);
  });

  it("reads the logout audit subject only from a valid signed access cookie", async () => {
    state.cookies.set(
      "clean_pay_access",
      accessToken({ sid: "session-1", uid: "user-1", exp: Math.floor(Date.now() / 1000) + 60 }),
    );
    await expect(getWebSessionUserIdFromAccessCookie()).resolves.toBe("user-1");

    state.cookies.set("clean_pay_access", "untrusted.invalid");
    await expect(getWebSessionUserIdFromAccessCookie()).resolves.toBeNull();
  });

  it("does not let a revoked or mismatched access token revoke replacement sessions", async () => {
    state.cookies.set(
      "clean_pay_access",
      accessToken({
        sid: "revoked-session-1",
        uid: "user-1",
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    );
    mocks.prisma.webSession.findFirst.mockResolvedValueOnce(null);

    await clearWebSession();

    expect(mocks.prisma.webSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: "revoked-session-1",
        userId: "user-1",
        revokedAt: null,
        accessTokenExpiresAt: { gt: expect.any(Date) },
      },
      select: { id: true, userId: true },
    });
    expect(mocks.prisma.webSession.updateMany).not.toHaveBeenCalled();

    vi.clearAllMocks();
    state.cookies.set(
      "clean_pay_access",
      accessToken({
        sid: "session-2",
        uid: "wrong-user",
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    );
    mocks.prisma.webSession.findFirst.mockResolvedValueOnce(null);

    await clearWebSession();

    expect(mocks.prisma.webSession.updateMany).not.toHaveBeenCalled();
  });
});
