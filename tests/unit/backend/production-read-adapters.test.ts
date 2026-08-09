import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAuthProfile: vi.fn(),
  getEnv: vi.fn(),
  loadPaymentHistory: vi.fn(),
  getCurrentUser: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  remnashopRequest: vi.fn(),
  getLiveRemnawaveSubscriptionUrl: vi.fn(),
}));

vi.mock("@/backend/auth/profile", () => ({ getCurrentAuthProfile: mocks.getCurrentAuthProfile }));
vi.mock("@/backend/config/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/backend/integrations/payments/payment-history-reader", () => ({ loadPaymentHistory: mocks.loadPaymentHistory }));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  remnashopRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/integrations/remnawave/client", () => ({
  getLiveRemnawaveSubscriptionUrl: mocks.getLiveRemnawaveSubscriptionUrl,
}));

import { ServiceError } from "@/backend/errors/service-error";
import { productionCabinetReader } from "@/backend/integrations/cabinet/cabinet-reader";
import { productionNavigationReader } from "@/backend/integrations/navigation/navigation-reader";
import { productionCheckoutReader } from "@/backend/integrations/payments/checkout-reader";
import { remnashopSubscriptionCatalog } from "@/backend/integrations/remnashop/subscription-catalog";
import { remnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";
import { productionSupportReader } from "@/backend/integrations/support/support-reader";

const offers = {
  gateways: [],
  plans: [{ recommended_purchase_type: "renew" }],
  has_current_subscription: true,
  current_subscription_status: "ACTIVE",
};

describe("production read adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({
      accessToken: "access-token",
      session: { user: { email: "u@example.com", telegramId: "123" } },
    });
    mocks.getEnv.mockReturnValue({ support: { enabled: true, url: "https://support.example" } });
  });

  it("loads subscription details and replaces the cached URL with a live URL", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce({
      user_remna_id: "remna-user-1",
      status: "ACTIVE",
      url: "stale",
    });
    mocks.getLiveRemnawaveSubscriptionUrl.mockResolvedValue("https://live.example/subscription");

    await expect(remnashopSubscriptionReader.loadCurrent()).resolves.toMatchObject({
      user_remna_id: "remna-user-1",
      url: "https://live.example/subscription",
    });
    expect(mocks.getLiveRemnawaveSubscriptionUrl).toHaveBeenCalledWith({
      userRemnaId: "remna-user-1",
      email: "u@example.com",
      telegramId: "123",
    });
  });

  it("handles absent subscriptions and fails closed on an absent live URL", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce(null);
    await expect(remnashopSubscriptionReader.loadCurrent()).resolves.toBeNull();

    mocks.remnashopRequest.mockResolvedValueOnce({ user_remna_id: "remna-user-1", url: "stale" });
    mocks.getLiveRemnawaveSubscriptionUrl.mockResolvedValueOnce(null);
    await expect(remnashopSubscriptionReader.loadCurrent())
      .rejects.toMatchObject({ code: "SUBSCRIPTION_URL_UNAVAILABLE", status: 409 });
  });

  it("loads device and offer endpoints with the authorized token", async () => {
    mocks.remnashopRequest
      .mockResolvedValueOnce({ devices: [], current_count: 0, max_count: 3 })
      .mockResolvedValueOnce(offers);
    await expect(remnashopSubscriptionReader.loadDevices()).resolves.toMatchObject({ current_count: 0 });
    await expect(remnashopSubscriptionReader.loadOffers()).resolves.toBe(offers);
    expect(mocks.remnashopRequest).toHaveBeenNthCalledWith(1, "/subscription/devices", { accessToken: "access-token" });
    expect(mocks.remnashopRequest).toHaveBeenNthCalledWith(2, "/subscription/offers", { accessToken: "access-token" });
  });

  it("normalizes subscription catalog access failures", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce(offers);
    await expect(remnashopSubscriptionCatalog.loadOffers()).resolves.toBe(offers);

    mocks.getAuthorizedRemnashopTokens.mockRejectedValueOnce(new ServiceError("UNAUTHORIZED", 401));
    await expect(remnashopSubscriptionCatalog.loadOffers()).rejects.toMatchObject({ reason: "unauthorized" });
    mocks.getAuthorizedRemnashopTokens.mockRejectedValueOnce(new ServiceError("EMAIL_NOT_VERIFIED", 403));
    await expect(remnashopSubscriptionCatalog.loadOffers()).rejects.toMatchObject({ reason: "email-required" });
    mocks.getAuthorizedRemnashopTokens.mockRejectedValueOnce(new Error("offline"));
    await expect(remnashopSubscriptionCatalog.loadOffers()).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("assembles cabinet data through its dedicated readers", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
    mocks.getCurrentAuthProfile.mockResolvedValue({ user: { email: "u@example.com" } });
    mocks.remnashopRequest
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(offers)
      .mockResolvedValueOnce({ devices: [] });
    mocks.loadPaymentHistory.mockResolvedValue({ records: [], stale: false });

    await expect(productionCabinetReader.loadUser()).resolves.toEqual({
      id: "user-1",
      profile: { email: "u@example.com" },
    });
    await expect(productionCabinetReader.loadSubscription()).resolves.toBeNull();
    await expect(productionCabinetReader.loadOffers()).resolves.toBe(offers);
    await expect(productionCabinetReader.loadDevices()).resolves.toEqual({ devices: [] });
    await expect(productionCabinetReader.loadPayments("user-1")).resolves.toMatchObject({ stale: false });
    await expect(productionCabinetReader.loadSupport()).resolves.toMatchObject({ enabled: true });

    mocks.getCurrentUser.mockResolvedValueOnce(null);
    await expect(productionCabinetReader.loadUser()).rejects.toThrow("unauthorized");
  });

  it("builds navigation state and degrades only optional offers", async () => {
    mocks.getCurrentAuthProfile.mockResolvedValue({ user: { email: "u@example.com", emailVerified: false } });
    mocks.remnashopRequest.mockResolvedValueOnce(offers);
    await expect(productionNavigationReader.load()).resolves.toEqual({
      authenticated: true,
      emailVerificationRequired: true,
      hasSubscription: true,
      canRenewSubscription: true,
    });

    mocks.remnashopRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(productionNavigationReader.load()).resolves.toMatchObject({
      authenticated: true,
      hasSubscription: false,
      canRenewSubscription: false,
    });
  });

  it("maps checkout authentication and sync state", async () => {
    mocks.getCurrentAuthProfile.mockResolvedValueOnce({
      user: { email: "u@example.com", is_email_verified: true, account_sync_pending: true },
    });
    await expect(productionCheckoutReader.loadAccount()).resolves.toEqual({
      authenticated: true,
      emailVerified: true,
      accountSyncPending: true,
    });

    mocks.getCurrentAuthProfile.mockRejectedValueOnce({ code: "UNAUTHORIZED" });
    await expect(productionCheckoutReader.loadAccount()).resolves.toEqual({
      authenticated: false,
      emailVerified: false,
      accountSyncPending: false,
    });
    const providerError = new Error("offline");
    mocks.getCurrentAuthProfile.mockRejectedValueOnce(providerError);
    await expect(productionCheckoutReader.loadAccount()).rejects.toBe(providerError);
  });

  it("reads support configuration without exposing the complete environment", () => {
    expect(productionSupportReader.load()).toEqual({ enabled: true, url: "https://support.example" });
  });
});
