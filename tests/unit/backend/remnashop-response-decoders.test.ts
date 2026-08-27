import { describe, expect, it } from "vitest";

import {
  decodeRemnashopEndpointResponse,
  decodeRemnashopSubscriptionIdentity,
} from "@/backend/integrations/remnashop/response-decoders";

describe("Remnashop response decoders", () => {
  it("projects the partial subscription identity contract and rejects malformed identities", () => {
    expect(decodeRemnashopSubscriptionIdentity({
      user_remna_id: "rw-1",
      status: "ACTIVE",
      provider_secret: "must-not-project",
    })).toEqual({ user_remna_id: "rw-1" });
    expect(decodeRemnashopSubscriptionIdentity(null)).toBeNull();

    for (const malformed of [
      {},
      { user_remna_id: null },
      { user_remna_id: 42 },
      { user_remna_id: "" },
      { user_remna_id: "   " },
      "rw-1",
    ]) {
      expect(() => decodeRemnashopSubscriptionIdentity(malformed)).toThrow();
    }
  });

  it("projects auth and profile contracts without provider-only fields", () => {
    expect(decodeRemnashopEndpointResponse("/auth/login", "POST", {
      expires_at: "2026-09-01T00:00:00.000Z",
      refresh_expires_at: "2026-10-01T00:00:00.000Z",
      access_token: "must-not-project",
    })).toEqual({
      expires_at: "2026-09-01T00:00:00.000Z",
      refresh_expires_at: "2026-10-01T00:00:00.000Z",
    });

    expect(decodeRemnashopEndpointResponse("/auth/me", "GET", {
      telegram_id: 777,
      auth_type: "telegram",
      email: "user@example.com",
      is_email_verified: true,
      pending_email: null,
      name: "User",
      username: null,
      language: "ru",
      has_password: false,
      provider_secret: "must-not-project",
    })).toEqual({
      telegram_id: 777,
      auth_type: "telegram",
      email: "user@example.com",
      is_email_verified: true,
      pending_email: null,
      name: "User",
      username: null,
      language: "ru",
      has_password: false,
    });
  });

  it("deep-equals valid subscription and payment contracts after nested projection", () => {
    const expectedCurrent = {
      user_remna_id: "rw-1",
      status: "ACTIVE",
      is_trial: false,
      traffic_limit: 100,
      device_limit: 3,
      traffic_limit_strategy: "NO_RESET",
      expire_at: "2026-09-01T00:00:00.000Z",
      url: "https://subscription.example/rw-1",
      plan_name: "Basic",
      plan_duration_days: 30,
      used_traffic_bytes: 10,
      lifetime_used_traffic_bytes: null,
      online_at: null,
    };
    expect(decodeRemnashopEndpointResponse("/subscription/current", "GET", {
      ...expectedCurrent,
      provider_secret: "must-not-project",
    })).toEqual(expectedCurrent);
    expect(decodeRemnashopEndpointResponse(
      "/subscription/current",
      "GET",
      null,
    )).toBeNull();

    const expectedOffers = {
      gateways: [{ gateway_type: "CARD", currency: "RUB", currency_symbol: "₽" }],
      plans: [{
        id: 1,
        public_code: "basic",
        name: "Basic",
        description: null,
        traffic_limit: 100,
        device_limit: 3,
        type: "PAID",
        recommended_purchase_type: "PURCHASE",
        renewal_terms_changed: false,
        durations: [{
          days: 30,
          prices: [{
            gateway_type: "CARD",
            currency: "RUB",
            currency_symbol: "₽",
            original_amount: "299.00",
            discount_percent: 0,
            final_amount: "299.00",
            is_free: false,
          }],
        }],
      }],
      has_current_subscription: false,
      current_subscription_status: null,
    };
    const upstreamOffers = structuredClone(expectedOffers) as typeof expectedOffers & {
      provider_extra?: string;
    };
    upstreamOffers.provider_extra = "must-not-project";
    Object.assign(upstreamOffers.plans[0]!, { internal_plan_id: "must-not-project" });
    Object.assign(upstreamOffers.plans[0]!.durations[0]!.prices[0]!, {
      provider_signature: "must-not-project",
    });

    expect(decodeRemnashopEndpointResponse(
      "/subscription/offers",
      "GET",
      upstreamOffers,
    )).toEqual(expectedOffers);

    expect(decodeRemnashopEndpointResponse("/subscription/purchase", "POST", {
      payment_id: "payment-1",
      payment_url: "https://pay.example/checkout",
      purchase_type: "PURCHASE",
      status: "PENDING",
      is_free: false,
      final_amount: "299.00",
      currency: "RUB",
      return_url: "https://app.example/payment/operation-1",
      gateway_payload: { token: "must-not-project" },
    })).toEqual({
      payment_id: "payment-1",
      payment_url: "https://pay.example/checkout",
      purchase_type: "PURCHASE",
      status: "PENDING",
      is_free: false,
      final_amount: "299.00",
      currency: "RUB",
      return_url: "https://app.example/payment/operation-1",
    });
  });

  it("projects device and referral contracts and rejects malformed schemas", () => {
    expect(decodeRemnashopEndpointResponse("/subscription/devices", "GET", {
      devices: [{
        hwid: "device-1",
        platform: "ios",
        device_model: null,
        os_version: "18",
        user_agent: null,
        provider_fingerprint: "must-not-project",
      }],
      current_count: 1,
      max_count: 3,
      provider_extra: true,
    })).toEqual({
      devices: [{
        hwid: "device-1",
        platform: "ios",
        device_model: null,
        os_version: "18",
        user_agent: null,
      }],
      current_count: 1,
      max_count: 3,
    });

    expect(decodeRemnashopEndpointResponse("/referral/program", "GET", {
      enabled: true,
      referral_code: "Friend42",
      web_referral_url: "https://app.example/invite/Friend42",
      invited_count: 4,
      invited_with_payment_count: 2,
      points_balance: 75,
      total_points_issued: 100,
      total_days_issued: 0,
      reward_type: "POINTS",
      reward_strategy: "AMOUNT",
      accrual_strategy: "ON_FIRST_PAYMENT",
      max_level: 1,
      reward_levels: [{ level: 1, value: 25, internal_id: "must-not-project" }],
      provider_extra: true,
    })).toEqual({
      enabled: true,
      referral_code: "Friend42",
      web_referral_url: "https://app.example/invite/Friend42",
      invited_count: 4,
      invited_with_payment_count: 2,
      points_balance: 75,
      total_points_issued: 100,
      total_days_issued: 0,
      reward_type: "POINTS",
      reward_strategy: "AMOUNT",
      accrual_strategy: "ON_FIRST_PAYMENT",
      max_level: 1,
      reward_levels: [{ level: 1, value: 25 }],
    });

    expect(() => decodeRemnashopEndpointResponse("/auth/me", "GET", {
      telegram_id: "777",
    })).toThrow("telegram_id must be a finite number or null");
  });

  it("projects merge counters and non-empty conflicts without provider fields", () => {
    expect(decodeRemnashopEndpointResponse("/users/merge?dry_run=true", "POST", {
      dry_run: true,
      source_user_id: 10,
      target_user_id: 20,
      target: {
        id: 20,
        email: "owner@example.com",
        telegram_id: null,
        is_email_verified: true,
        current_subscription_id: null,
        provider_extra: "must-not-project",
      },
      moved: { sessions: 2 },
      conflicts: ["active payment operations"],
      requires_relogin: true,
      provider_extra: "must-not-project",
    })).toEqual({
      dry_run: true,
      source_user_id: 10,
      target_user_id: 20,
      target: {
        id: 20,
        email: "owner@example.com",
        telegram_id: null,
        is_email_verified: true,
        current_subscription_id: null,
      },
      moved: { sessions: 2 },
      conflicts: ["active payment operations"],
      requires_relogin: true,
    });
  });
});
