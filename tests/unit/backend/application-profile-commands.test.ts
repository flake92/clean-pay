import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestEmailVerificationCode: vi.fn(), changeVerifiedEmail: vi.fn(),
}));

vi.mock("@/application/auth/execute-email-verification", () => ({
  requestEmailVerificationCode: mocks.requestEmailVerificationCode,
  changeVerifiedEmail: mocks.changeVerifiedEmail,
}));

import {
  changeProfileEmail,
  changeProfilePassword,
  requestProfileEmailVerification,
} from "@/application/profile/execute-profile-command";
import { ProfileGatewayError, type ProfileCommands } from "@/application/profile/ports/profile-commands";

function passwordCommands(overrides: Partial<ProfileCommands> = {}): ProfileCommands {
  return {
    loadPasswordSession: vi.fn(async () => ({ context: {}, userId: "user-1" })),
    assertPasswordChangeRateLimit: vi.fn(async () => undefined),
    changeProviderPassword: vi.fn(async () => ({ context: { changed: true } })),
    refreshProviderSession: vi.fn(async () => ({ context: { refreshed: true } })),
    persistRefreshedProviderSession: vi.fn(async () => undefined),
    replaceLocalPasswordSession: vi.fn(async () => undefined), auditPasswordChanged: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("profile command presentation policy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("presents a successfully requested verification code", async () => {
    mocks.requestEmailVerificationCode.mockResolvedValue({ ok: true, kind: "code-sent", targetEmail: "user@example.com" });
    await expect(requestProfileEmailVerification({} as never, { email: "user@example.com" })).resolves.toMatchObject({
      ok: true, targetEmail: "user@example.com",
    });
  });

  it("preserves failed verification results and rejects unexpected success variants", async () => {
    const failure = { ok: false, code: "RATE_LIMITED", message: "limited" };
    mocks.requestEmailVerificationCode.mockResolvedValueOnce(failure).mockResolvedValueOnce({ ok: true, kind: "verified" });
    await expect(requestProfileEmailVerification({} as never, {})).resolves.toBe(failure);
    await expect(requestProfileEmailVerification({} as never, {})).resolves.toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
    mocks.requestEmailVerificationCode.mockRejectedValueOnce(Object.assign(new Error(), { code: "RATE_LIMITED" }));
    await expect(requestProfileEmailVerification({} as never, {})).resolves.toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("validates and presents e-mail change outcomes", async () => {
    await expect(changeProfileEmail({} as never, { email: "   " })).resolves.toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    const failure = { ok: false, code: "CONFLICT", message: "conflict" };
    mocks.changeVerifiedEmail.mockResolvedValueOnce(failure).mockResolvedValueOnce({ ok: true, kind: "verified" })
      .mockResolvedValueOnce({ ok: true, kind: "code-sent", targetEmail: "new@example.com" });
    await expect(changeProfileEmail({} as never, { email: "new@example.com" })).resolves.toBe(failure);
    await expect(changeProfileEmail({} as never, { email: "new@example.com" })).resolves.toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
    await expect(changeProfileEmail({} as never, { email: "new@example.com" })).resolves.toMatchObject({ ok: true, targetEmail: "new@example.com" });
    mocks.changeVerifiedEmail.mockRejectedValueOnce(Object.assign(new Error(), { code: "CONFLICT" }));
    await expect(changeProfileEmail({} as never, { email: "new@example.com" })).resolves.toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("changes a password and replaces the local provider session in order", async () => {
    const commands = passwordCommands();
    await expect(changeProfilePassword(commands, { currentPassword: "old-password", newPassword: "new-password" })).resolves.toMatchObject({ ok: true });
    expect(commands.changeProviderPassword).toHaveBeenCalledBefore(vi.mocked(commands.replaceLocalPasswordSession));
    expect(commands.assertPasswordChangeRateLimit).toHaveBeenCalledBefore(vi.mocked(commands.changeProviderPassword));
    expect(commands.replaceLocalPasswordSession).toHaveBeenCalledBefore(vi.mocked(commands.auditPasswordChanged));
  });

  it("stops before the provider when the password-change limit is exceeded", async () => {
    const commands = passwordCommands({
      assertPasswordChangeRateLimit: vi.fn(async () => {
        throw Object.assign(new Error("limited"), { code: "RATE_LIMITED" });
      }),
    });

    await expect(changeProfilePassword(commands, {
      currentPassword: "old-password",
      newPassword: "new-password",
    })).resolves.toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(commands.changeProviderPassword).not.toHaveBeenCalled();
  });

  it("refreshes an expired provider session once after a current-password failure", async () => {
    const changed = { context: { changed: true } };
    const commands = passwordCommands({
      changeProviderPassword: vi.fn().mockRejectedValueOnce(new ProfileGatewayError("CURRENT_PASSWORD_INVALID")).mockResolvedValueOnce(changed),
    });
    await expect(changeProfilePassword(commands, { currentPassword: "old-password", newPassword: "new-password" })).resolves.toMatchObject({ ok: true });
    expect(commands.persistRefreshedProviderSession).toHaveBeenCalled();
    expect(commands.changeProviderPassword).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated provider failures and maps stable error messages", async () => {
    const commands = passwordCommands({
      changeProviderPassword: vi.fn(async () => { throw new ProfileGatewayError("CONFLICT"); }),
    });
    await expect(changeProfilePassword(commands, { currentPassword: "old-password", newPassword: "new-password" })).resolves.toMatchObject({
      ok: false, code: "CONFLICT",
    });
    expect(commands.refreshProviderSession).not.toHaveBeenCalled();
  });

  it.each([
    [{ currentPassword: "", newPassword: "new-password" }],
    [{ currentPassword: "old", newPassword: "short" }],
  ])("rejects weak local password input %#", async (input) => {
    const commands = passwordCommands();
    await expect(changeProfilePassword(commands, input)).resolves.toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(commands.loadPasswordSession).not.toHaveBeenCalled();
  });

  it("rejects an unchanged password before calling Remnashop", async () => {
    const commands = passwordCommands();

    await expect(changeProfilePassword(commands, {
      currentPassword: "same-password",
      newPassword: "same-password",
    })).resolves.toEqual({
      ok: false,
      code: "PASSWORD_UNCHANGED",
      message: "Новый пароль должен отличаться от текущего.",
    });
    expect(commands.loadPasswordSession).not.toHaveBeenCalled();
  });

  it("uses password-specific conflict messages", async () => {
    const commands = passwordCommands({
      changeProviderPassword: vi.fn(async () => { throw new ProfileGatewayError("PASSWORD_UNCHANGED"); }),
    });

    await expect(changeProfilePassword(commands, {
      currentPassword: "old-password",
      newPassword: "another-password",
    })).resolves.toMatchObject({
      ok: false,
      code: "PASSWORD_UNCHANGED",
      message: "Новый пароль должен отличаться от текущего.",
    });
  });
});
