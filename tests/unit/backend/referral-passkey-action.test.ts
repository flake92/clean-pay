import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPasskeyLogin: vi.fn(),
  clearReferralAttributionCookie: vi.fn(),
}));

vi.mock("@/application/auth/execute-passkey-command", () => ({
  beginPasskeyLogin: vi.fn(),
  beginPasskeyRegistration: vi.fn(),
  verifyPasskeyLogin: mocks.verifyPasskeyLogin,
  verifyPasskeyRegistration: vi.fn(),
}));
vi.mock("@/backend/integrations/auth/passkey-commands", () => ({
  productionPasskeyCommands: { adapter: "passkey" },
}));
vi.mock("@/backend/integrations/referral/referral-attribution", () => ({
  clearReferralAttributionCookie: mocks.clearReferralAttributionCookie,
}));

import { verifyPasskeyLoginAction } from "@/app/actions/passkeys";

describe("referral attribution after Passkey login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearReferralAttributionCookie.mockResolvedValue(undefined);
  });

  it("discards pending attribution after terminal existing-account login", async () => {
    mocks.verifyPasskeyLogin.mockResolvedValue({ ok: true });

    await expect(verifyPasskeyLoginAction({} as never)).resolves.toEqual({ ok: true });
    expect(mocks.clearReferralAttributionCookie).toHaveBeenCalledOnce();
  });

  it("preserves attribution when Passkey verification fails", async () => {
    mocks.verifyPasskeyLogin.mockResolvedValue({
      ok: false,
      code: "UNAUTHORIZED",
      message: "Ключ не подошёл",
    });

    await verifyPasskeyLoginAction({} as never);
    expect(mocks.clearReferralAttributionCookie).not.toHaveBeenCalled();
  });
});
