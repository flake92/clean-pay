import { describe, expect, it, vi } from "vitest";

import { executeAuthCommand } from "@/backend/application/auth/execute-auth-command";
import { confirmEmailVerificationCode, requestEmailVerificationCode } from "@/backend/application/auth/execute-email-verification";
import { linkAccountEmail, removeLinkedPasskey } from "@/backend/application/auth/manage-linked-account";
import { executePayment, loadCheckout } from "@/backend/application/payments/checkout";
import type { AuthCommands } from "@/backend/application/auth/ports/auth-commands";
import type { EmailVerificationCommands } from "@/backend/application/auth/ports/email-verification";
import type { LinkAccountCommands } from "@/backend/application/auth/ports/link-account";
import type { CheckoutReader, PaymentCommands } from "@/backend/application/payments/ports/checkout";
import { loadSupportViewModel } from "@/backend/application/support/load-support";

function authCommands(overrides: Partial<AuthCommands> = {}): AuthCommands {
  return {
    identify: vi.fn(async () => ({ exists: true, hasPasskey: false })),
    login: vi.fn(async () => undefined),
    register: vi.fn(async () => ({ emailVerified: false, verificationRequired: true })),
    requestPasswordReset: vi.fn(async () => undefined),
    confirmPasswordReset: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("server application flows", () => {
  it("loads support through its application port", () => {
    const support = { enabled: true, email: "help@example.com", telegramUsername: null, faqUrl: null };

    expect(loadSupportViewModel({ load: () => support })).toEqual(support);
  });

  it("normalizes identity input and returns a concrete identification result", async () => {
    const commands = authCommands();
    await expect(executeAuthCommand(commands, { kind: "identify", email: " User@Example.COM " })).resolves.toEqual({
      ok: true, kind: "identified", exists: true, hasPasskey: false,
    });
    expect(commands.identify).toHaveBeenCalledWith({ email: "user@example.com" });
  });

  it("maps provider auth failures before they reach React", async () => {
    const commands = authCommands({ login: vi.fn(async () => { throw Object.assign(new Error(), { code: "AUTH_FAILED" }); }) });
    await expect(executeAuthCommand(commands, { kind: "login", email: "u@example.com", password: "wrong" })).resolves.toEqual({
      ok: false, code: "AUTH_FAILED", message: "Неверный e-mail или пароль.",
    });
  });

  it("returns explicit e-mail verification outcomes", async () => {
    const commands: EmailVerificationCommands = {
      requestCode: vi.fn(async () => ({ targetEmail: "u@example.com" })),
      confirmCode: vi.fn(async () => ({ accountSyncPending: true })),
      checkReadiness: vi.fn(async () => ({ status: "pending" as const, emailVerified: true })),
    };
    await expect(requestEmailVerificationCode(commands, {})).resolves.toEqual({ ok: true, kind: "code-sent", targetEmail: "u@example.com" });
    await expect(confirmEmailVerificationCode(commands, { code: "123456" })).resolves.toEqual({
      ok: true, kind: "confirmed", readiness: { status: "pending", emailVerified: true },
    });
  });

  it("keeps linked-account commands behind a port", async () => {
    const commands: LinkAccountCommands = {
      linkEmail: vi.fn(async () => ({ linked: false })),
      confirmTelegramMerge: vi.fn(async () => undefined),
      cancelTelegramMerge: vi.fn(async () => undefined),
      deletePasskey: vi.fn(async () => undefined),
    };
    await expect(linkAccountEmail(commands, { email: " U@Example.com ", password: "secret123" })).resolves.toEqual({ ok: true, kind: "verification-required" });
    expect(commands.linkEmail).toHaveBeenCalledWith({ email: "u@example.com", password: "secret123" });
    await expect(removeLinkedPasskey(commands, "credential-id")).resolves.toEqual({ ok: true, kind: "passkey-deleted" });
  });

  it("blocks checkout before loading offers when the account is not ready", async () => {
    const reader: CheckoutReader = {
      loadAccount: vi.fn(async () => ({ authenticated: true, emailVerified: false, accountSyncPending: false })),
      loadOffers: vi.fn(),
    };
    await expect(loadCheckout(reader)).resolves.toMatchObject({ status: "account-action-required", action: "linkEmail" });
    expect(reader.loadOffers).not.toHaveBeenCalled();
  });

  it("returns typed payment states and retains the idempotency key on uncertain failures", async () => {
    const request = { duration_days: 30, gateway_type: "CARD", confirmed_amount: "100", confirmed_currency: "RUB", offer_version: "v1" };
    const commands: PaymentCommands = {
      purchase: vi.fn(),
      extend: vi.fn(async () => ({ status: "pending" as const, operationId: "op-1", retryAfterSeconds: 5 })),
    };
    await expect(executePayment(commands, { kind: "extend", request, idempotencyKey: "key-1" })).resolves.toEqual({
      ok: true, status: "pending", operationId: "op-1", retryAfterSeconds: 5,
    });
    commands.extend = vi.fn(async () => { throw Object.assign(new Error(), { code: "UPSTREAM_UNAVAILABLE" }); });
    await expect(executePayment(commands, { kind: "extend", request, idempotencyKey: "key-1" })).resolves.toMatchObject({
      ok: false, code: "UPSTREAM_UNAVAILABLE", retainIdempotencyKey: true,
    });
  });
});
