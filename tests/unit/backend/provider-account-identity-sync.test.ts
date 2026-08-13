import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRemnashopMe: vi.fn(),
  remnashopRequest: vi.fn(),
  synchronizeRemnawaveUserIdentity: vi.fn(),
  markPaymentOwnerChangeUpstreamMutationStarted: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  getRemnashopMe: mocks.getRemnashopMe,
  remnashopRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/remnawave/client", () => ({
  synchronizeRemnawaveUserIdentity: mocks.synchronizeRemnawaveUserIdentity,
}));
vi.mock("@/backend/integrations/payments/payment-user-merge-service", () => ({
  markPaymentOwnerChangeUpstreamMutationStarted:
    mocks.markPaymentOwnerChangeUpstreamMutationStarted,
}));

import { synchronizeProviderAccountIdentity } from "@/backend/integrations/auth/provider-account-identity-sync";

describe("provider account identity synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRemnashopMe.mockResolvedValue({
      email: "owner@example.com", telegram_id: 777,
    });
    mocks.remnashopRequest.mockResolvedValue({ user_remna_id: "rw-1" });
  });

  it("copies the final Remnashop owner to the preserved Remnawave subscription", async () => {
    await expect(synchronizeProviderAccountIdentity("access-token")).resolves.toBe(true);
    expect(mocks.synchronizeRemnawaveUserIdentity).toHaveBeenCalledWith({
      uuid: "rw-1", email: "owner@example.com", telegramId: "777",
    });
  });

  it("does not write Remnawave when neither account has a subscription", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce(null);
    await expect(synchronizeProviderAccountIdentity("access-token")).resolves.toBe(false);
    expect(mocks.synchronizeRemnawaveUserIdentity).not.toHaveBeenCalled();
  });

  it("fails closed when a subscription would be left without an e-mail or Telegram owner", async () => {
    mocks.getRemnashopMe.mockResolvedValueOnce({ email: "owner@example.com", telegram_id: null });
    await expect(synchronizeProviderAccountIdentity("access-token"))
      .rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(mocks.synchronizeRemnawaveUserIdentity).not.toHaveBeenCalled();
  });
});
