import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyTurnstileToken: vi.fn(),
  assertRateLimit: vi.fn(),
  withAuthConcurrency: vi.fn(),
  remnashopRequestPasswordReset: vi.fn(),
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
  remnashopRequestPasswordReset: mocks.remnashopRequestPasswordReset,
  remnashopAuth: mocks.remnashopAuth,
}));
vi.mock("@/backend/integrations/remnashop/session", () => ({
  createSessionFromRemnashopAuth: mocks.createSessionFromRemnashopAuth,
}));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));

import { confirmPasswordReset, requestPasswordReset } from "@/backend/auth/password-reset";

describe("password reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withAuthConcurrency.mockImplementation(
      async (_action: string, work: () => Promise<unknown>) => await work(),
    );
  });

  it("returns the same accepted response without exposing account existence", async () => {
    mocks.remnashopRequestPasswordReset.mockResolvedValue({ success: true });

    await expect(requestPasswordReset({ email: "user@example.com" }, "token"))
      .resolves.toEqual({ success: true });

    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith("token", "password_reset_start");
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      action: "password_reset_start",
      email: "user@example.com",
    }));
    expect(mocks.remnashopRequestPasswordReset).toHaveBeenCalledWith({ email: "user@example.com" });
  });

  it("creates a fresh local session only after a successful reset", async () => {
    const auth = {
      data: { expires_at: "2099-01-01T00:00:00.000Z", refresh_expires_at: "2099-02-01T00:00:00.000Z" },
      cookies: { accessToken: "new-access", refreshToken: "new-refresh" },
    };
    mocks.remnashopAuth.mockResolvedValue(auth);
    mocks.createSessionFromRemnashopAuth.mockResolvedValue({
      user: { id: "local-user" },
      profile: { email: "user@example.com" },
    });

    const result = await confirmPasswordReset({
      email: "user@example.com",
      code: "123456",
      new_password: "new-password-1",
    }, "token");

    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith("token", "password_reset_confirm");
    expect(mocks.remnashopAuth).toHaveBeenCalledWith("/auth/password/confirm-reset", {
      email: "user@example.com",
      code: "123456",
      new_password: "new-password-1",
    });
    expect(mocks.createSessionFromRemnashopAuth).toHaveBeenCalledWith({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      auth: auth.data,
      replaceExistingSessions: true,
      replacementIdentityEmail: "user@example.com",
    });
    expect(mocks.auditLog).toHaveBeenCalledWith({
      action: "password_reset_success",
      userId: "local-user",
    });
    expect(result.user).toEqual({ email: "user@example.com" });
  });
});
