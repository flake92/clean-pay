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
    webSession: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    webUser: {
      findUnique: vi.fn(),
    },
  },
  authDebugLog: vi.fn(),
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

import {
  clearWebSession,
  createWebSession,
  createWebSessionForRemnashopUser,
  createWebSessionOnResponse,
  getCurrentSession,
  getCurrentUser,
  refreshCurrentAccessCookie,
  upgradeCurrentSessionToFull,
} from "@/backend/sessions/web-session";
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

  it("falls back to refresh cookie when access is missing or invalid", async () => {
    state.cookies.set("clean_pay_refresh", "refresh-token");
    mocks.prisma.webSession.findFirst.mockResolvedValueOnce(session);
    mocks.prisma.webSession.update.mockResolvedValueOnce({ ...session, accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z") });

    await expect(getCurrentSession()).resolves.toMatchObject({ id: "session-1" });

    expect(mocks.prisma.webSession.findFirst).toHaveBeenCalledWith({
      where: {
        refreshTokenHash: sha256("refresh-token"),
        revokedAt: null,
        refreshExpiresAt: { gt: expect.any(Date) },
      },
      include: { user: true },
    });
    expect(state.setCalls.some((call) => call.name === "clean_pay_access")).toBe(true);
  });

  it("sets cookies on explicit NextResponse and can refresh access cookie", async () => {
    mocks.prisma.webSession.findFirst.mockResolvedValue(null);
    const response = NextResponse.json({ ok: true });

    await createWebSessionOnResponse(response, "user-1");
    expect(response.cookies.get("clean_pay_access")?.value).toBeTruthy();
    expect(response.cookies.get("clean_pay_refresh")?.value).toBeTruthy();

    state.cookies.set(
      "clean_pay_access",
      accessToken({ sid: "session-1", uid: "user-1", exp: Math.floor(Date.now() / 1000) + 60 }),
    );
    mocks.prisma.webSession.findFirst.mockResolvedValue(session);
    await expect(refreshCurrentAccessCookie()).resolves.toEqual(session);
    expect(state.setCalls.some((call) => call.name === "clean_pay_access")).toBe(true);
  });

  it("upgrades partial sessions and clears sessions by access or refresh token", async () => {
    state.cookies.set(
      "clean_pay_access",
      accessToken({ sid: "session-1", uid: "user-1", exp: Math.floor(Date.now() / 1000) + 60 }),
    );
    mocks.prisma.webSession.findFirst.mockResolvedValue({ ...session, assuranceLevel: "PARTIAL" });
    mocks.prisma.webSession.update.mockResolvedValue({ ...session, assuranceLevel: "FULL" });

    await expect(upgradeCurrentSessionToFull()).resolves.toMatchObject({ assuranceLevel: "FULL" });

    await clearWebSession();
    expect(mocks.prisma.webSession.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(state.deleteCalls).toEqual(["clean_pay_access", "clean_pay_refresh"]);

    state.cookies.set("clean_pay_refresh", "refresh-only");
    await clearWebSession();
    expect(mocks.prisma.webSession.updateMany).toHaveBeenLastCalledWith({
      where: { refreshTokenHash: sha256("refresh-only") },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
