import { describe, expect, it, vi } from "vitest";

import { loadChatwootSupportContext } from "@/application/support/load-chatwoot-context";
import type { ChatwootContextGateway } from "@/application/support/ports/chatwoot-context";

function paymentSnapshot(
  records: Awaited<ReturnType<ChatwootContextGateway["loadRecentPayments"]>>["records"],
  synchronizedAt: string | null = "2026-08-12T11:55:00.000Z",
) {
  return { records, synchronizedAt };
}

function gateway(overrides: Partial<ChatwootContextGateway> = {}): ChatwootContextGateway {
  return {
    loadActor: vi.fn(async () => ({ userId: "user-1" })),
    loadSubscription: vi.fn(async () => ({
      status: "ACTIVE",
      planName: "Premium",
      expiresAt: "2026-09-01T00:00:00.000Z",
      isTrial: false,
    })),
    loadRecentPayments: vi.fn(async () => paymentSnapshot([{
      status: "COMPLETED",
      finalAmount: "299.00",
      currency: "RUB",
      gatewayType: "CARD",
      planName: "Premium",
      createdAt: "2026-08-10T12:00:00.000Z",
    }])),
    ...overrides,
  };
}

describe("Chatwoot support context policy", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");

  it("does not disclose support context without a current actor", async () => {
    const subject = gateway({ loadActor: vi.fn(async () => null) });

    await expect(loadChatwootSupportContext(subject, now)).resolves.toBeNull();
    expect(subject.loadSubscription).not.toHaveBeenCalled();
    expect(subject.loadRecentPayments).not.toHaveBeenCalled();
  });

  it("does not attach context when the browser identity and current session differ", async () => {
    const subject = gateway();

    await expect(
      loadChatwootSupportContext(subject, now, "other-user"),
    ).resolves.toBeNull();
    expect(subject.loadSubscription).not.toHaveBeenCalled();
    expect(subject.loadRecentPayments).not.toHaveBeenCalled();
  });

  it("discards loaded data if the authenticated actor changes during the request", async () => {
    const subject = gateway({
      loadActor: vi.fn()
        .mockResolvedValueOnce({ userId: "user-1" })
        .mockResolvedValueOnce({ userId: "user-2" }),
    });

    await expect(loadChatwootSupportContext(subject, now, "user-1"))
      .resolves.toBeNull();
  });

  it("publishes the current plan and safe payment summary and clears stale labels", async () => {
    await expect(loadChatwootSupportContext(gateway(), now)).resolves.toEqual({
      customAttributes: {
        subscription_context_status: "ready",
        subscription_plan: "Premium",
        subscription_status: "ACTIVE",
        subscription_expires_at: "2026-09-01T00:00:00.000Z",
        subscription_is_trial: "false",
        payment_context_status: "ready",
        last_payment_status: "COMPLETED",
        last_payment_at: "2026-08-10T12:00:00.000Z",
        last_payment_amount: "299.00 RUB",
        last_payment_gateway: "CARD",
        last_payment_plan: "Premium",
        recent_payments: "2026-08-10T12:00:00.000Z | COMPLETED | 299.00 RUB | CARD | Premium",
      },
      managedLabels: [
        { name: "subscription_expired", enabled: false },
        { name: "payment_problem", enabled: false },
      ],
    });
  });

  it("marks an expired subscription and the latest failed payment", async () => {
    const subject = gateway({
      loadSubscription: vi.fn(async () => ({
        status: "ACTIVE",
        planName: "Basic|unsafe\nline",
        expiresAt: "2026-08-01T00:00:00.000Z",
        isTrial: true,
      })),
      loadRecentPayments: vi.fn(async () => paymentSnapshot([{
        status: "FAILED",
        finalAmount: "199",
        currency: "RUB",
        gatewayType: "SBP",
        planName: null,
        createdAt: "2026-08-11T12:00:00.000Z",
      }])),
    });

    const result = await loadChatwootSupportContext(subject, now);

    expect(result?.customAttributes).toMatchObject({
      subscription_plan: "Basic unsafe line",
      subscription_is_trial: "true",
      recent_payments: "2026-08-11T12:00:00.000Z | FAILED | 199 RUB | SBP | без тарифа",
    });
    expect(result?.managedLabels).toEqual([
      { name: "subscription_expired", enabled: true },
      { name: "payment_problem", enabled: true },
    ]);
  });

  it.each([
    ["PENDING", "2026-08-12T11:29:59.000Z", true],
    ["PENDING", "2026-08-12T11:30:01.000Z", false],
    ["UNKNOWN", "2026-08-12T11:59:00.000Z", true],
    ["REFUNDED", "2026-08-12T11:59:00.000Z", false],
  ])("maps latest payment %s at %s to problem=%s", async (status, createdAt, enabled) => {
    const subject = gateway({
      loadRecentPayments: vi.fn(async () => paymentSnapshot([{
        status,
        finalAmount: "100",
        currency: "RUB",
        gatewayType: "CARD",
        planName: "Basic",
        createdAt,
      }])),
    });

    const result = await loadChatwootSupportContext(subject, now);

    expect(result?.managedLabels).toContainEqual({ name: "payment_problem", enabled });
  });

  it("reports partial upstream failure without removing an existing label from stale data", async () => {
    const subject = gateway({
      loadSubscription: vi.fn(async () => { throw new Error("upstream unavailable"); }),
      loadRecentPayments: vi.fn(async () => { throw new Error("database unavailable"); }),
    });

    await expect(loadChatwootSupportContext(subject, now)).resolves.toEqual({
      customAttributes: {
        subscription_context_status: "unavailable",
        payment_context_status: "unavailable",
      },
      managedLabels: [],
    });
  });

  it("does not change the subscription label when the upstream expiry is invalid", async () => {
    const subject = gateway({
      loadSubscription: vi.fn(async () => ({
        status: "ACTIVE",
        planName: "Premium",
        expiresAt: "not-a-date",
        isTrial: false,
      })),
    });

    const result = await loadChatwootSupportContext(subject, now);

    expect(result?.customAttributes).toMatchObject({
      subscription_context_status: "invalid",
      subscription_plan: "Premium",
      subscription_status: "ACTIVE",
      subscription_expires_at: "",
      subscription_is_trial: "false",
    });
    expect(result?.managedLabels).not.toContainEqual({
      name: "subscription_expired",
      enabled: false,
    });
  });

  it("publishes stale payment details without changing a managed payment label", async () => {
    const subject = gateway({
      loadRecentPayments: vi.fn(async () => paymentSnapshot([{
        status: "COMPLETED",
        finalAmount: "299",
        currency: "RUB",
        gatewayType: "CARD",
        planName: "Premium",
        createdAt: "2026-08-12T10:00:00.000Z",
      }], "2026-08-12T11:30:00.000Z")),
    });

    const result = await loadChatwootSupportContext(subject, now);

    expect(result?.customAttributes).toMatchObject({
      payment_context_status: "stale",
      last_payment_status: "COMPLETED",
    });
    expect(result?.managedLabels).not.toContainEqual({
      name: "payment_problem",
      enabled: false,
    });
  });

  it("caps history at five records and handles accounts without subscription or payments", async () => {
    const payments = Array.from({ length: 8 }, (_, index) => ({
      status: "COMPLETED",
      finalAmount: String(100 + index),
      currency: "RUB",
      gatewayType: "CARD",
      planName: "Basic",
      createdAt: `2026-08-${String(10 - index).padStart(2, "0")}T12:00:00.000Z`,
    }));
    const subject = gateway({
      loadSubscription: vi.fn(async () => null),
      loadRecentPayments: vi.fn(async () => paymentSnapshot(payments)),
    });

    const result = await loadChatwootSupportContext(subject, now);

    expect(result?.customAttributes.subscription_status).toBe("none");
    expect(result?.customAttributes.recent_payments.split("\n")).toHaveLength(5);
    expect(result?.managedLabels).toContainEqual({ name: "subscription_expired", enabled: false });

    const empty = await loadChatwootSupportContext(gateway({
      loadSubscription: vi.fn(async () => null),
      loadRecentPayments: vi.fn(async () => paymentSnapshot([])),
    }), now);
    expect(empty?.customAttributes).toMatchObject({
      last_payment_status: "none",
      recent_payments: "",
    });
    expect(empty?.managedLabels).toContainEqual({ name: "payment_problem", enabled: false });
  });
});
