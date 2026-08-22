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
    deleteMany: vi.fn(),
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
  assertNoActivePaymentDispatches: vi.fn(),
  assertPaymentOwnerChangeFenceHeld: vi.fn(),
  lockPaymentOwnerFence: vi.fn(),
  markPaymentOwnerChangeUpstreamMutationStarted: vi.fn(),
  markPaymentOwnerChangeLocalFinalized: vi.fn(),
  preflightPaymentOperationsForUserMerge: vi.fn(),
  transferPaymentOperationsForUserMerge: vi.fn(),
  withPaymentOwnerChangeFence: vi.fn(),
}));

const sessionPolicyMock = vi.hoisted(() => ({
  assertEmailVerificationPolicy: vi.fn(),
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: loggerMock,
}));

vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/backend/integrations/auth/local-user-merge-service", () => userMergeMock);

vi.mock("@/backend/integrations/payments/payment-user-merge-service", () => paymentMergeMock);

vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  assertEmailVerificationPolicy: sessionPolicyMock.assertEmailVerificationPolicy,
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
  remnashopChangePassword,
  remnashopAdminRequestResult,
  remnashopLinkTelegram,
  remnashopIdentifyEmail,
  remnashopMergeUsers,
  remnashopRefreshTokens,
  remnashopRequest,
  remnashopRequestPasswordReset,
  remnashopRequestResult,
  recoverRemnashopTelegramSession,
} from "@/backend/integrations/remnashop/client";
import { ServiceError } from "@/backend/errors/service-error";
import { decryptSecret } from "@/backend/security/crypto";
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";

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
  authPending = false,
  pendingRemnashopUserId = null,
  pendingRemnashopEmail = null,
}: {
  remnashopUserId?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  authPending?: boolean;
  pendingRemnashopUserId?: string | null;
  pendingRemnashopEmail?: string | null;
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
      authPending,
      pendingRemnashopUserId,
      pendingRemnashopEmail,
      telegramId: "123456",
      telegramUsername: "clean_user",
    },
  };
}

