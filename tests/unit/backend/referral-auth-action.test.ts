import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeAuthCommand: vi.fn(),
  readReferralAttributionCookie: vi.fn(),
  clearReferralAttributionCookie: vi.fn(),
}));

vi.mock("@/application/auth/execute-auth-command", () => ({
  executeAuthCommand: mocks.executeAuthCommand,
}));
vi.mock("@/backend/integrations/auth/auth-commands", () => ({
  productionAuthCommands: { adapter: "auth" },
}));
vi.mock("@/backend/integrations/referral/referral-attribution", () => ({
  readReferralAttributionCookie: mocks.readReferralAttributionCookie,
  clearReferralAttributionCookie: mocks.clearReferralAttributionCookie,
}));

import { executeAuthAction } from "@/app/actions/auth";

const authenticated = {
  ok: true as const,
  kind: "authenticated" as const,
  emailVerified: true,
  verificationRequired: false,
  verificationDeliveryFailed: false,
};

describe("referral-aware auth action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readReferralAttributionCookie.mockResolvedValue("Trusted42");
    mocks.clearReferralAttributionCookie.mockResolvedValue(undefined);
  });

  it("uses only signed server attribution and consumes it after creating an account", async () => {
    mocks.executeAuthCommand.mockResolvedValue({
      ...authenticated,
      registrationFlow: "created",
    });

    const result = await executeAuthAction({
      kind: "register",
      email: "user@example.com",
      password: "secret123",
      referralCode: "Untrusted99",
    });

    expect(mocks.executeAuthCommand).toHaveBeenCalledWith(
      { adapter: "auth" },
      {
        kind: "register",
        email: "user@example.com",
        password: "secret123",
        referralCode: "Trusted42",
      },
    );
    expect(mocks.clearReferralAttributionCookie).toHaveBeenCalledOnce();
    expect(result).toEqual(authenticated);
    expect(result).not.toHaveProperty("registrationFlow");
  });

  it("discards inapplicable attribution after a successful existing-account fallback", async () => {
    mocks.executeAuthCommand.mockResolvedValue({
      ...authenticated,
      registrationFlow: "existing_email_login",
    });

    const result = await executeAuthAction({
      kind: "register",
      email: "existing@example.com",
      password: "secret123",
    });

    expect(mocks.clearReferralAttributionCookie).toHaveBeenCalledOnce();
    expect(result).not.toHaveProperty("registrationFlow");
  });

  it("keeps attribution after a transient registration failure", async () => {
    const failure = { ok: false as const, code: "UPSTREAM_UNAVAILABLE", message: "Позже" };
    mocks.executeAuthCommand.mockResolvedValue(failure);

    await expect(executeAuthAction({
      kind: "register",
      email: "user@example.com",
      password: "secret123",
    })).resolves.toEqual(failure);

    expect(mocks.clearReferralAttributionCookie).not.toHaveBeenCalled();
  });

  it("does not read or forward referral attribution and discards it after terminal login", async () => {
    mocks.executeAuthCommand.mockResolvedValue(authenticated);
    const command = {
      kind: "login" as const,
      email: "existing@example.com",
      password: "secret123",
    };

    await executeAuthAction(command);

    expect(mocks.readReferralAttributionCookie).not.toHaveBeenCalled();
    expect(mocks.executeAuthCommand).toHaveBeenCalledWith({ adapter: "auth" }, command);
    expect(mocks.clearReferralAttributionCookie).toHaveBeenCalledOnce();
  });

  it("keeps attribution when an existing-account login fails", async () => {
    mocks.executeAuthCommand.mockResolvedValue({
      ok: false,
      code: "AUTH_FAILED",
      message: "Неверный пароль",
    });

    await executeAuthAction({
      kind: "login",
      email: "existing@example.com",
      password: "wrong-password",
    });

    expect(mocks.clearReferralAttributionCookie).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["array", []],
  ])("returns validation failure for malformed runtime input: %s", async (_name, malformed) => {
    const failure = {
      ok: false as const,
      code: "VALIDATION_ERROR",
      message: "Проверьте введённые данные.",
    };
    mocks.executeAuthCommand.mockResolvedValueOnce(failure);

    await expect(executeAuthAction(malformed)).resolves.toEqual(failure);
    expect(mocks.executeAuthCommand).toHaveBeenCalledWith({ adapter: "auth" }, malformed);
    expect(mocks.readReferralAttributionCookie).not.toHaveBeenCalled();
    expect(mocks.clearReferralAttributionCookie).not.toHaveBeenCalled();
  });
});
