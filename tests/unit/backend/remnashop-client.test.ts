import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const lifecycleMock = vi.hoisted(() => ({
  acquireRemnashopTokensForSession: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  webSession: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  webUser: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const userMergeMock = vi.hoisted(() => ({
  assertUserMergeFinalOwner: vi.fn(),
  mergeLocalUsersIntoTarget: vi.fn(),
}));

const paymentMergeMock = vi.hoisted(() => ({
  preflightPaymentOperationsForUserMerge: vi.fn(),
  transferPaymentOperationsForUserMerge: vi.fn(),
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: loggerMock,
}));

vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/backend/auth/user-merge", () => userMergeMock);

vi.mock("@/backend/payments/user-merge", () => paymentMergeMock);

vi.mock("@/backend/sessions/web-session", () => ({
  getCurrentSession: vi.fn(),
  refreshCurrentAccessCookie: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/session-token-lifecycle", () => ({
  acquireRemnashopTokensForSession:
    lifecycleMock.acquireRemnashopTokensForSession,
}));

import {
  getJwtExpiresAt,
  getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken,
  protectRemnashopToken,
  revealRemnashopToken,
  remnashopAuth,
  remnashopAuthTelegramIdentity,
  remnashopAdminRequest,
  remnashopLinkTelegram,
  remnashopMergeUsers,
  remnashopRequest,
} from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { decryptSecret } from "@/backend/security/crypto";
import { getCurrentSession, refreshCurrentAccessCookie } from "@/backend/sessions/web-session";
import { prisma } from "@/backend/database/prisma";

function jwt(payload: object) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function response({
  status = 200,
  body,
  setCookie = [],
}: {
  status?: number;
  body?: unknown;
  setCookie?: string[];
}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const result = new Response(text, {
    status,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(result.headers, "getSetCookie", {
    value: () => setCookie,
  });

  return result;
}

function hasLogKey(metadata: unknown, key: string) {
  return Boolean(metadata && typeof metadata === "object" && key in metadata);
}

function telegramAuthResponse({
  userId,
  accessToken,
  refreshToken = `refresh-${userId}`,
}: {
  userId: string;
  accessToken?: string;
  refreshToken?: string;
}) {
  const accessJwt = jwt({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const issuedAccessToken = accessToken ?? accessJwt;

  return response({
    body: {
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      refresh_expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    },
    setCookie: [
      `access_token=${issuedAccessToken}; Path=/; HttpOnly`,
      `refresh_token=${refreshToken}; Path=/; HttpOnly`,
    ],
  });
}

function remnashopProfile({
  email = "owner@example.com",
  emailVerified = true,
  telegramId = 123456,
}: {
  email?: string | null;
  emailVerified?: boolean;
  telegramId?: number | null;
} = {}) {
  return response({
    body: {
      email,
      is_email_verified: emailVerified,
      telegram_id: telegramId,
      auth_type: "telegram",
      pending_email: null,
      name: "Owner",
      username: "clean_user",
      language: "ru",
    },
  });
}

function telegramSession({
  remnashopUserId = "2",
  email = "owner@example.com",
  emailVerified = true,
}: {
  remnashopUserId?: string | null;
  email?: string | null;
  emailVerified?: boolean;
} = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    authMethod: "TELEGRAM",
    remnashopAccessTokenEncrypted: null,
    remnashopRefreshTokenEncrypted: null,
    remnashopAccessExpiresAt: null,
    remnashopRefreshExpiresAt: null,
    revokedAt: null,
    user: {
      id: "user-1",
      remnashopUserId,
      email,
      emailVerified,
      telegramId: "123456",
      telegramUsername: "clean_user",
    },
  };
}

function mergeResponse({
  sourceUserId = 1,
  targetUserId = 2,
  conflicts = [],
}: {
  sourceUserId?: number;
  targetUserId?: number;
  conflicts?: string[];
} = {}) {
  return response({
    body: {
      dry_run: false,
      source_user_id: sourceUserId,
      target_user_id: targetUserId,
      target: {
        id: targetUserId,
        email: "owner@example.com",
        telegram_id: 123456,
        is_email_verified: true,
        current_subscription_id: null,
      },
      moved: {},
      conflicts,
      requires_relogin: true,
    },
  });
}

describe("remnashop client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.webSession.findFirst.mockReset();
    prismaMock.webSession.update.mockReset();
    prismaMock.webSession.updateMany.mockReset();
    prismaMock.webUser.findUnique.mockReset();
    prismaMock.webUser.update.mockReset();
    userMergeMock.assertUserMergeFinalOwner.mockReset();
    userMergeMock.mergeLocalUsersIntoTarget.mockReset();
    paymentMergeMock.preflightPaymentOperationsForUserMerge.mockReset();
    paymentMergeMock.transferPaymentOperationsForUserMerge.mockReset();
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock),
    );
    prismaMock.webSession.findFirst.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      revokedAt: null,
      remnashopAccessTokenEncrypted: null,
      remnashopRefreshTokenEncrypted: null,
      remnashopAccessExpiresAt: null,
      remnashopRefreshExpiresAt: null,
    });
    prismaMock.webSession.updateMany.mockResolvedValue({ count: 1 });
    userMergeMock.assertUserMergeFinalOwner.mockResolvedValue(undefined);
    userMergeMock.mergeLocalUsersIntoTarget.mockResolvedValue({
      revokedSessionCount: 0,
      transferredPasskeyCount: 0,
      invalidatedWebAuthnChallengeCount: 0,
      invalidatedEmailCodeCount: 0,
      invalidatedTelegramStateCount: 0,
    });
    paymentMergeMock.preflightPaymentOperationsForUserMerge.mockResolvedValue({
      targetUpstreamAccountId: "1",
    });
    paymentMergeMock.transferPaymentOperationsForUserMerge.mockResolvedValue(
      undefined,
    );
    lifecycleMock.acquireRemnashopTokensForSession.mockReset();
    lifecycleMock.acquireRemnashopTokensForSession.mockImplementation(
      async ({ session }: { session: Record<string, unknown> }) => {
        const access = session.remnashopAccessTokenEncrypted;
        const refresh = session.remnashopRefreshTokenEncrypted;

        if (typeof access !== "string" || typeof refresh !== "string") {
          return null;
        }

        return {
          accessToken: revealRemnashopToken(access),
          refreshToken: revealRemnashopToken(refresh),
          session,
          source: "stored",
        };
      },
    );
  });

  afterEach(() => {
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends JSON requests to configured Remnashop API and parses responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ body: { plans: [] } }));

    await expect(remnashopRequest("/plans/public", { method: "POST", body: { active: true } })).resolves.toEqual({
      plans: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://remnashop:5000/api/v1/public/plans/public",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ active: true }),
        cache: "no-store",
        headers: expect.objectContaining({
          accept: "application/json",
          "content-type": "application/json",
        }),
      }),
    );
  });

  it("links Telegram to the authenticated Remnashop email account", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        body: {
          telegram_id: 123456,
          auth_type: "email",
          email: "u@e.test",
          is_email_verified: true,
          pending_email: null,
          name: "User",
          username: "clean_user",
          language: "ru",
        },
      }),
    );

    await expect(
      remnashopLinkTelegram({
        accessToken: "access.jwt",
        telegramId: "123456",
        telegramUsername: "clean_user",
      }),
    ).resolves.toMatchObject({ telegram_id: 123456 });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(fetchMock).toHaveBeenCalledWith(
      "http://remnashop:5000/api/v1/public/auth/telegram/link",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          cookie: "access_token=access.jwt",
        }),
      }),
    );
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      id: 123456,
      first_name: "clean_user",
      username: "clean_user",
      hash: expect.any(String),
    });
  });

  it("merges Remnashop users through the admin API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        body: {
          dry_run: false,
          source_user_id: 18367,
          target_user_id: 1,
          target: {
            id: 1,
            email: "flake92@live.com",
            telegram_id: 7295815705,
            is_email_verified: true,
            current_subscription_id: 9738,
          },
          moved: { subscriptions: 0 },
          conflicts: [],
          requires_relogin: true,
        },
      }),
    );

    await expect(remnashopMergeUsers({
      sourceUserId: "18367",
      targetUserId: "1",
      reason: "test merge",
    })).resolves.toMatchObject({
      source_user_id: 18367,
      target_user_id: 1,
      conflicts: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://remnashop:5000/api/v1/admin/users/merge?dry_run=false",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          source_user_id: 18367,
          target_user_id: 1,
          reason: "test merge",
        }),
        headers: expect.objectContaining({
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": "test-remnashop-api-key",
        }),
      }),
    );
  });

  it("authenticates in Remnashop with the current Telegram identity", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        body: {
          expires_at: "2026-06-25T10:00:00.000Z",
          refresh_expires_at: "2026-07-25T10:00:00.000Z",
        },
        setCookie: ["access_token=access.jwt; Path=/; HttpOnly", "refresh_token=refresh.jwt; Path=/; HttpOnly"],
      }),
    );

    await expect(remnashopAuthTelegramIdentity({
      telegramId: "7295815705",
      telegramUsername: "clean_pay_support",
    })).resolves.toMatchObject({ cookies: { accessToken: "access.jwt" } });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(fetchMock).toHaveBeenCalledWith(
      "http://remnashop:5000/api/v1/public/auth/telegram",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      id: 7295815705,
      first_name: "clean_pay_support",
      username: "clean_pay_support",
      hash: expect.any(String),
    });
  });

  it("passes Remnashop auth cookies when tokens are provided", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ body: { ok: true } }));

    await remnashopRequest("/subscription/current", {
      accessToken: "access",
      refreshToken: "refresh",
    });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      cookie: "access_token=access; refresh_token=refresh",
    });
  });

  it("passes a stable payment idempotency key without logging it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ body: { ok: true } }));

    await remnashopRequest("/subscription/purchase", {
      method: "POST",
      body: { plan_code: "basic" },
      idempotencyKey: "server-operation-key",
    });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "idempotency-key": "server-operation-key",
    });
    expect(JSON.stringify(loggerMock.info.mock.calls)).not.toContain("server-operation-key");
  });

  it("removes query identities from admin errors and logs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({ status: 400, body: { detail: "invalid request" } }),
    );

    await expect(
      remnashopAdminRequest(
        "/payment-operations/PURCHASE?user_id=sensitive-user",
        {
          idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          timeoutMs: 1_000,
        },
      ),
    ).rejects.toMatchObject({
      debug: {
        upstreamPath: "/payment-operations/PURCHASE",
      },
    });
    expect(JSON.stringify(loggerMock.info.mock.calls)).not.toContain(
      "sensitive-user",
    );
  });

  it("fails closed on admin requests when the explicit admin base URL is absent", async () => {
    vi.stubEnv("REMNASHOP_ADMIN_API_BASE_URL", "");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      remnashopAdminRequest("/payment-operations/PURCHASE"),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not log Remnashop request or response payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      body: { email: "user@example.com", access_token: "response-token" },
      setCookie: ["access_token=response-token; Path=/"],
    }));

    await remnashopRequest("/subscription/purchase", {
      method: "POST",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      body: {
        email: "user@example.com",
        password: "secret",
        plan_code: "premium",
      },
    });

    const logMetadata = loggerMock.info.mock.calls.map(([, metadata]) => metadata);

    expect(logMetadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "POST", path: "/subscription/purchase", hasBody: true }),
        expect.objectContaining({ method: "POST", path: "/subscription/purchase", status: 200, ok: true }),
      ]),
    );
    expect(JSON.stringify(logMetadata)).not.toContain("access-token");
    expect(JSON.stringify(logMetadata)).not.toContain("refresh-token");
    expect(JSON.stringify(logMetadata)).not.toContain("response-token");
    expect(JSON.stringify(logMetadata)).not.toContain("user@example.com");
    expect(JSON.stringify(logMetadata)).not.toContain("secret");
    expect(logMetadata.some((metadata) => hasLogKey(metadata, "headers"))).toBe(false);
    expect(logMetadata.some((metadata) => hasLogKey(metadata, "body"))).toBe(false);
    expect(logMetadata.some((metadata) => hasLogKey(metadata, "url"))).toBe(false);
  });

  it("extracts auth cookies from login/register responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        body: {
          expires_at: "2026-06-25T10:00:00.000Z",
          refresh_expires_at: "2026-07-25T10:00:00.000Z",
        },
        setCookie: ["access_token=access.jwt; Path=/; HttpOnly", "refresh_token=refresh.jwt; Path=/; HttpOnly"],
      }),
    );

    await expect(remnashopAuth("/auth/login", { email: "u@e.test", password: "secret" })).resolves.toEqual({
      data: {
        expires_at: "2026-06-25T10:00:00.000Z",
        refresh_expires_at: "2026-07-25T10:00:00.000Z",
      },
      cookies: {
        accessToken: "access.jwt",
        refreshToken: "refresh.jwt",
      },
    });
  });

  it("turns invalid JSON and upstream errors into BFF errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("<html>", { status: 200 }));

    await expect(remnashopRequest("/plans/public")).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      status: 502,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ status: 401, body: { detail: "bad login" } }));
    await expect(remnashopAuth("/auth/login", { email: "u@e.test", password: "bad" })).rejects.toMatchObject({
      code: "AUTH_FAILED",
      status: 401,
    });

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    await expect(remnashopRequest("/plans/public")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 502,
    });
  });

  it("decodes jwt identity and expiry", () => {
    const token = jwt({ sub: 42, exp: 1_780_000_000 });

    expect(getRemnashopUserIdFromAccessToken(token)).toBe("42");
    expect(getJwtExpiresAt(token)?.toISOString()).toBe("2026-05-28T20:26:40.000Z");
    expect(() => getRemnashopUserIdFromAccessToken(jwt({}))).toThrow("does not contain sub");
  });

  it("protects Remnashop tokens with the web refresh secret", () => {
    const protectedToken = protectRemnashopToken("plain-token");

    expect(protectedToken).not.toBe("plain-token");
    expect(decryptSecret(protectedToken, process.env.WEB_REFRESH_SECRET ?? "test-web-refresh-secret")).toBe("plain-token");
  });

  it("authorizes stored Remnashop tokens and rejects missing session states", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);
    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      authMethod: "EMAIL",
      remnashopAccessTokenEncrypted: null,
      remnashopRefreshTokenEncrypted: null,
      user: { email: "user@example.com", emailVerified: true, telegramId: null },
    } as never);
    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({ code: "EMAIL_REQUIRED" });

    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      authMethod: "EMAIL",
      remnashopAccessTokenEncrypted: protectRemnashopToken("access"),
      remnashopRefreshTokenEncrypted: protectRemnashopToken("refresh"),
      remnashopAccessExpiresAt: new Date(Date.now() + 10 * 60_000),
      remnashopRefreshExpiresAt: new Date(Date.now() + 60 * 60_000),
      user: { email: "user@example.com", emailVerified: false, telegramId: null },
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({
      body: {
        email: "user@example.com",
        is_email_verified: false,
        telegram_id: null,
        auth_type: "email",
        pending_email: null,
        name: "User",
        username: null,
        language: "ru",
      },
    }));
    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });

    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      authMethod: "EMAIL",
      remnashopAccessTokenEncrypted: protectRemnashopToken("access"),
      remnashopRefreshTokenEncrypted: protectRemnashopToken("refresh"),
      remnashopAccessExpiresAt: new Date(Date.now() + 10 * 60_000),
      remnashopRefreshExpiresAt: new Date(Date.now() + 60 * 60_000),
      user: { email: "user@example.com", emailVerified: true, telegramId: "123456" },
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({
      body: {
        email: "other@example.com",
        is_email_verified: true,
        telegram_id: 123456,
        auth_type: "telegram",
        pending_email: null,
        name: "User",
        username: "clean_user",
        language: "ru",
      },
    }));
    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });

    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      authMethod: "EMAIL",
      remnashopAccessTokenEncrypted: protectRemnashopToken("access"),
      remnashopRefreshTokenEncrypted: protectRemnashopToken("refresh"),
      remnashopAccessExpiresAt: new Date(Date.now() + 10 * 60_000),
      remnashopRefreshExpiresAt: new Date(Date.now() + 60 * 60_000),
      user: { email: "user@example.com", emailVerified: false, telegramId: null },
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({
      body: {
        email: "user@example.com",
        is_email_verified: true,
        telegram_id: null,
        auth_type: "email",
        pending_email: null,
        name: "User",
        username: null,
        language: "ru",
      },
    }));

    await expect(getAuthorizedRemnashopTokens()).resolves.toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
      session: { id: "session-1" },
    });
    expect(prisma.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailVerified: true },
    });
    expect(refreshCurrentAccessCookie).toHaveBeenCalled();

    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      authMethod: "EMAIL",
      remnashopAccessTokenEncrypted: protectRemnashopToken("access"),
      remnashopRefreshTokenEncrypted: protectRemnashopToken("refresh"),
      remnashopAccessExpiresAt: new Date(Date.now() + 10 * 60_000),
      remnashopRefreshExpiresAt: new Date(Date.now() + 60 * 60_000),
      user: { email: "user@example.com", emailVerified: true, telegramId: null },
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({
      body: {
        email: "user@example.com",
        is_email_verified: true,
        telegram_id: null,
        auth_type: "email",
        pending_email: null,
        name: "User",
        username: null,
        language: "ru",
      },
    }));

    await expect(getAuthorizedRemnashopTokens()).resolves.toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
      session: { id: "session-1" },
    });
  });

  it("never stores Telegram recovery tokens when the verified owner differs", async () => {
    const session = telegramSession({ remnashopUserId: "1" });
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(
        remnashopProfile({
          email: "another-owner@example.com",
          emailVerified: true,
        }),
      );

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.webSession.updateMany).not.toHaveBeenCalled();
    expect(userMergeMock.mergeLocalUsersIntoTarget).not.toHaveBeenCalled();
  });

  it("rejects a Telegram profile that does not confirm the local Telegram ID", async () => {
    const session = telegramSession({ remnashopUserId: "2" });
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(remnashopProfile({ telegramId: 999999 }));

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.webSession.updateMany).not.toHaveBeenCalled();
  });

  it("reloads a bundle cleared by lifecycle before Telegram recovery", async () => {
    const cleanedSession = telegramSession({ remnashopUserId: "2" });
    const staleSession = {
      ...cleanedSession,
      remnashopAccessTokenEncrypted: "corrupt-access",
      remnashopRefreshTokenEncrypted: "corrupt-refresh",
      remnashopAccessExpiresAt: new Date(Date.now() - 60_000),
      remnashopRefreshExpiresAt: new Date(Date.now() - 30_000),
    };
    const currentUser = { ...cleanedSession.user };
    vi.mocked(getCurrentSession)
      .mockResolvedValueOnce(staleSession as never)
      .mockResolvedValue(cleanedSession as never);
    lifecycleMock.acquireRemnashopTokensForSession.mockResolvedValueOnce(null);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(currentUser);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    prismaMock.webUser.update.mockResolvedValue(currentUser);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(remnashopProfile());

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({
      session: {
        id: "session-1",
        user: { remnashopUserId: "2" },
      },
    });

    expect(getCurrentSession).toHaveBeenCalledTimes(2);
    expect(prismaMock.webSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "session-1" }),
      }),
    );
  });

  it("detects a conflicting local owner before dispatching an upstream merge", async () => {
    const session = telegramSession({ remnashopUserId: "1" });
    const sourceUser = {
      id: "source-user",
      remnashopUserId: "2",
      email: "another-owner@example.com",
      emailVerified: true,
      telegramId: null,
    };
    const currentUser = { ...session.user };
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(sourceUser)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(sourceUser);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "source-user" }, { id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(
        remnashopProfile({ email: null, emailVerified: false }),
      );

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.webSession.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a semantically inconsistent upstream merge response", async () => {
    const session = telegramSession({ remnashopUserId: "1" });
    const currentUser = { ...session.user };
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(null);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(
        remnashopProfile({ email: null, emailVerified: false }),
      )
      .mockResolvedValueOnce(mergeResponse({ targetUserId: 3 }));

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(prismaMock.webSession.updateMany).not.toHaveBeenCalled();
  });

  it("blocks a deterministic payment collision before the upstream merge", async () => {
    const session = telegramSession({ remnashopUserId: "1" });
    const currentUser = { ...session.user };
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(null);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    paymentMergeMock.preflightPaymentOperationsForUserMerge.mockRejectedValueOnce(
      new BffError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "Payment operation keys conflict during account merge",
      ),
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(
        remnashopProfile({ email: null, emailVerified: false }),
      );

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED", status: 409 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(paymentMergeMock.preflightPaymentOperationsForUserMerge).toHaveBeenCalledWith(
      prismaMock,
      "user-1",
      [],
    );
    expect(paymentMergeMock.transferPaymentOperationsForUserMerge).not.toHaveBeenCalled();
    expect(prismaMock.webSession.updateMany).not.toHaveBeenCalled();
  });

  it("persists direct-owner Telegram tokens only after /auth/me verification", async () => {
    const session = telegramSession({ remnashopUserId: "2" });
    const accessToken = jwt({ sub: "2", exp: 1_900_000_000 });
    const refreshToken = "verified-refresh-2";
    const currentUser = {
      ...session.user,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(currentUser);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    prismaMock.webUser.update.mockResolvedValue(currentUser);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        telegramAuthResponse({ userId: "2", accessToken, refreshToken }),
      )
      .mockResolvedValueOnce(remnashopProfile());

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({
      accessToken,
      refreshToken,
      session: {
        id: "session-1",
        user: { remnashopUserId: "2", email: "owner@example.com" },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://remnashop:5000/api/v1/public/auth/me",
    );
    expect(
      fetchMock.mock.invocationCallOrder[1] ?? Number.MAX_SAFE_INTEGER,
    ).toBeLessThan(
      prismaMock.webSession.updateMany.mock.invocationCallOrder[0] ?? 0,
    );
    const storedTokens = prismaMock.webSession.updateMany.mock.calls[0]?.[0]
      ?.data;
    expect(revealRemnashopToken(storedTokens.remnashopAccessTokenEncrypted)).toBe(
      accessToken,
    );
    expect(
      revealRemnashopToken(storedTokens.remnashopRefreshTokenEncrypted),
    ).toBe(refreshToken);
    expect(userMergeMock.mergeLocalUsersIntoTarget).not.toHaveBeenCalled();
  });

  it("returns only reauthenticated tokens after a coordinated upstream merge", async () => {
    const session = telegramSession({ remnashopUserId: "1" });
    const preMergeAccess = jwt({ sub: "2", exp: 1_900_000_000 });
    const postMergeAccess = jwt({ sub: "2", exp: 1_900_000_100 });
    const currentUser = {
      ...session.user,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(null);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    prismaMock.webUser.update.mockResolvedValue({
      ...currentUser,
      remnashopUserId: "2",
    });
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        telegramAuthResponse({
          userId: "2",
          accessToken: preMergeAccess,
          refreshToken: "pre-merge-refresh",
        }),
      )
      .mockResolvedValueOnce(
        remnashopProfile({ email: null, emailVerified: false }),
      )
      .mockResolvedValueOnce(
        response({
          body: {
            dry_run: false,
            source_user_id: 1,
            target_user_id: 2,
            target: {
              id: 2,
              email: "owner@example.com",
              telegram_id: 123456,
              is_email_verified: true,
              current_subscription_id: null,
            },
            moved: {},
            conflicts: [],
            requires_relogin: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        telegramAuthResponse({
          userId: "2",
          accessToken: postMergeAccess,
          refreshToken: "post-merge-refresh",
        }),
      )
      .mockResolvedValueOnce(remnashopProfile());

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({
      accessToken: postMergeAccess,
      refreshToken: "post-merge-refresh",
      session: { user: { remnashopUserId: "2" } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const [mergeUrl, mergeInit] = fetchMock.mock.calls[2] ?? [];
    expect(mergeUrl).toBe(
      "http://remnashop:5000/api/v1/admin/users/merge?dry_run=false",
    );
    expect(JSON.parse(String((mergeInit as RequestInit).body))).toMatchObject({
      source_user_id: 1,
      target_user_id: 2,
    });
    expect(
      prismaMock.$transaction.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
    ).toBeLessThan(fetchMock.mock.invocationCallOrder[2] ?? 0);
    expect(
      paymentMergeMock.preflightPaymentOperationsForUserMerge.mock
        .invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    ).toBeLessThan(fetchMock.mock.invocationCallOrder[2] ?? 0);
    expect(
      fetchMock.mock.invocationCallOrder[4] ?? Number.MAX_SAFE_INTEGER,
    ).toBeLessThan(
      prismaMock.webSession.updateMany.mock.invocationCallOrder[0] ?? 0,
    );
    expect(paymentMergeMock.transferPaymentOperationsForUserMerge).toHaveBeenCalledWith(
      prismaMock,
      "user-1",
      "2",
      [],
    );
    const timeoutBudgets = timeoutSpy.mock.calls.map(([timeoutMs]) => timeoutMs);
    expect(timeoutBudgets.slice(0, 2)).toEqual([15_000, 15_000]);
    expect(timeoutBudgets.slice(2)).toHaveLength(3);
    expect(
      timeoutBudgets.slice(2).every(
        (timeoutMs) => timeoutMs > 0 && timeoutMs <= 8_000,
      ),
    ).toBe(true);
    expect(prismaMock.$transaction.mock.calls[0]?.[1]).toEqual({
      maxWait: 5_000,
      timeout: 30_000,
    });
    const storedTokens = prismaMock.webSession.updateMany.mock.calls[0]?.[0]
      ?.data;
    expect(revealRemnashopToken(storedTokens.remnashopAccessTokenEncrypted)).toBe(
      postMergeAccess,
    );
    expect(
      revealRemnashopToken(storedTokens.remnashopRefreshTokenEncrypted),
    ).toBe("post-merge-refresh");
  });

  it("clears invalidated Remnashop bundles from every other active session", async () => {
    const session = telegramSession({ remnashopUserId: "1" });
    const currentUser = { ...session.user };
    const postMergeAccess = jwt({ sub: "2", exp: 1_900_000_100 });
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(null);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }, { id: "session-2" }]);
    prismaMock.webUser.update.mockResolvedValue({
      ...currentUser,
      remnashopUserId: "2",
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(
        remnashopProfile({ email: null, emailVerified: false }),
      )
      .mockResolvedValueOnce(mergeResponse())
      .mockResolvedValueOnce(
        telegramAuthResponse({
          userId: "2",
          accessToken: postMergeAccess,
          refreshToken: "post-merge-refresh",
        }),
      )
      .mockResolvedValueOnce(remnashopProfile());

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({ accessToken: postMergeAccess });

    expect(prismaMock.webSession.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        userId: "user-1",
        id: { not: "session-1" },
        revokedAt: null,
      },
      data: {
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
        remnashopAccessExpiresAt: null,
        remnashopRefreshExpiresAt: null,
      },
    });
    expect(prismaMock.webSession.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: "session-1" }),
      }),
    );
  });

  it("retries the same upstream merge after a local commit failure", async () => {
    const session = telegramSession({ remnashopUserId: "1" });
    const currentUser = { ...session.user };
    const firstPostMergeAccess = jwt({ sub: "2", exp: 1_900_000_100 });
    const retryPostMergeAccess = jwt({ sub: "2", exp: 1_900_000_200 });
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(null);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }])
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    prismaMock.webUser.update
      .mockRejectedValueOnce(new Error("database write failed"))
      .mockResolvedValueOnce({ ...currentUser, remnashopUserId: "2" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(
        remnashopProfile({ email: null, emailVerified: false }),
      )
      .mockResolvedValueOnce(mergeResponse())
      .mockResolvedValueOnce(
        telegramAuthResponse({
          userId: "2",
          accessToken: firstPostMergeAccess,
          refreshToken: "first-post-merge-refresh",
        }),
      )
      .mockResolvedValueOnce(remnashopProfile())
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(remnashopProfile())
      .mockResolvedValueOnce(mergeResponse())
      .mockResolvedValueOnce(
        telegramAuthResponse({
          userId: "2",
          accessToken: retryPostMergeAccess,
          refreshToken: "retry-post-merge-refresh",
        }),
      )
      .mockResolvedValueOnce(remnashopProfile());

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).rejects.toThrow("database write failed");
    expect(prismaMock.webSession.updateMany).not.toHaveBeenCalled();

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({
      accessToken: retryPostMergeAccess,
      refreshToken: "retry-post-merge-refresh",
    });

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/users/merge");
    expect(fetchMock.mock.calls[7]?.[0]).toContain("/users/merge");
    expect(prismaMock.webSession.updateMany).toHaveBeenCalledTimes(1);
  });

  it("merges a compatible local owner before claiming its Remnashop identity", async () => {
    const session = telegramSession({ remnashopUserId: null });
    const accessToken = jwt({ sub: "2", exp: 1_900_000_000 });
    const sourceUser = {
      id: "source-user",
      remnashopUserId: "2",
      email: "owner@example.com",
      emailVerified: true,
      telegramId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const currentUser = {
      ...session.user,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(sourceUser)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(sourceUser);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "source-user" }, { id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    prismaMock.webUser.update.mockResolvedValue({
      ...currentUser,
      remnashopUserId: "2",
    });
    paymentMergeMock.preflightPaymentOperationsForUserMerge.mockResolvedValueOnce({
      targetUpstreamAccountId: null,
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        telegramAuthResponse({
          userId: "2",
          accessToken,
          refreshToken: "refresh-2",
        }),
      )
      .mockResolvedValueOnce(remnashopProfile());

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({
      accessToken,
      session: { user: { remnashopUserId: "2" } },
    });

    expect(userMergeMock.mergeLocalUsersIntoTarget).toHaveBeenCalledWith(
      prismaMock,
      {
        targetUserId: "user-1",
        targetUpstreamAccountId: "2",
        sourceUserIds: ["source-user"],
      },
    );
    expect(userMergeMock.assertUserMergeFinalOwner).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        targetUserId: "user-1",
        sourceUserIds: ["source-user"],
        expected: expect.objectContaining({
          remnashopUserId: "2",
          email: "owner@example.com",
          telegramId: "123456",
        }),
      }),
    );
  });

  it("uses lifecycle-refreshed tokens before requesting /auth/me", async () => {
    const expiredSession = {
      id: "session-1",
      userId: "user-1",
      authMethod: "EMAIL",
      remnashopAccessTokenEncrypted: protectRemnashopToken("old-access"),
      remnashopRefreshTokenEncrypted: protectRemnashopToken("old-refresh"),
      remnashopAccessExpiresAt: new Date(Date.now() - 1_000),
      remnashopRefreshExpiresAt: new Date(Date.now() + 60 * 60_000),
      user: { email: "user@example.com", emailVerified: true, telegramId: null },
    };
    vi.mocked(getCurrentSession).mockResolvedValueOnce(expiredSession as never);
    lifecycleMock.acquireRemnashopTokensForSession.mockResolvedValueOnce({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      session: {
        ...expiredSession,
        remnashopAccessTokenEncrypted: protectRemnashopToken("new-access"),
        remnashopRefreshTokenEncrypted: protectRemnashopToken("new-refresh"),
        remnashopAccessExpiresAt: new Date("2026-06-25T10:00:00.000Z"),
        remnashopRefreshExpiresAt: new Date("2026-07-25T10:00:00.000Z"),
      },
      source: "refresh",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response({
        body: {
          email: "user@example.com",
          is_email_verified: true,
          telegram_id: null,
          auth_type: "email",
          pending_email: null,
          name: "User",
          username: null,
          language: "ru",
        },
      }),
    );

    await expect(getAuthorizedRemnashopTokens()).resolves.toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });

    expect(lifecycleMock.acquireRemnashopTokensForSession).toHaveBeenCalledWith({
      session: expiredSession,
      refresh: expect.any(Function),
    });
    expect(
      lifecycleMock.acquireRemnashopTokensForSession.mock.invocationCallOrder[0],
    ).toBeLessThan(fetchMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
  });
});
