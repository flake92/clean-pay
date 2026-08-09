import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  remnashopRequest: vi.fn(),
  getLiveRemnawaveSubscriptionUrl: vi.fn(),
}));

vi.mock("@/backend/config/env", () => ({ getEnv: mocks.getEnv }));
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
    mocks.remnashopRequest
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(offers)
      .mockResolvedValueOnce({ devices: [] });

    await expect(productionCabinetReader.loadSubscription()).resolves.toBeNull();
    await expect(productionCabinetReader.loadOffers()).resolves.toBe(offers);
    await expect(productionCabinetReader.loadDevices()).resolves.toEqual({ devices: [] });
    await expect(productionCabinetReader.loadSupport()).resolves.toMatchObject({ enabled: true });
  });

  it("loads navigation offers without owning navigation policy", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce(offers);
    await expect(productionNavigationReader.loadOffers()).resolves.toBe(offers);

    mocks.remnashopRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(productionNavigationReader.loadOffers()).rejects.toThrow("offline");
  });

  it("loads checkout offers without owning account policy", async () => {
    mocks.remnashopRequest.mockResolvedValueOnce(offers);
    await expect(productionCheckoutReader.loadOffers()).resolves.toBe(offers);
  });

  it("reads support configuration without exposing the complete environment", () => {
    expect(productionSupportReader.load()).toEqual({ enabled: true, url: "https://support.example" });
  });
});
