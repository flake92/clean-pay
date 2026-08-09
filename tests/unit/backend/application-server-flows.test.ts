import { describe, expect, it, vi } from "vitest";

import { executeAuthCommand } from "@/application/auth/execute-auth-command";
import { completeTelegramCallback } from "@/application/auth/complete-telegram-callback";
import { recoverTelegramSession } from "@/application/auth/recover-telegram-session";
import {
  prepareTelegramAuthStart,
  TelegramAuthStartFailure,
} from "@/application/auth/prepare-telegram-auth-start";
import { confirmEmailVerificationCode, requestEmailVerificationCode } from "@/application/auth/execute-email-verification";
import { linkAccountEmail, removeLinkedPasskey } from "@/application/auth/manage-linked-account";
import { executePayment, loadCheckout } from "@/application/payments/checkout";
import { runPaymentMaintenance } from "@/application/payments/run-payment-maintenance";
import type { AuthCommands } from "@/application/auth/ports/auth-commands";
import { AuthGatewayError } from "@/application/auth/ports/auth-commands";
import type { EmailVerificationCommands } from "@/application/auth/ports/email-verification";
import type { LinkAccountCommands } from "@/application/auth/ports/link-account";
import type { TelegramCallbackGateway } from "@/application/auth/ports/telegram-callback";
import type { TelegramAuthStartSecurity } from "@/application/auth/ports/telegram-auth-start";
import type { CheckoutReader, PaymentCommands } from "@/application/payments/ports/checkout";
import type { PaymentMaintenanceRunner } from "@/application/payments/ports/payment-maintenance";
import { loadSupportViewModel } from "@/application/support/load-support";

