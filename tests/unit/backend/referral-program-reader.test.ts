import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  remnashopRequest: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.authorize,
  remnashopRequest: mocks.remnashopRequest,
}));

import { ReferralProgramAccessError } from "@/application/referral/ports/referral-program-reader";
import { ServiceError } from "@/backend/errors/service-error";
import { createReferralProgramReader } from "@/backend/integrations/referral/referral-program-reader";

const response = {
  enabled: true,
  referral_code: "Friend42",
  web_referral_url: "https://pay.example.com/invite/Friend42",
  invited_count: 4,
  invited_with_payment_count: 2,
  points_balance: 75,
  total_points_issued: 100,
  total_days_issued: 0,
  reward_type: "POINTS",
  reward_strategy: "AMOUNT",
  accrual_strategy: "ON_FIRST_PAYMENT",
  max_level: 2,
  reward_levels: [
    { level: 2, value: 10 },
    { level: 1, value: 25 },
  ],
};

describe("Remnashop referral program reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ accessToken: "access-token" });
    mocks.remnashopRequest.mockResolvedValue(response);
  });

  it("loads /referral/program through an authorized, typed boundary", async () => {
    const reader = createReferralProgramReader(
      mocks.authorize,
      "https://pay.example.com",
    );

    await expect(reader.loadProgram()).resolves.toEqual({
      enabled: true,
      referralCode: "Friend42",
      webReferralUrl: "https://pay.example.com/invite/Friend42",
      invitedCount: 4,
      invitedWithPaymentCount: 2,
      pointsBalance: 75,
      totalPointsIssued: 100,
      totalDaysIssued: 0,
      rewardType: "POINTS",
      rewardStrategy: "AMOUNT",
      accrualStrategy: "ON_FIRST_PAYMENT",
      maxLevel: 2,
      rewardLevels: [
        { level: 1, value: 25 },
        { level: 2, value: 10 },
      ],
    });
    expect(mocks.remnashopRequest).toHaveBeenCalledWith(
      "/referral/program",
      { accessToken: "access-token" },
    );
  });

  it.each([
    ["wrong origin", "https://evil.example/invite/Friend42"],
    ["wrong code", "https://pay.example.com/invite/Other42"],
    ["credentials", "https://user:pass@pay.example.com/invite/Friend42"],
    ["query", "https://pay.example.com/invite/Friend42?next=evil"],
    ["fragment", "https://pay.example.com/invite/Friend42#share"],
    ["nested path", "https://pay.example.com/app/invite/Friend42"],
    ["surrounding whitespace", " https://pay.example.com/invite/Friend42 "],
  ])("rejects a %s in web_referral_url", async (_case, webReferralUrl) => {
    mocks.remnashopRequest.mockResolvedValueOnce({
      ...response,
      web_referral_url: webReferralUrl,
    });
    const reader = createReferralProgramReader(mocks.authorize, "https://pay.example.com");

    await expect(reader.loadProgram()).rejects.toMatchObject({ reason: "unavailable" });
  });

  it.each([
    ["missing issued totals", { ...response, total_days_issued: undefined }],
    ["unknown reward type", { ...response, reward_type: "COINS" }],
    ["duplicate levels", { ...response, reward_levels: [{ level: 1, value: 25 }, { level: 1, value: 10 }] }],
    ["negative count", { ...response, invited_count: -1 }],
  ])("rejects malformed program data: %s", async (_case, malformed) => {
    mocks.remnashopRequest.mockResolvedValueOnce(malformed);
    const reader = createReferralProgramReader(mocks.authorize, "https://pay.example.com");

    await expect(reader.loadProgram()).rejects.toBeInstanceOf(ReferralProgramAccessError);
  });

  it.each([
    [new ServiceError("UNAUTHORIZED", 401), "unauthorized"],
    [new ServiceError("PROVIDER_SESSION_RECOVERY_REQUIRED", 409), "provider-session-recovery-required"],
    [new ServiceError("EMAIL_NOT_VERIFIED", 403), "email-required"],
    [new ServiceError("FORBIDDEN", 403, "Referral program is available only for users with active subscription", { message: "active subscription required" }), "subscription-required"],
    [new ServiceError("FORBIDDEN", 403, "Referral program is disabled", { message: "program disabled" }), "disabled"],
  ])("maps provider access errors to %s", async (failure, reason) => {
    mocks.authorize.mockRejectedValueOnce(failure);
    const reader = createReferralProgramReader(mocks.authorize, "https://pay.example.com");

    await expect(reader.loadProgram()).rejects.toMatchObject({ reason });
  });
});
