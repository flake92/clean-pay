import { afterEach, describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: loggerMock,
}));

vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: {
    webSession: {
      update: vi.fn(),
    },
    webUser: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/backend/sessions/web-session", () => ({
  getCurrentSession: vi.fn(),
  refreshCurrentAccessCookie: vi.fn(),
}));

import {
  getJwtExpiresAt,
  getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken,
  protectRemnashopToken,
  remnashopAuth,
  remnashopLinkTelegram,
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

describe("remnashop client", () => {
  afterEach(() => {
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
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

    await expect(remnashopRequest("/plans/public")).rejects.toMatchObject<BffError>({
      code: "UPSTREAM_ERROR",
      status: 502,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ status: 401, body: { detail: "bad login" } }));
    await expect(remnashopAuth("/auth/login", { email: "u@e.test", password: "bad" })).rejects.toMatchObject<BffError>({
      code: "AUTH_FAILED",
      status: 401,
    });

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    await expect(remnashopRequest("/plans/public")).rejects.toMatchObject<BffError>({
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
    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject<BffError>({ code: "UNAUTHORIZED" });

    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      authMethod: "EMAIL",
      remnashopAccessTokenEncrypted: null,
      remnashopRefreshTokenEncrypted: null,
      user: { email: "user@example.com", emailVerified: true, telegramId: null },
    } as never);
    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject<BffError>({ code: "EMAIL_REQUIRED" });

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
    await expect(getAuthorizedRemnashopTokens()).rejects.toMatchObject<BffError>({ code: "EMAIL_NOT_VERIFIED" });

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

  it("refreshes Remnashop tokens when stored access token is about to expire", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      id: "session-1",
      userId: "user-1",
      authMethod: "EMAIL",
      remnashopAccessTokenEncrypted: protectRemnashopToken("old-access"),
      remnashopRefreshTokenEncrypted: protectRemnashopToken("old-refresh"),
      remnashopAccessExpiresAt: new Date(Date.now() - 1_000),
      remnashopRefreshExpiresAt: new Date(Date.now() + 60 * 60_000),
      user: { email: "user@example.com", emailVerified: true, telegramId: null },
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
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
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response({
        body: {
          expires_at: "2026-06-25T10:00:00.000Z",
          refresh_expires_at: "2026-07-25T10:00:00.000Z",
        },
        setCookie: ["access_token=new-access; Path=/", "refresh_token=new-refresh; Path=/"],
      }),
    );

    await expect(getAuthorizedRemnashopTokens()).resolves.toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });

    expect(prisma.webSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: expect.objectContaining({
        remnashopAccessTokenEncrypted: expect.any(String),
        remnashopRefreshTokenEncrypted: expect.any(String),
        remnashopAccessExpiresAt: new Date("2026-06-25T10:00:00.000Z"),
        remnashopRefreshExpiresAt: new Date("2026-07-25T10:00:00.000Z"),
      }),
    });
  });
});
