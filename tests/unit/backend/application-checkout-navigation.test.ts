import { describe, expect, it, vi } from "vitest";

import { executePayment, loadCheckout } from "@/application/payments/checkout";
import { loadNavigationShell } from "@/application/navigation/load-navigation";
import type { AuthProfileGateway, AuthProfileSession } from "@/application/auth/ports/auth-profile";
import type { CheckoutReader, PaymentCommands } from "@/application/payments/ports/checkout";

function session(overrides: Partial<AuthProfileSession["user"]> = {}): AuthProfileSession {
  return {
    context: {}, id: "session-1", userId: "user-1", authMethod: "EMAIL", hasUpstreamTokens: false,
    user: {
      email: "user@example.com", emailVerified: true, telegramId: null, telegramUsername: null,
      fullName: null, displayName: null, upstreamUserId: null, pendingUpstreamUserId: null,
      pendingEmail: null, accountSyncPending: false, ...overrides,
    },
  };
}

function auth(value: AuthProfileSession | null = session()): AuthProfileGateway {
  return {
    loadCurrentSession: vi.fn(async () => value), authorizeCurrentSession: vi.fn(), loadProviderProfile: vi.fn(),
    confirmVerifiedEmail: vi.fn(), refreshCurrentAccess: vi.fn(), debug: vi.fn(),
  } as unknown as AuthProfileGateway;
}

const reader: CheckoutReader = { loadOffers: vi.fn(async () => ({ gateways: [], plans: [], has_current_subscription: false, current_subscription_status: null })) };
const request = { plan_code: "basic", duration_days: 30, gateway_type: "CARD" } as never;

describe("checkout and navigation application policy", () => {
  it("keeps checkout blocked while account synchronization is pending", async () => {
    await expect(loadCheckout(reader, auth(session({ accountSyncPending: true })))).resolves.toMatchObject({
      status: "account-action-required", action: "verifyEmail",
    });
    expect(reader.loadOffers).not.toHaveBeenCalled();
  });

  it("requires a verified e-mail before loading offers", async () => {
    await expect(loadCheckout(reader, auth(session({ emailVerified: false })))).resolves.toMatchObject({
      status: "account-action-required", action: "linkEmail",
    });
  });

  it("loads offers only for an eligible account", async () => {
    await expect(loadCheckout(reader, auth())).resolves.toMatchObject({ status: "ready", offers: { plans: [] } });
    expect(reader.loadOffers).toHaveBeenCalled();
  });

  it("maps a missing session to login and hides unexpected failures", async () => {
    await expect(loadCheckout(reader, auth(null))).resolves.toMatchObject({ status: "account-action-required", action: "login" });
    const broken = auth();
    vi.mocked(broken.loadCurrentSession).mockRejectedValueOnce(new Error("database detail"));
    await expect(loadCheckout(reader, broken)).resolves.toMatchObject({ status: "error" });
  });

  it("refuses payment commands without an idempotency key", async () => {
    const commands = { purchase: vi.fn(), extend: vi.fn() } as unknown as PaymentCommands;
    await expect(executePayment(commands, { kind: "purchase", request, idempotencyKey: "" })).resolves.toMatchObject({
      ok: false, code: "IDEMPOTENCY_KEY_REQUIRED", retainIdempotencyKey: false,
    });
    expect(commands.purchase).not.toHaveBeenCalled();
  });

  it("dispatches purchase and extension through their dedicated ports", async () => {
    const result = { status: "pending" as const, operationId: "operation-1", retryAfterSeconds: 5 };
    const commands = { purchase: vi.fn(async () => result), extend: vi.fn(async () => result) } as unknown as PaymentCommands;
    await expect(executePayment(commands, { kind: "purchase", request, idempotencyKey: "key-1" })).resolves.toEqual({ ok: true, ...result });
    await expect(executePayment(commands, { kind: "extend", request, idempotencyKey: "key-2" })).resolves.toEqual({ ok: true, ...result });
    expect(commands.purchase).toHaveBeenCalledWith(request, "key-1");
    expect(commands.extend).toHaveBeenCalledWith(request, "key-2");
  });

  it.each([
    ["OFFER_CHANGED", false], ["PLAN_UNAVAILABLE", false], ["PAYMENT_GATEWAY_UNAVAILABLE", false],
    ["IDEMPOTENCY_KEY_REUSED", false], ["VALIDATION_ERROR", false],
    ["EMAIL_REQUIRED", true], ["EMAIL_NOT_VERIFIED", true], ["RATE_LIMITED", true],
    ["UPSTREAM_UNAVAILABLE", true],
  ])("maps payment failure %s and key retention=%s", async (code, retainIdempotencyKey) => {
    const commands = {
      purchase: vi.fn(async () => { throw Object.assign(new Error("private detail"), { code }); }), extend: vi.fn(),
    } as unknown as PaymentCommands;
    await expect(executePayment(commands, { kind: "purchase", request, idempotencyKey: "key-1" })).resolves.toMatchObject({
      ok: false, code, retainIdempotencyKey,
    });
  });

  it("uses a generic retryable result for untyped failures", async () => {
    const commands = { purchase: vi.fn(async () => { throw new Error("private detail"); }), extend: vi.fn() } as unknown as PaymentCommands;
    await expect(executePayment(commands, { kind: "purchase", request, idempotencyKey: "key-1" })).resolves.toMatchObject({
      ok: false, code: "INTERNAL_ERROR", retainIdempotencyKey: true,
    });
  });

  it("builds authenticated and guest navigation without upstream calls", async () => {
    await expect(loadNavigationShell(auth(session({ emailVerified: false })))).resolves.toEqual({
      navigation: {
        authenticated: true, emailVerificationRequired: true, hasSubscription: false, canRenewSubscription: false,
      },
      supportIdentity: {
        userId: "user-1", email: "user@example.com", emailVerified: false,
        telegramId: null, telegramUsername: null, fullName: null, displayName: null,
      },
    });
    await expect(loadNavigationShell(auth(null))).resolves.toEqual({
      navigation: {
        authenticated: false, emailVerificationRequired: false, hasSubscription: false, canRenewSubscription: false,
      },
      supportIdentity: null,
    });
    const broken = auth();
    vi.mocked(broken.loadCurrentSession).mockRejectedValueOnce(new Error("offline"));
    await expect(loadNavigationShell(broken)).resolves.toEqual({
      navigation: {
        authenticated: false, emailVerificationRequired: false, hasSubscription: false, canRenewSubscription: false,
      },
      supportIdentity: null,
    });
  });
});
