import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyTurnstileToken: vi.fn(),
  assertRateLimit: vi.fn(),
  withAuthConcurrency: vi.fn(),
  remnashopStartGenericEmailAuth: vi.fn(),
  remnashopAuth: vi.fn(),
  createSessionFromRemnashopAuth: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock("@/backend/security/turnstile", () => ({
  verifyTurnstileToken: mocks.verifyTurnstileToken,
}));
vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
  withAuthConcurrency: mocks.withAuthConcurrency,
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopStartGenericEmailAuth: mocks.remnashopStartGenericEmailAuth,
  remnashopAuth: mocks.remnashopAuth,
}));
vi.mock("@/backend/integrations/remnashop/session", () => ({
  createSessionFromRemnashopAuth: mocks.createSessionFromRemnashopAuth,
}));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));

import { completeGenericEmailAuth, startGenericEmailAuth } from "@/backend/auth/generic-email";
import { ServiceError } from "@/backend/errors/service-error";

describe("generic email authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withAuthConcurrency.mockImplementation(
      async (_action: string, work: () => Promise<unknown>) => await work(),
    );
  });

  it("binds Turnstile and applies Redis protection before the provider", async () => {
    mocks.remnashopStartGenericEmailAuth.mockResolvedValue({ success: true });

    await expect(startGenericEmailAuth({ email: "user@example.com" }, "token")).resolves.toEqual({ success: true });

    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith("token", "auth_login");
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      action: "email_auth_start",
      email: "user@example.com",
    }));
    expect(mocks.withAuthConcurrency).toHaveBeenCalledWith("email_auth_start", expect.any(Function));
    expect(mocks.remnashopStartGenericEmailAuth).toHaveBeenCalledOnce();
  });

  it("fails closed without a provider call when Redis protection is unavailable", async () => {
    mocks.assertRateLimit.mockRejectedValueOnce(
      new ServiceError("UPSTREAM_UNAVAILABLE", 503, "redis unavailable"),
    );

    await expect(startGenericEmailAuth({ email: "user@example.com" }, "token")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
    });
    expect(mocks.withAuthConcurrency).not.toHaveBeenCalled();
    expect(mocks.remnashopStartGenericEmailAuth).not.toHaveBeenCalled();
  });

  it("creates a local session only after the proof-completion response", async () => {
    const auth = {
      data: { expires_at: "2099-01-01T00:00:00.000Z", refresh_expires_at: "2099-02-01T00:00:00.000Z" },
      cookies: { accessToken: "access", refreshToken: "refresh" },
    };
    mocks.remnashopAuth.mockResolvedValue(auth);
    mocks.createSessionFromRemnashopAuth.mockResolvedValue({
      user: { id: "local-user" },
      profile: { email: "user@example.com" },
    });

    const result = await completeGenericEmailAuth(
      { email: "user@example.com", code: "123456", password: "password-1" },
      "token",
    );

    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith("token", "auth_login");
    expect(mocks.remnashopAuth).toHaveBeenCalledWith("/auth/email/complete", expect.objectContaining({ code: "123456" }));
    expect(mocks.createSessionFromRemnashopAuth).toHaveBeenCalledOnce();
    expect(result.user).toEqual({ email: "user@example.com" });
  });
});
