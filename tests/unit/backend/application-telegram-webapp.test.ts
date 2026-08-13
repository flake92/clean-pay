import { describe, expect, it, vi } from "vitest";

import { authenticateTelegramWebApp } from "@/application/auth/authenticate-telegram-webapp";
import type { TelegramWebAppGateway } from "@/application/auth/ports/telegram-webapp";

const upstreamSession = {
  accessTokenEncrypted: "access",
  refreshTokenEncrypted: "refresh",
  accessExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
  refreshExpiresAt: new Date("2030-02-01T00:00:00.000Z"),
};

function gateway(overrides: Partial<TelegramWebAppGateway> = {}): TelegramWebAppGateway {
  return {
    preflightCapacity: vi.fn(async () => undefined),
    withUpstreamConcurrency: vi.fn(async (_action, work) => work()),
    authenticateProvider: vi.fn(async () => ({ context: { provider: true } })),
    verifiedIdentity: vi.fn(async () => ({ telegramId: "777", context: { verified: true } })),
    rateLimit: vi.fn(async () => undefined),
    reconcileIdentity: vi.fn(async () => ({ userId: "user-1", upstreamSession, requiresRecovery: false })),
    createSession: vi.fn(async () => ({ id: "session-1" })),
    recoverSession: vi.fn(async () => undefined),
    revokeSession: vi.fn(async () => undefined),
    clearSessionCookies: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("authenticateTelegramWebApp", () => {
  it("rejects empty init data before invoking a provider", async () => {
    const target = gateway();

    await expect(authenticateTelegramWebApp(target, "   ")).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
    expect(target.authenticateProvider).not.toHaveBeenCalled();
  });

  it("rejects oversized init data before capacity or provider work", async () => {
    const target = gateway();

    await expect(authenticateTelegramWebApp(target, "x".repeat(16_385)))
      .resolves.toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(target.preflightCapacity).not.toHaveBeenCalled();
    expect(target.authenticateProvider).not.toHaveBeenCalled();
  });

  it("rejects non-string init data before capacity or provider work", async () => {
    const target = gateway();

    await expect(authenticateTelegramWebApp(target, { signed: true }))
      .resolves.toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(target.preflightCapacity).not.toHaveBeenCalled();
    expect(target.authenticateProvider).not.toHaveBeenCalled();
  });

  it("orders anonymous capacity and bounded provider proof before the target limit", async () => {
    const order: string[] = [];
    const target = gateway({
      preflightCapacity: vi.fn(async () => { order.push("capacity"); }),
      withUpstreamConcurrency: vi.fn(async (_action, work) => {
        order.push("semaphore");
        return work();
      }),
      authenticateProvider: vi.fn(async () => {
        order.push("authenticate-provider");
        return { context: {} };
      }),
      verifiedIdentity: vi.fn(async () => {
        order.push("verified-identity");
        return { telegramId: "777", context: {} };
      }),
      rateLimit: vi.fn(async () => { order.push("target"); }),
    });

    await expect(authenticateTelegramWebApp(target, "signed-data")).resolves.toEqual({ ok: true });
    expect(order).toEqual([
      "capacity",
      "semaphore",
      "authenticate-provider",
      "semaphore",
      "verified-identity",
      "target",
    ]);
  });

  it("authenticates trimmed init data and creates a local session", async () => {
    const target = gateway();

    await expect(authenticateTelegramWebApp(target, "  signed-data  ")).resolves.toEqual({ ok: true });
    expect(target.authenticateProvider).toHaveBeenCalledWith("signed-data");
    expect(target.rateLimit).toHaveBeenCalledWith("777");
    expect(target.createSession).toHaveBeenCalledWith({ userId: "user-1", upstreamSession });
    expect(target.recoverSession).not.toHaveBeenCalled();
  });

  it("recovers a newly created session when reconciliation requests it", async () => {
    const target = gateway({
      reconcileIdentity: vi.fn(async () => ({ userId: "user-2", upstreamSession, requiresRecovery: true })),
      createSession: vi.fn(async () => ({ id: "session-2" })),
    });

    await expect(authenticateTelegramWebApp(target, "signed-data")).resolves.toEqual({ ok: true });
    expect(target.recoverSession).toHaveBeenCalledWith("session-2", "user-2");
  });

  it("revokes only the newly created session when recovery fails", async () => {
    const target = gateway({
      reconcileIdentity: vi.fn(async () => ({ userId: "user-2", upstreamSession, requiresRecovery: true })),
      createSession: vi.fn(async () => ({ id: "session-2" })),
      recoverSession: vi.fn(async () => { throw new Error("recovery unavailable"); }),
    });

    await expect(authenticateTelegramWebApp(target, "signed-data"))
      .resolves.toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
    expect(target.revokeSession).toHaveBeenCalledOnce();
    expect(target.revokeSession).toHaveBeenCalledWith("session-2", "user-2");
    expect(target.clearSessionCookies).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing Telegram identity", { verifiedIdentity: vi.fn(async () => ({ telegramId: null, context: {} })) }, "UNAUTHORIZED"],
    ["missing upstream session", { reconcileIdentity: vi.fn(async () => ({ userId: "user-1", requiresRecovery: false })) }, "INTERNAL_ERROR"],
    ["failed local session creation", { createSession: vi.fn(async () => null) }, "INTERNAL_ERROR"],
  ])("returns a workflow error for %s", async (_name, overrides, code) => {
    await expect(authenticateTelegramWebApp(gateway(overrides), "signed-data")).resolves.toMatchObject({
      ok: false,
      code,
    });
  });

  it("preserves a typed provider error and hides an untyped failure", async () => {
    await expect(authenticateTelegramWebApp(gateway({
      authenticateProvider: vi.fn(async () => { throw { code: "RATE_LIMITED" }; }),
    }), "signed-data")).resolves.toMatchObject({ ok: false, code: "RATE_LIMITED" });

    await expect(authenticateTelegramWebApp(gateway({
      authenticateProvider: vi.fn(async () => { throw new Error("provider secret"); }),
    }), "signed-data")).resolves.toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
  });
});