function emailSession({
  remnashopUserId = "1",
  emailVerified = true,
  telegramId = null,
  withTokens = false,
}: {
  remnashopUserId?: string | null;
  emailVerified?: boolean;
  telegramId?: string | null;
  withTokens?: boolean;
} = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    authMethod: "EMAIL",
    assuranceLevel: "FULL",
    remnashopAccessTokenEncrypted: withTokens
      ? protectRemnashopToken("access")
      : null,
    remnashopRefreshTokenEncrypted: withTokens
      ? protectRemnashopToken("refresh")
      : null,
    remnashopAccessExpiresAt: withTokens
      ? new Date(Date.now() + 10 * 60_000)
      : null,
    remnashopRefreshExpiresAt: withTokens
      ? new Date(Date.now() + 60 * 60_000)
      : null,
    revokedAt: null,
    user: {
      id: "user-1",
      remnashopUserId,
      email: "user@example.com",
      emailVerified,
      authPending: false,
      pendingRemnashopUserId: null,
      pendingRemnashopEmail: null,
      telegramId,
      telegramUsername: null,
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
    prismaMock.webSession.deleteMany.mockReset();
    prismaMock.webSession.update.mockReset();
    prismaMock.webSession.updateMany.mockReset();
    prismaMock.webUser.findUnique.mockReset();
    prismaMock.webUser.update.mockReset();
    userMergeMock.assertUserMergeFinalOwner.mockReset();
    userMergeMock.mergeLocalUsersIntoTarget.mockReset();
    paymentMergeMock.preflightPaymentOperationsForUserMerge.mockReset();
    paymentMergeMock.transferPaymentOperationsForUserMerge.mockReset();
    paymentMergeMock.assertNoActivePaymentDispatches.mockReset();
    paymentMergeMock.assertPaymentOwnerChangeFenceHeld.mockReset();
    paymentMergeMock.lockPaymentOwnerFence.mockReset();
    paymentMergeMock.markPaymentOwnerChangeUpstreamMutationStarted.mockReset();
    paymentMergeMock.markPaymentOwnerChangeLocalFinalized.mockReset();
    paymentMergeMock.withPaymentOwnerChangeFence.mockReset();
    sessionPolicyMock.assertEmailVerificationPolicy.mockReset();
    sessionPolicyMock.assertEmailVerificationPolicy.mockImplementation(
      (user: { emailVerified: boolean; telegramId: string | null }) => {
        if (!user.emailVerified && !user.telegramId) {
          throw new ServiceError("EMAIL_NOT_VERIFIED", 403);
        }
      },
    );
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
    prismaMock.webSession.deleteMany.mockResolvedValue({ count: 1 });
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
    paymentMergeMock.assertNoActivePaymentDispatches.mockResolvedValue(undefined);
    paymentMergeMock.assertPaymentOwnerChangeFenceHeld.mockResolvedValue(undefined);
    paymentMergeMock.lockPaymentOwnerFence.mockImplementation(
      async (_tx: unknown, userIds: string[]) => userIds,
    );
    paymentMergeMock.markPaymentOwnerChangeUpstreamMutationStarted.mockResolvedValue(
      undefined,
    );
    paymentMergeMock.withPaymentOwnerChangeFence.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => work(),
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

  it("supports password reset, token refresh and password change endpoints", async () => {
    const authBody = {
      expires_at: "2026-08-10T12:00:00.000Z",
      refresh_expires_at: "2026-09-10T12:00:00.000Z",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ body: { success: true } }))
      .mockResolvedValueOnce(response({
        body: authBody,
        setCookie: ["access_token=new-access; Path=/", "refresh_token=new-refresh; Path=/"],
      }))
      .mockResolvedValueOnce(response({
        body: { success: true },
        setCookie: ["access_token=changed-access; Path=/", "refresh_token=changed-refresh; Path=/"],
      }));

    await expect(remnashopRequestPasswordReset({ email: "user@example.com" }))
      .resolves.toEqual({ success: true });
    await expect(remnashopRefreshTokens("old-refresh")).resolves.toMatchObject({
      data: authBody,
      cookies: { accessToken: "new-access", refreshToken: "new-refresh" },
    });
    await expect(remnashopChangePassword("new-access", {
      current_password: "old-password",
      new_password: "new-password",
    })).resolves.toMatchObject({
      cookies: { accessToken: "changed-access", refreshToken: "changed-refresh" },
    });

    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      cookie: "refresh_token=old-refresh",
    });
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      cookie: "access_token=new-access",
      "content-type": "application/json",
    });
  });

  it("returns null for explicitly allowed public and admin 404 responses", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));

    await expect(remnashopRequestResult("/missing", { allowNotFound: true }))
      .resolves.toEqual({ status: 404, data: null });
    await expect(remnashopAdminRequestResult("/missing", { allowNotFound: true }))
      .resolves.toEqual({ status: 404, data: null });
  });

  it("extracts cookies through the single set-cookie fallback and rejects incomplete auth cookies", async () => {
    const fallback = new Response(JSON.stringify({ expires_at: "now", refresh_expires_at: "later" }), {
      headers: {
        "content-type": "application/json",
        "set-cookie": "access_token=access-only; Path=/",
      },
    });
    Object.defineProperty(fallback.headers, "getSetCookie", { value: undefined });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fallback);

    await expect(remnashopAuth("/auth/login", {
      email: "user@example.com",
      password: "password",
    })).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 502 });
  });

  it("fails before dispatch when required Remnashop credentials are absent", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    await expect(remnashopAuthTelegramIdentity({ telegramId: "42" }))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    await expect(remnashopLinkTelegram({ accessToken: "access", telegramId: "42" }))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    vi.stubEnv("REMNASHOP_API_KEY", "");
    await expect(remnashopMergeUsers({
      sourceUserId: "1",
      targetUserId: "2",
      reason: "missing key",
    })).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    await expect(remnashopAdminRequestResult("/users"))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("normalizes failed admin transport calls without leaking the query", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("admin network down"));

    await expect(remnashopAdminRequestResult("/users?email=secret@example.com"))
      .rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        debug: { upstreamPath: "/users" },
      });
    expect(loggerMock.error).toHaveBeenCalledWith(
      "remnashop_admin_request_failed",
      expect.objectContaining({ path: "/users" }),
      expect.objectContaining({ category: "upstream" }),
    );
  });

  it("identifies an e-mail through the protected upstream auth boundary", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ body: { exists: true } }));

    await expect(remnashopIdentifyEmail({ email: "user@example.com" })).resolves.toEqual({ exists: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://remnashop:5000/api/v1/public/auth/identify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@example.com" }),
        headers: expect.objectContaining({
          "x-remnashop-auth-service-key": "auth-service-unit-7Vr3Nm8Wp2Kq5Xs9Lc4D",
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
          "x-remnashop-auth-service-key": "auth-service-unit-7Vr3Nm8Wp2Kq5Xs9Lc4D",
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

  it("derives the admin API URL before merging Remnashop users", async () => {
    vi.stubEnv("REMNASHOP_ADMIN_API_BASE_URL", "");
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
          email_resolution: "REJECT",
          telegram_resolution: "REJECT",
          payment_resolution: "REJECT",
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
      remnashopAdminRequestResult(
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

  it("uses the derived admin base when the explicit admin URL is absent", async () => {
    vi.stubEnv("REMNASHOP_ADMIN_API_BASE_URL", "");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({ body: { state: "IN_PROGRESS" } }),
    );

    await expect(
      remnashopAdminRequestResult("/payment-operations/PURCHASE"),
    ).resolves.toEqual({ status: 200, data: { state: "IN_PROGRESS" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://remnashop:5000/api/v1/admin/payment-operations/PURCHASE",
      expect.any(Object),
    );
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

  it("turns invalid JSON and upstream errors into service errors", async () => {
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

  it("rejects oversized upstream response bodies before buffering them", async () => {
    const oversized = JSON.stringify({ payload: "x".repeat(2 * 1024 * 1024) });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(oversized, { status: 200 }),
    );

    await expect(remnashopRequest("/plans/public")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 502,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(3 * 1024 * 1024) },
      }),
    );
    await expect(remnashopRequest("/plans/public")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 502,
    });
  });

  it("accepts an empty successful upstream response without buffering", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );

    await expect(remnashopRequest("/plans/public")).resolves.toBeNull();
  });

  it("decodes jwt identity and expiry", () => {
    const token = jwt({ sub: 42, exp: 1_780_000_000 });

    expect(getRemnashopUserIdFromAccessToken(token)).toBe("42");
    expect(getJwtExpiresAt(token)?.toISOString()).toBe("2026-05-28T20:26:40.000Z");
    expect(getJwtExpiresAt(jwt({ sub: 42 }))).toBeNull();
    expect(() => getRemnashopUserIdFromAccessToken("invalid-token"))
      .toThrow("Invalid JWT payload");
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

    const verifiedPasskeySession = {
      id: "session-1",
      userId: "user-1",
      authMethod: "PASSKEY",
      assuranceLevel: "FULL",
      remnashopAccessTokenEncrypted: null,
      remnashopRefreshTokenEncrypted: null,
      user: {
        email: "user@example.com",
        emailVerified: true,
        telegramId: null,
        remnashopUserId: "1",
      },
    } as never;
    vi.mocked(getCurrentSession)
      .mockResolvedValueOnce(verifiedPasskeySession)
      .mockResolvedValueOnce(verifiedPasskeySession);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "1" }))
      .mockResolvedValueOnce(response({
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
      }))
      .mockResolvedValueOnce(response({
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
      accessToken: expect.any(String),
      session: { id: "session-1", remnashopAccessTokenEncrypted: expect.any(String) },
    });
    expect(prismaMock.webSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "session-1", userId: "user-1", revokedAt: null },
    }));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "http://remnashop:5000/api/v1/public/auth/service-session",
      expect.objectContaining({
        body: JSON.stringify({ email: "user@example.com", user_id: "1" }),
      }),
    );

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
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockClear();
    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(fetchSpy).not.toHaveBeenCalled();

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

  it("blocks BOOTSTRAP sessions before token refresh or recovery", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      ...telegramSession(),
      assuranceLevel: "BOOTSTRAP",
      remnashopAccessTokenEncrypted: protectRemnashopToken("access"),
      remnashopRefreshTokenEncrypted: protectRemnashopToken("refresh"),
      remnashopAccessExpiresAt: new Date(Date.now() - 1_000),
      remnashopRefreshExpiresAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({
      code: "PASSKEY_REQUIRED",
      status: 403,
    });
    expect(lifecycleMock.acquireRemnashopTokensForSession).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects recovery for a missing or non-recoverable callback session", async () => {
    prismaMock.webSession.findFirst.mockResolvedValueOnce(null);
    await expect(
      recoverRemnashopTelegramSession("missing-session", "user-1"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    prismaMock.webSession.findFirst.mockResolvedValueOnce(telegramSession());
    await expect(
      recoverRemnashopTelegramSession("session-1", "user-1"),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 503 });
    expect(prismaMock.webSession.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects an automatic e-mail restore that resolves to another upstream owner", async () => {
    const session = emailSession();
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(remnashopProfile({
        email: "user@example.com",
        telegramId: null,
      }));

    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });
    expect(prismaMock.webSession.updateMany).not.toHaveBeenCalled();
  });

  it("fails automatic e-mail restore if the local session changed before storage", async () => {
    const session = emailSession();
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webSession.updateMany.mockResolvedValueOnce({ count: 0 });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "1" }))
      .mockResolvedValueOnce(remnashopProfile({
        email: "user@example.com",
        telegramId: null,
      }));

    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    expect(prismaMock.webUser.update).not.toHaveBeenCalled();
  });

  it("revalidates the local session before e-mail and Telegram recovery", async () => {
    const email = emailSession();
    vi.mocked(getCurrentSession)
      .mockResolvedValueOnce(email as never)
      .mockResolvedValueOnce(null);
    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Current session changed before e-mail recovery",
    });

    const telegram = telegramSession({
      remnashopUserId: null,
      email: null,
      emailVerified: false,
    });
    vi.mocked(getCurrentSession)
      .mockResolvedValueOnce(telegram as never)
      .mockResolvedValueOnce(null);
    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Current session changed before Remnashop recovery",
    });
  });

  it("rejects an unlinked full session after e-mail restore declines it", async () => {
    const session = emailSession({ remnashopUserId: null });
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);

    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({
      code: "EMAIL_REQUIRED",
      status: 401,
    });
  });

  it("synchronizes upstream e-mail verification for an authorized Telegram-linked session", async () => {
    const session = emailSession({
      emailVerified: false,
      telegramId: "123456",
      withTokens: true,
    });
    const refreshAccessCookie = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getCurrentSession).mockResolvedValueOnce(session as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(remnashopProfile({
      email: "user@example.com",
      telegramId: 123456,
      emailVerified: true,
    }));

    await expect(getAuthorizedRemnashopTokens({ refreshAccessCookie }))
      .resolves.toMatchObject({ session: { user: { emailVerified: true } } });
    expect(prismaMock.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailVerified: true },
    });
    expect(refreshAccessCookie).toHaveBeenCalledOnce();
  });

  it("rejects when upstream still does not verify an authorized local e-mail", async () => {
    const session = emailSession({
      emailVerified: false,
      telegramId: "123456",
      withTokens: true,
    });
    vi.mocked(getCurrentSession).mockResolvedValueOnce(session as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(remnashopProfile({
      email: "other@example.com",
      telegramId: 123456,
      emailVerified: false,
    }));

    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
      status: 403,
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

  it("removes a newly-created callback session when coordinated recovery fails", async () => {
    const session = telegramSession({ remnashopUserId: "1" });
    prismaMock.webSession.findFirst.mockResolvedValueOnce(session);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(remnashopProfile({
        email: "another-owner@example.com",
        emailVerified: true,
      }));

    await expect(
      recoverRemnashopTelegramSession("session-1", "user-1"),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

    expect(prismaMock.webSession.deleteMany).toHaveBeenCalledWith({
      where: { id: "session-1", userId: "user-1" },
    });
    expect(prismaMock.webSession.updateMany).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(currentUser);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    prismaMock.webUser.update.mockResolvedValue(currentUser);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(remnashopProfile())
      .mockResolvedValueOnce(response({ body: null }));

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

  it("converges on tokens stored by a concurrent Telegram recovery", async () => {
    const staleSession = telegramSession();
    const winningSession = {
      ...staleSession,
      remnashopAccessTokenEncrypted: protectRemnashopToken("winner-access"),
      remnashopRefreshTokenEncrypted: protectRemnashopToken("winner-refresh"),
      remnashopAccessExpiresAt: new Date(Date.now() + 10 * 60_000),
      remnashopRefreshExpiresAt: new Date(Date.now() + 60 * 60_000),
    };
    vi.mocked(getCurrentSession)
      .mockResolvedValueOnce(staleSession as never)
      .mockResolvedValueOnce(staleSession as never)
      .mockResolvedValueOnce(winningSession as never);
    prismaMock.$transaction.mockRejectedValueOnce(
      new ServiceError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "Concurrent recovery changed the local session",
        { message: "local_identity_changed_before_recovery" },
      ),
    );
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(remnashopProfile());

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({
      accessToken: "winner-access",
      refreshToken: "winner-refresh",
      session: { id: "session-1" },
    });
    expect(getCurrentSession).toHaveBeenCalledTimes(3);
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
      new ServiceError(
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
      .mockResolvedValueOnce(remnashopProfile())
      .mockResolvedValueOnce(response({ body: null }));

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

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://remnashop:5000/api/v1/public/auth/me",
    );
    expect(
      fetchMock.mock.invocationCallOrder[1] ?? Number.MAX_SAFE_INTEGER,
    ).toBeLessThan(
      prismaMock.webSession.updateMany.mock.invocationCallOrder[0] ?? 0,
    );
    const storedTokens = prismaMock.webSession.updateMany.mock.calls.at(-1)?.[0]
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
      .mockResolvedValueOnce(remnashopProfile())
      .mockResolvedValueOnce(response({ body: null }));

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({
      accessToken: postMergeAccess,
      refreshToken: "post-merge-refresh",
      session: { user: { remnashopUserId: "2" } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [mergeUrl, mergeInit] = fetchMock.mock.calls[2] ?? [];
    expect(mergeUrl).toBe(
      "http://remnashop:5000/api/v1/admin/users/merge?dry_run=false",
    );
    expect(JSON.parse(String((mergeInit as RequestInit).body))).toMatchObject({
      source_user_id: 1,
      target_user_id: 2,
      email_resolution: "KEEP_TARGET",
      telegram_resolution: "KEEP_SOURCE",
      payment_resolution: "REKEY_SOURCE",
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
      paymentMergeMock.markPaymentOwnerChangeUpstreamMutationStarted.mock
        .invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    ).toBeLessThan(fetchMock.mock.invocationCallOrder[2] ?? 0);
    expect(
      paymentMergeMock.preflightPaymentOperationsForUserMerge.mock
        .invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    ).toBeLessThan(
      paymentMergeMock.markPaymentOwnerChangeUpstreamMutationStarted.mock
        .invocationCallOrder[0] ?? 0,
    );
    expect(
      paymentMergeMock.markPaymentOwnerChangeUpstreamMutationStarted,
    ).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.invocationCallOrder[5] ?? Number.MAX_SAFE_INTEGER,
    ).toBeLessThan(
      prismaMock.webSession.updateMany.mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      fetchMock.mock.invocationCallOrder[5] ?? Number.MAX_SAFE_INTEGER,
    ).toBeLessThan(
      prismaMock.$transaction.mock.invocationCallOrder[1] ?? 0,
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(paymentMergeMock.withPaymentOwnerChangeFence).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ["user-1"],
        upstreamAccountIds: expect.arrayContaining(["1", "2"]),
        telegramIds: ["123456"],
        work: expect.any(Function),
      }),
    );
    expect(paymentMergeMock.assertPaymentOwnerChangeFenceHeld).toHaveBeenCalledTimes(2);
    expect(paymentMergeMock.transferPaymentOperationsForUserMerge).toHaveBeenCalledWith(
      prismaMock,
      "user-1",
      "2",
      [],
    );
    const timeoutBudgets = timeoutSpy.mock.calls.map(([timeoutMs]) => timeoutMs);
    expect(timeoutBudgets.slice(0, 2)).toEqual([15_000, 15_000]);
    expect(timeoutBudgets.slice(2)).toHaveLength(4);
    expect(
      timeoutBudgets.slice(2).every(
        (timeoutMs) => timeoutMs > 0 && timeoutMs <= 8_000,
      ),
    ).toBe(true);
    expect(prismaMock.$transaction.mock.calls[0]?.[1]).toEqual({
      maxWait: 5_000,
      timeout: 10_000,
    });
    const storedTokens = prismaMock.webSession.updateMany.mock.calls.at(-1)?.[0]
      ?.data;
    expect(revealRemnashopToken(storedTokens.remnashopAccessTokenEncrypted)).toBe(
      postMergeAccess,
    );
    expect(
      revealRemnashopToken(storedTokens.remnashopRefreshTokenEncrypted),
    ).toBe("post-merge-refresh");
    expect(storedTokens).toMatchObject({
      remnashopRefreshClaimTokenHash: null,
      remnashopRefreshLeaseExpiresAt: null,
      remnashopRefreshDispatchedAt: null,
      remnashopRefreshRecoveryEncrypted: null,
    });
  });

  it("rejects a local owner mapping that changes while the upstream merge runs", async () => {
    const session = telegramSession({ remnashopUserId: "1" });
    const currentUser = { ...session.user };
    const competingOwner = {
      id: "competing-owner",
      remnashopUserId: "2",
      email: "owner@example.com",
      emailVerified: true,
      telegramId: null,
    };
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(competingOwner);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(
        remnashopProfile({ email: null, emailVerified: false }),
      )
      .mockResolvedValueOnce(mergeResponse())
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(remnashopProfile())
      .mockResolvedValueOnce(response({ body: null }));

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
      debug: { message: "local_identity_changed_before_recovery" },
    });

    expect(prismaMock.webUser.update).not.toHaveBeenCalled();
    expect(prismaMock.webSession.updateMany).not.toHaveBeenCalled();
    expect(paymentMergeMock.assertPaymentOwnerChangeFenceHeld).toHaveBeenCalledTimes(2);
  });

  it("keeps the verified pending e-mail account as the merge target", async () => {
    const session = telegramSession({
      remnashopUserId: "2",
      email: null,
      emailVerified: false,
      authPending: true,
      pendingRemnashopUserId: "1",
      pendingRemnashopEmail: "owner@example.com",
    });
    const currentUser = {
      ...session.user,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const emailOwner = {
      id: "email-owner",
      remnashopUserId: "1",
      email: "owner@example.com",
      emailVerified: true,
      telegramId: null,
    };
    const postMergeAccess = jwt({ sub: "1", exp: 1_900_000_100 });
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique.mockImplementation(async (input: {
      where: { id?: string; remnashopUserId?: string; email?: string };
    }) => input.where.id === "user-1" ? currentUser : emailOwner);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ id: "email-owner" }, { id: "user-1" }])
      .mockResolvedValueOnce([{ id: "session-1" }]);
    prismaMock.webUser.update.mockResolvedValue({
      ...currentUser,
      remnashopUserId: "1",
      email: "owner@example.com",
      emailVerified: true,
      authPending: false,
      pendingRemnashopUserId: null,
      pendingRemnashopEmail: null,
    });
    paymentMergeMock.preflightPaymentOperationsForUserMerge.mockResolvedValueOnce({
      targetUpstreamAccountId: "2",
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(telegramAuthResponse({ userId: "2" }))
      .mockResolvedValueOnce(
        remnashopProfile({ email: null, emailVerified: false }),
      )
      .mockResolvedValueOnce(mergeResponse({ sourceUserId: 2, targetUserId: 1 }))
      .mockResolvedValueOnce(
        telegramAuthResponse({
          userId: "1",
          accessToken: postMergeAccess,
          refreshToken: "post-merge-refresh",
        }),
      )
      .mockResolvedValueOnce(remnashopProfile())
      .mockResolvedValueOnce(response({ body: null }));

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({
      accessToken: postMergeAccess,
      session: {
        user: {
          remnashopUserId: "1",
          email: "owner@example.com",
          emailVerified: true,
          authPending: false,
          pendingRemnashopUserId: null,
          pendingRemnashopEmail: null,
        },
      },
    });
    expect(paymentMergeMock.preflightPaymentOperationsForUserMerge).toHaveBeenCalledWith(
      prismaMock,
      "user-1",
      ["email-owner"],
    );
    expect(userMergeMock.mergeLocalUsersIntoTarget).toHaveBeenCalledWith(
      prismaMock,
      {
        targetUserId: "user-1",
        targetUpstreamAccountId: "1",
        sourceUserIds: ["email-owner"],
        ownerExpectations: [
          {
            id: "user-1",
            remnashopUserId: "2",
            email: null,
            telegramId: "123456",
          },
          {
            id: "email-owner",
            remnashopUserId: "1",
            email: "owner@example.com",
            telegramId: null,
          },
        ],
        paymentOwnerFenceHeld: true,
      },
    );
    expect(prismaMock.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({
        remnashopUserId: "1",
        email: "owner@example.com",
        emailVerified: true,
        authPending: false,
        pendingRemnashopUserId: null,
        pendingRemnashopEmail: null,
      }),
    });
  });

  it("clears invalidated Remnashop bundles from every other active session", async () => {
    const session = telegramSession({ remnashopUserId: "1" });
    const currentUser = { ...session.user };
    const postMergeAccess = jwt({ sub: "2", exp: 1_900_000_100 });
    vi.mocked(getCurrentSession).mockResolvedValue(session as never);
    prismaMock.webUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentUser)
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
      .mockResolvedValueOnce(remnashopProfile())
      .mockResolvedValueOnce(response({ body: null }));

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
        remnashopRefreshClaimTokenHash: null,
        remnashopRefreshLeaseExpiresAt: null,
        remnashopRefreshDispatchedAt: null,
        remnashopRefreshRecoveryEncrypted: null,
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
      .mockResolvedValueOnce(currentUser)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentUser)
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
      .mockResolvedValueOnce(response({ body: null }))
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
      .mockResolvedValueOnce(remnashopProfile())
      .mockResolvedValueOnce(response({ body: null }));

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).rejects.toThrow("database write failed");
    expect(prismaMock.webSession.updateMany).toHaveBeenCalledTimes(1);

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({
      accessToken: retryPostMergeAccess,
      refreshToken: "retry-post-merge-refresh",
    });

    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/users/merge");
    expect(fetchMock.mock.calls[8]?.[0]).toContain("/users/merge");
    expect(prismaMock.webSession.updateMany).toHaveBeenCalledTimes(3);
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
      .mockResolvedValueOnce(remnashopProfile())
      .mockResolvedValueOnce(response({ body: null }));

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
        ownerExpectations: [
          {
            id: "user-1",
            remnashopUserId: null,
            email: "owner@example.com",
            telegramId: "123456",
          },
          {
            id: "source-user",
            remnashopUserId: "2",
            email: "owner@example.com",
            telegramId: null,
          },
        ],
        paymentOwnerFenceHeld: true,
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