function authCommands(overrides: Partial<AuthCommands> = {}): AuthCommands {
  return {
    verifyHuman: vi.fn(async () => undefined),
    rateLimit: vi.fn(async () => undefined),
    identifyEmail: vi.fn(async () => ({ exists: true })),
    hasPasskey: vi.fn(async () => false),
    authenticate: vi.fn(async () => ({ context: {} })),
    establishSession: vi.fn(async () => ({ userId: "user-1", emailVerified: true })),
    requestEmailVerification: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("server application flows", () => {
  it("prepares Telegram auth with authentication-aware failure context", async () => {
    const security: TelegramAuthStartSecurity = {
      loadCurrentUser: vi.fn(async () => ({
        id: "user-1",
        email: "user@example.com",
        telegramId: null,
      })),
      verifyHuman: vi.fn(async () => undefined),
      assertLinkRateLimit: vi.fn(async () => undefined),
    };

    await expect(prepareTelegramAuthStart(security, {
      turnstileToken: "turnstile-token",
    })).resolves.toEqual({ authenticated: true, userId: "user-1" });
    expect(security.verifyHuman).toHaveBeenCalledWith("turnstile-token", "telegram_auth_start");
    expect(security.assertLinkRateLimit).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1" }));

    vi.mocked(security.verifyHuman).mockRejectedValueOnce(new Error("challenge failed"));
    const failure = await prepareTelegramAuthStart(security, { turnstileToken: null })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TelegramAuthStartFailure);
    expect(failure).toMatchObject({ authenticated: true });
  });

  it("runs bounded payment maintenance through one application scenario", async () => {
    const runner: PaymentMaintenanceRunner = {
      reconcile: vi.fn(async () => ({
        claimed: 1,
        succeeded: 1,
        inProgress: 0,
        unknown: 0,
        manualRequired: 0,
        retryReady: 0,
        failed: 0,
        manualRequiredOperationIds: [],
      })),
      continueHistory: vi.fn(async () => ({
        attempted: 1,
        applied: 20,
        completed: 0,
        failed: 0,
      })),
    };

    await expect(runPaymentMaintenance(runner, {
      paymentLimit: 7,
      deadlineMs: 12_000,
    })).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
      history: { attempted: 1, applied: 20 },
    });
    expect(runner.reconcile).toHaveBeenCalledWith({ limit: 7, deadlineMs: 12_000 });
    expect(runner.continueHistory).toHaveBeenCalledWith({ limit: 1, deadlineMs: 12_000 });
  });

  it("owns Telegram callback outcome policy in the application use case", async () => {
    const outcome = {
      redirectTo: "/cabinet",
      session: {
        userId: "user-1",
        requiresTelegramRecovery: false,
      },
      audit: {
        userId: "user-1",
        remnashopLinked: true,
      },
    };
    const gateway: TelegramCallbackGateway = {
      consume: vi.fn(async () => ({
        user: { id: "user-1", upstreamAccountId: null },
        redirectTo: null,
        providerSession: { context: {} },
        linked: false,
        telegramId: "777",
        telegramUsername: null,
        mergeConfirmation: null,
      })),
      providerAccountId: vi.fn(() => "upstream-1"),
      attachTelegramToCurrentAccount: vi.fn(async () => undefined),
      mergeProviderAccounts: vi.fn(async () => true),
      linkProviderSession: vi.fn(async () => outcome.session),
      reconcileProviderSession: vi.fn(async () => outcome.session),
      withOwnerChangeFence: vi.fn(async ({ work }) => work()),
      logAttachFailure: vi.fn(),
    };

    await expect(completeTelegramCallback(gateway, {
      kind: "oidc",
      code: "callback-code",
      state: "callback-state",
    })).resolves.toEqual(outcome);
    expect(gateway.consume).toHaveBeenCalledWith({
      kind: "oidc",
      code: "callback-code",
      state: "callback-state",
    });
    expect(gateway.reconcileProviderSession).toHaveBeenCalledWith({ context: {} });
  });

  it("recovers Telegram sessions through an explicit application port", async () => {
    const recover = vi.fn(async () => undefined);

    await recoverTelegramSession({ recover }, "session-1", "user-1");

    expect(recover).toHaveBeenCalledWith("session-1", "user-1");
  });

  it("loads support through its application port", () => {
    const support = { enabled: true, email: "help@example.com", telegramUsername: null, faqUrl: null };

    expect(loadSupportViewModel({ load: () => support })).toEqual(support);
  });

  it("normalizes identity input and returns a concrete identification result", async () => {
    const commands = authCommands();
    await expect(executeAuthCommand(commands, { kind: "identify", email: " User@Example.COM " })).resolves.toEqual({
      ok: true, kind: "identified", exists: true, hasPasskey: false,
    });
    expect(commands.identifyEmail).toHaveBeenCalledWith("user@example.com");
  });

  it("maps provider auth failures before they reach React", async () => {
    const commands = authCommands({ authenticate: vi.fn(async () => { throw new AuthGatewayError("AUTH_FAILED"); }) });
    await expect(executeAuthCommand(commands, { kind: "login", email: "u@example.com", password: "wrong" })).resolves.toEqual({
      ok: false, code: "AUTH_FAILED", message: "Неверный e-mail или пароль.",
    });
  });

  it("owns registration fallback, session establishment, verification and audit", async () => {
    const providerSession = { context: { token: "provider-session" } };
    const commands = authCommands({
      authenticate: vi.fn()
        .mockRejectedValueOnce(new AuthGatewayError("EMAIL_ALREADY_EXISTS"))
        .mockResolvedValueOnce(providerSession),
      establishSession: vi.fn(async () => ({ userId: "user-1", emailVerified: false })),
    });

    await expect(executeAuthCommand(commands, {
      kind: "register",
      email: "User@Example.com",
      password: "secret123",
    })).resolves.toEqual({
      ok: true,
      kind: "authenticated",
      emailVerified: false,
      verificationRequired: true,
    });
    expect(commands.authenticate).toHaveBeenNthCalledWith(1, {
      operation: "register",
      email: "user@example.com",
      password: "secret123",
    });
    expect(commands.authenticate).toHaveBeenNthCalledWith(2, {
      operation: "login",
      email: "user@example.com",
      password: "secret123",
    });
    expect(commands.requestEmailVerification).toHaveBeenCalledWith(providerSession, "user@example.com");
    expect(commands.audit).toHaveBeenCalledWith({
      action: "auth_register_success",
      userId: "user-1",
      metadata: { flow: "existing_email_login" },
    });
  });

  it("does not request verification for an already verified registration", async () => {
    const commands = authCommands({
      establishSession: vi.fn(async () => ({ userId: "user-1", emailVerified: true })),
    });

    await expect(executeAuthCommand(commands, {
      kind: "register",
      email: "user@example.com",
      password: "secret123",
    })).resolves.toMatchObject({
      ok: true,
      emailVerified: true,
      verificationRequired: false,
    });
    expect(commands.requestEmailVerification).not.toHaveBeenCalled();
  });

  it("owns login session establishment and success audit", async () => {
    const providerSession = { context: { token: "login-session" } };
    const commands = authCommands({ authenticate: vi.fn(async () => providerSession) });

    await expect(executeAuthCommand(commands, {
      kind: "login",
      email: "user@example.com",
      password: "secret123",
    })).resolves.toMatchObject({ ok: true, kind: "authenticated", emailVerified: true });
    expect(commands.establishSession).toHaveBeenCalledWith(providerSession);
    expect(commands.audit).toHaveBeenCalledWith({ action: "auth_login_success", userId: "user-1" });
  });

  it("owns indistinguishable password-reset request policy", async () => {
    const commands = authCommands();

    await expect(executeAuthCommand(commands, {
      kind: "request-password-reset",
      email: "unknown@example.com",
    })).resolves.toEqual({ ok: true, kind: "password-reset-requested" });
    expect(commands.rateLimit).toHaveBeenCalledWith(expect.objectContaining({
      action: "password_reset_start",
      email: "unknown@example.com",
    }));
    expect(commands.requestPasswordReset).toHaveBeenCalledWith("unknown@example.com");
  });

  it("owns password reset security policy and session replacement", async () => {
    const providerSession = { context: { token: "reset-session" } };
    const commands = authCommands({ authenticate: vi.fn(async () => providerSession) });

    await expect(executeAuthCommand(commands, {
      kind: "confirm-password-reset",
      email: "user@example.com",
      code: "123456",
      newPassword: "new-password",
      turnstileToken: "human-token",
    })).resolves.toMatchObject({ ok: true, kind: "authenticated" });
    expect(commands.verifyHuman).toHaveBeenCalledWith("human-token", "auth_login");
    expect(commands.rateLimit).toHaveBeenCalledWith(expect.objectContaining({
      action: "password_reset_confirm",
      email: "user@example.com",
    }));
    expect(commands.establishSession).toHaveBeenCalledWith(providerSession, {
      replaceExistingSessions: true,
      replacementIdentityEmail: "user@example.com",
    });
    expect(commands.audit).toHaveBeenCalledWith({ action: "password_reset_success", userId: "user-1" });
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
