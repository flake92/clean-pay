import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRemnashopMe: vi.fn(),
  remnashopRequest: vi.fn(),
  synchronizeRemnawaveUserIdentity: vi.fn(),
  markPaymentOwnerChangeUpstreamMutationStarted: vi.fn(),
  getRemnashopUserIdFromAccessToken: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  getRemnashopMe: mocks.getRemnashopMe,
  remnashopRequest: mocks.remnashopRequest,
  getRemnashopUserIdFromAccessToken: mocks.getRemnashopUserIdFromAccessToken,
}));
vi.mock("@/backend/integrations/remnawave/client", () => ({
  synchronizeRemnawaveUserIdentity: mocks.synchronizeRemnawaveUserIdentity,
}));
vi.mock("@/backend/integrations/payments/payment-user-merge-service", () => ({
  markPaymentOwnerChangeUpstreamMutationStarted:
    mocks.markPaymentOwnerChangeUpstreamMutationStarted,
}));

import { synchronizeProviderAccountIdentity } from "@/backend/integrations/auth/provider-account-identity-sync";

const expected = {
  accountId: "account-1",
  email: "owner@example.com",
  emailVerified: true,
  pendingEmail: null,
  telegramId: "777",
};

describe("provider account identity synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRemnashopMe.mockResolvedValue({
      email: "owner@example.com", telegram_id: 777, is_email_verified: true, pending_email: null,
    });
    mocks.getRemnashopUserIdFromAccessToken.mockReturnValue("account-1");
    mocks.remnashopRequest.mockResolvedValue({ user_remna_id: "rw-1" });
  });

  it("copies the final Remnashop owner to the preserved Remnawave subscription", async () => {
    await expect(synchronizeProviderAccountIdentity("access-token", expected)).resolves.toMatchObject({ hasSubscription: true });
    expect(mocks.synchronizeRemnawaveUserIdentity).toHaveBeenCalledWith({
      uuid: "rw-1", email: "owner@example.com", telegramId: "777",
    });
  });

  it("does not write Remnawave when neither account has a subscription", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce(null);
    await expect(synchronizeProviderAccountIdentity("access-token", expected)).resolves.toMatchObject({ hasSubscription: false });
    expect(mocks.synchronizeRemnawaveUserIdentity).not.toHaveBeenCalled();
  });

  it("fails closed when a subscription would be left without an e-mail or Telegram owner", async () => {
    mocks.getRemnashopMe.mockResolvedValueOnce({ email: "owner@example.com", telegram_id: null, is_email_verified: true, pending_email: null });
    await expect(synchronizeProviderAccountIdentity("access-token", { ...expected, telegramId: null }))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(mocks.synchronizeRemnawaveUserIdentity).not.toHaveBeenCalled();
  });

  it.each([
    [{ accountId: "other" }, "account_id"],
    [{ email: "other@example.com" }, "email"],
    [{ emailVerified: false }, "email_verified"],
    [{ pendingEmail: "pending@example.com" }, "pending_email"],
    [{ telegramId: "888" }, "telegram_id"],
  ])("fails closed on a changed final provider identity: %j", async (change, reason) => {
    await expect(synchronizeProviderAccountIdentity("access-token", { ...expected, ...change }))
      .rejects.toMatchObject({
        code: "ACCOUNT_MERGE_REQUIRED",
        debug: { message: `provider_identity_mismatch_${reason}` },
      });
    expect(mocks.synchronizeRemnawaveUserIdentity).not.toHaveBeenCalled();
  });
});
