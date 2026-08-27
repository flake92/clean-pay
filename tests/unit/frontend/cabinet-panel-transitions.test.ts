import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CabinetViewModel } from "@/application/models/cabinet";
import {
  beginCabinetPendingAction,
  canScheduleCabinetPaymentHistoryRefresh,
  finishCabinetPendingAction,
  normalizeCabinetPromocode,
  selectCabinetPanelData,
  selectCabinetPanelPresentation,
  shouldRefreshCabinetAfterAction,
} from "@/frontend/components/cabinet-panel-transitions";

function readyModel(): Extract<CabinetViewModel, { status: "ready" }> {
  return {
    status: "ready",
    user: {
      email: "user@example.com",
      emailVerified: false,
      is_email_verified: true,
      telegramId: "777",
    },
    subscription: {
      user_remna_id: "subscription-user",
      status: "active",
      is_trial: false,
      traffic_limit: 100,
      device_limit: 3,
      traffic_limit_strategy: "NO_RESET",
      expire_at: "2026-08-29T00:00:00.000Z",
      url: "https://subscription.example.com/example",
      plan_name: "Standard",
      plan_duration_days: 30,
      used_traffic_bytes: 150,
      lifetime_used_traffic_bytes: 200,
      online_at: null,
    },
    subscriptionError: "subscription unavailable",
    offers: {
      gateways: [],
      plans: [],
      has_current_subscription: true,
      current_subscription_status: "ACTIVE",
    },
    devices: { devices: [], current_count: 2, max_count: 7 },
    payments: [],
    paymentHistoryStatus: "refreshing",
    support: {
      enabled: true,
      email: "support@example.com",
      telegramUsername: null,
      faqUrl: null,
      liveChatEnabled: false,
    },
  };
}

describe("cabinet panel pure transitions", () => {
  it("maps ready data without changing values or object identity", () => {
    const model = readyModel();
    const selected = selectCabinetPanelData(model);

    expect(selected).toEqual({
      user: model.user,
      subscription: model.subscription,
      offers: model.offers,
      devices: model.devices,
      payments: model.payments,
      paymentHistoryStatus: model.paymentHistoryStatus,
      support: model.support,
      error: null,
      subscriptionError: model.subscriptionError,
    });
    expect(selected.user).toBe(model.user);
    expect(selected.subscription).toBe(model.subscription);
    expect(selected.payments).toBe(model.payments);
  });

  it("preserves the non-ready defaults and error message", () => {
    expect(selectCabinetPanelData({ status: "unauthorized" })).toEqual({
      user: null,
      subscription: null,
      offers: null,
      devices: null,
      payments: [],
      paymentHistoryStatus: "current",
      support: null,
      error: null,
      subscriptionError: null,
    });
    expect(
      selectCabinetPanelData({ status: "error", message: "provider failed" }),
    ).toEqual({
      user: null,
      subscription: null,
      offers: null,
      devices: null,
      payments: [],
      paymentHistoryStatus: "current",
      support: null,
      error: "provider failed",
      subscriptionError: null,
    });
  });

  it("derives the existing bounded traffic, device, and account flags", () => {
    const selected = selectCabinetPanelData(readyModel());

    expect(selectCabinetPanelPresentation(selected)).toEqual({
      usedTraffic: 150,
      usagePercent: 100,
      deviceCount: 2,
      maxDevices: 7,
      hasEmail: true,
      isEmailVerified: false,
      shouldShowVerifyEmail: true,
      shouldShowLinkAccount: false,
    });
  });

  it("keeps pending actions atomic and refreshes only the completed action", () => {
    expect(beginCabinetPendingAction(null, "delete-device-1")).toEqual({
      accepted: true,
      pendingAction: "delete-device-1",
    });
    expect(
      beginCabinetPendingAction("delete-device-1", "delete-device-2"),
    ).toEqual({ accepted: false, pendingAction: "delete-device-1" });
    expect(
      finishCabinetPendingAction("delete-device-1", "delete-device-2"),
    ).toBe("delete-device-1");
    expect(
      finishCabinetPendingAction("delete-device-1", "delete-device-1"),
    ).toBeNull();
  });

  it("preserves the refresh budget, promocode normalization, and success gate", () => {
    expect(canScheduleCabinetPaymentHistoryRefresh(3)).toBe(true);
    expect(canScheduleCabinetPaymentHistoryRefresh(4)).toBe(false);
    expect(normalizeCabinetPromocode("  WELCOME-2026  ")).toBe(
      "WELCOME-2026",
    );
    expect(shouldRefreshCabinetAfterAction("success")).toBe(true);
    expect(shouldRefreshCabinetAfterAction("error")).toBe(false);
  });

  it("keeps CabinetPanel as the facade's only runtime export", () => {
    const source = readFileSync(
      "src/frontend/components/cabinet-panel.tsx",
      "utf8",
    );
    const runtimeExports = Array.from(
      source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm),
      (match) => match[1],
    );

    expect(runtimeExports).toEqual(["CabinetPanel"]);
  });
});
