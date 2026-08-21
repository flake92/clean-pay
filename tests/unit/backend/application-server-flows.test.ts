import { describe, expect, it, vi } from "vitest";

import { executeAuthCommand } from "@/application/auth/execute-auth-command";
import { completeTelegramCallback } from "@/application/auth/complete-telegram-callback";
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
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";
import type { PasskeyManagementGateway } from "@/application/auth/ports/passkey-management";
import { loadSupportViewModel } from "@/application/support/load-support";

function authCommands(overrides: Partial<AuthCommands> = {}): AuthCommands {
  return {
    preflightCapacity: vi.fn(async () => undefined),
    withUpstreamConcurrency: vi.fn(async (_action, work) => work()),
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

function linkCommands(overrides: Partial<LinkAccountCommands> = {}): LinkAccountCommands {
  return {
    loadLinkActor: vi.fn(async () => ({ context: {}, userId: "user-1", email: null, emailVerified: false, telegramId: null, telegramUsername: null, upstreamAccountId: null, fullAssurance: true })),
    assertLinkRateLimit: vi.fn(async () => undefined), authenticateEmail: vi.fn(async () => ({ context: {} })),
    linkActorIsCurrent: vi.fn(async () => true), loadProviderProfile: vi.fn(async () => ({ email: null, emailVerified: false })),
    providerAccountId: vi.fn(() => "upstream-1"), telegramProviderSession: vi.fn(async () => ({ context: {} })),
    attachTelegram: vi.fn(async () => undefined), mergeProviderAccounts: vi.fn(async () => undefined),
    refreshTelegramProviderSession: vi.fn(async () => ({ context: {} })), linkCurrentAccount: vi.fn(async () => ({ userId: "user-1" })),
    withOwnerChangeFence: vi.fn(async ({ work }) => work()), emailOwnerId: vi.fn(async () => null),
    stagePendingEmail: vi.fn(async () => undefined), requestProviderVerification: vi.fn(async (_session, email) => ({ targetEmail: email })),
    auditLinkEvent: vi.fn(async () => undefined), ...overrides,
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
    let now = 1_000;
    const runner: PaymentMaintenanceRunner = {
      claimReconciliation: vi.fn()
        .mockResolvedValueOnce({ context: {}, operationId: "op-1", ownerMatches: true, failureCount: 0 })
        .mockResolvedValueOnce(null),
      recoverPayment: vi.fn(async () => ({ context: {}, state: "SUCCEEDED" as const, retryAfterSeconds: null })),
      completeRecoveredPayment: vi.fn(async () => undefined), resetMissingPayment: vi.fn(async () => undefined),
      releaseReconciliation: vi.fn(async () => undefined), markReconciliationManual: vi.fn(async () => undefined),
      failReconciliation: vi.fn(async () => "released" as const), classifyReconciliationError: vi.fn(() => ({ kind: "other" as const })),
      listHistoryCandidates: vi.fn(async () => [{ userId: "user-1", upstreamAccountId: "upstream-1" }]),
      claimHistory: vi.fn(async () => ({ context: {}, cursor: null })),
      authorizeHistory: vi.fn(async () => ({ context: {} })),
      historyPageSize: vi.fn(async () => 100),
      findPendingHistoryPaymentIds: vi.fn(async () => []),
      loadExactHistoryPayment: vi.fn(async () => null),
      persistExactHistoryPayment: vi.fn(async () => undefined),
      loadLegacyHistory: vi.fn(async () => ({ context: {} })),
      loadHistoryPage: vi.fn(async () => ({ context: {} })),
      completeHistoryPage: vi.fn(async () => ({ applied: 20, hasMore: true })),
      classifyHistoryError: vi.fn(() => ({ kind: "unexpected" as const })),
      deferHistory: vi.fn(async () => undefined),
      failHistory: vi.fn(async () => undefined),
      now: vi.fn(() => now++),
    };

    await expect(runPaymentMaintenance(runner, {
      paymentLimit: 7,
      deadlineMs: 12_000,
    })).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
      history: { attempted: 1, applied: 20 },
    });
    expect(runner.completeRecoveredPayment).toHaveBeenCalledOnce();
    expect(runner.listHistoryCandidates).toHaveBeenCalledWith(20);
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
        authState: { id: "state-1", targetUserId: null, redirectTo: null },
        identity: { telegramId: "777", telegramUsername: null, fullName: null, photoUrl: null, providerSession: { context: {} } },
      })),
      assertIdentityRateLimit: vi.fn(async () => undefined),
      findUserByTelegramId: vi.fn(async () => null),
      findUserById: vi.fn(async () => null),
      loadProviderMergeIdentity: vi.fn(async () => ({ accountId: "upstream-1", email: "u@example.com", emailVerified: true, pendingEmail: null, telegramId: "777" })),
      preflightAccountMerge: vi.fn(),
      persistAccountMergeConfirmation: vi.fn(async () => ({ token: "merge-token" })),
      applyTelegramIdentity: vi.fn(async () => ({ id: "user-1", upstreamAccountId: null, email: null, emailVerified: false, telegramId: "777" })),
      markAuthStateUser: vi.fn(async () => undefined),
      auditIdentityResolved: vi.fn(async () => undefined),
      clearTemporaryAuth: vi.fn(async () => undefined),
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

  it("stages replacement of an existing Telegram and ignores a superseded pending source e-mail", async () => {
    const persist = vi.fn(async () => ({ token: "merge-token" }));
    const gateway: TelegramCallbackGateway = {
      consume: vi.fn(async () => ({
        authState: { id: "state-1", targetUserId: "target-local", redirectTo: "/cabinet" },
        identity: { telegramId: "777", telegramUsername: "selected", fullName: null, photoUrl: null, providerSession: { context: {} } },
      })),
      assertIdentityRateLimit: vi.fn(async () => undefined),
      findUserByTelegramId: vi.fn(async () => ({ id: "source-local", upstreamAccountId: "source", email: "old@example.com", emailVerified: true, telegramId: "777" })),
      findUserById: vi.fn(async () => ({ id: "target-local", upstreamAccountId: "target", email: "owner@example.com", emailVerified: true, telegramId: "888" })),
      loadProviderMergeIdentity: vi.fn(async () => ({ accountId: "source", email: "old@example.com", emailVerified: true, pendingEmail: "superseded@example.com", telegramId: "777" })),
      preflightAccountMerge: vi.fn(async () => ({
        conflicts: [], dryRun: true, sourceAccountId: "source", targetAccountId: "target",
        target: { accountId: "target", email: "owner@example.com", emailVerified: true, telegramId: "888" },
        requiresRelogin: true,
      })),
      persistAccountMergeConfirmation: persist,
      applyTelegramIdentity: vi.fn(), markAuthStateUser: vi.fn(), auditIdentityResolved: vi.fn(), clearTemporaryAuth: vi.fn(async () => undefined),
      providerAccountId: vi.fn(() => "source"), attachTelegramToCurrentAccount: vi.fn(), mergeProviderAccounts: vi.fn(),
      linkProviderSession: vi.fn(), reconcileProviderSession: vi.fn(), withOwnerChangeFence: vi.fn(async ({ work }) => work()), logAttachFailure: vi.fn(),
    };

    await expect(completeTelegramCallback(gateway, { kind: "oidc", code: "code", state: "state" }))
      .resolves.toMatchObject({ redirectTo: "/link-account?auth=telegram_email_replace", mergeConfirmation: { token: "merge-token" } });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      telegramId: "777", targetTelegramId: "888", sourceAccountId: "source", targetAccountId: "target",
    }));
    expect(gateway.applyTelegramIdentity).not.toHaveBeenCalled();
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

  it("orders cheap capacity, bounded proof, target limit and provider lookup", async () => {
    const order: string[] = [];
    const commands = authCommands({
      preflightCapacity: vi.fn(async () => { order.push("capacity"); }),
      withUpstreamConcurrency: vi.fn(async (action, work) => {
        order.push(`semaphore:${action}`);
        return work();
      }),
      verifyHuman: vi.fn(async () => { order.push("human"); }),
      rateLimit: vi.fn(async () => { order.push("target"); }),
      identifyEmail: vi.fn(async () => { order.push("provider"); return { exists: true }; }),
      hasPasskey: vi.fn(async () => false),
    });

    await expect(executeAuthCommand(commands, {
      kind: "identify",
      email: "user@example.com",
      turnstileToken: "proof",
    })).resolves.toMatchObject({ ok: true, kind: "identified" });

    expect(order).toEqual([
      "capacity",
      "semaphore:turnstile_verify",
      "human",
      "target",
      "semaphore:remnashop_auth",
      "provider",
    ]);
  });

  it("rejects oversized auth input before Redis or external services", async () => {
    const commands = authCommands();

    await expect(executeAuthCommand(commands, {
      kind: "login",
      email: `${"a".repeat(255)}@example.com`,
      password: "secret123",
      turnstileToken: "proof",
    })).resolves.toMatchObject({ ok: false, code: "VALIDATION_ERROR" });

    expect(commands.preflightCapacity).not.toHaveBeenCalled();
    expect(commands.verifyHuman).not.toHaveBeenCalled();
    expect(commands.rateLimit).not.toHaveBeenCalled();
    expect(commands.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    ["non-object", null],
    ["unknown kind", { kind: "destroy", email: "user@example.com" }],
    ["non-string email", { kind: "identify", email: 123 }],
    ["non-string password", { kind: "login", email: "user@example.com", password: 123 }],
    ["invalid referral code", { kind: "register", email: "user@example.com", password: "secret123", referralCode: "../friend" }],
    ["non-string referral code", { kind: "register", email: "user@example.com", password: "secret123", referralCode: 42 }],
    ["non-string reset code", { kind: "confirm-password-reset", email: "user@example.com", code: 123456, newPassword: "new-password" }],
    ["non-string Turnstile token", { kind: "identify", email: "user@example.com", turnstileToken: 123 }],
  ])("rejects malformed runtime command %s before gateway work", async (_name, malformed) => {
    const commands = authCommands();

    await expect(executeAuthCommand(commands, malformed))
      .resolves.toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(commands.preflightCapacity).not.toHaveBeenCalled();
    expect(commands.withUpstreamConcurrency).not.toHaveBeenCalled();
    expect(commands.rateLimit).not.toHaveBeenCalled();
    expect(commands.authenticate).not.toHaveBeenCalled();
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
      referralCode: "Friend42",
    })).resolves.toEqual({
      ok: true,
      kind: "authenticated",
      emailVerified: false,
      registrationFlow: "existing_email_login",
      verificationRequired: true,
      verificationDeliveryFailed: false,
    });
    expect(commands.authenticate).toHaveBeenNthCalledWith(1, {
      operation: "register",
      email: "user@example.com",
      password: "secret123",
      referralCode: "Friend42",
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
      metadata: { flow: "existing_email_login", verificationDelivery: "sent" },
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

  it("keeps the established registration session when verification delivery fails", async () => {
    const commands = authCommands({
      establishSession: vi.fn(async () => ({ userId: "user-1", emailVerified: false })),
      requestEmailVerification: vi.fn(async () => { throw new AuthGatewayError("UPSTREAM_UNAVAILABLE"); }),
    });

    await expect(executeAuthCommand(commands, {
      kind: "register",
      email: "user@example.com",
      password: "secret123",
    })).resolves.toEqual({
      ok: true,
      kind: "authenticated",
      emailVerified: false,
      registrationFlow: "created",
      verificationRequired: true,
      verificationDeliveryFailed: true,
    });
    expect(commands.audit).toHaveBeenCalledWith({
      action: "auth_register_success",
      userId: "user-1",
      metadata: { flow: "created", verificationDelivery: "failed" },
    });
  });

  it("does not mask a registration session-establishment failure", async () => {
    const commands = authCommands({
      establishSession: vi.fn(async () => { throw new AuthGatewayError("UPSTREAM_UNAVAILABLE"); }),
    });

    await expect(executeAuthCommand(commands, {
      kind: "register",
      email: "user@example.com",
      password: "secret123",
    })).resolves.toMatchObject({ ok: false, code: "UPSTREAM_UNAVAILABLE" });
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
      verifyHuman: vi.fn(async () => undefined),
      loadActor: vi.fn(async () => ({
        context: {}, userId: "user-1", email: "u@example.com", emailVerified: false,
        telegramId: null, pendingUpstreamAccountId: null, pendingEmail: null,
        authorizedUpstreamAccountId: "upstream-1", localUpstreamAccountId: "upstream-1", telegramUsername: null,
      })),
      assertRequestLimits: vi.fn(async () => undefined),
      requestProviderCode: vi.fn(async () => ({ targetEmail: "u@example.com" })),
      auditCodeRequested: vi.fn(async () => undefined),
      loadProviderProfile: vi.fn(async () => ({ email: "u@example.com", pendingEmail: null, emailVerified: false })),
      assertConfirmationLimit: vi.fn(async () => undefined),
      confirmProviderCode: vi.fn(async () => ({ email: "u@example.com" })),
      persistConfirmedEmail: vi.fn(async () => ({ existingOwnerId: null, upstreamAccountId: "upstream-1", localVerificationChanged: false })),
      currentProviderSession: vi.fn(() => ({ context: {} })),
      providerAccountId: vi.fn(() => "upstream-1"),
      telegramProviderSession: vi.fn(async () => ({ context: {} })),
      attachTelegram: vi.fn(async () => undefined),
      mergeProviderAccounts: vi.fn(async () => undefined),
      refreshProviderSession: vi.fn(async () => ({ context: {} })),
      linkCurrentAccount: vi.fn(async () => undefined),
      withOwnerChangeFence: vi.fn(async () => { throw new Error("sync pending"); }),
      refreshLocalSession: vi.fn(async () => undefined),
      auditEmailVerified: vi.fn(async () => undefined),
      markAccountSyncPending: vi.fn(async () => undefined),
      assertChangeLimits: vi.fn(async () => undefined),
      emailOwnerId: vi.fn(async () => null),
      assertChangeCooldown: vi.fn(async () => undefined),
      changeProviderEmail: vi.fn(async (_actor, email) => ({ pendingEmail: email })),
      persistPendingEmail: vi.fn(async () => undefined),
      auditEmailChangeRequested: vi.fn(async () => undefined),
    };
    await expect(requestEmailVerificationCode(commands, {})).resolves.toEqual({ ok: true, kind: "code-sent", targetEmail: "u@example.com" });
    await expect(confirmEmailVerificationCode(commands, { code: "123456" })).resolves.toEqual({
      ok: true, kind: "confirmed", readiness: { status: "pending", emailVerified: true },
    });
  });

  it("keeps linked-account commands behind a port", async () => {
    const commands = linkCommands();
    await expect(linkAccountEmail(commands, { email: " U@Example.com ", password: "secret123" })).resolves.toEqual({ ok: true, kind: "verification-required" });
    expect(commands.authenticateEmail).toHaveBeenCalledWith({ operation: "login", email: "u@example.com", password: "secret123" });
    const passkeys: PasskeyManagementGateway = {
      loadActor: vi.fn(async () => ({ userId: "user-1", fullAssurance: true, email: "u@example.com", emailVerified: true, telegramId: null })),
      loadOwned: vi.fn(async () => []), deleteOwned: vi.fn(async () => ({ externalCredentialId: "external-id" })), auditDeleted: vi.fn(async () => undefined),
    };
    await expect(removeLinkedPasskey(passkeys, "credential-id")).resolves.toEqual({ ok: true, kind: "passkey-deleted" });
  });

  it("blocks checkout before loading offers when the account is not ready", async () => {
    const reader: CheckoutReader = {
      loadOffers: vi.fn(),
    };
    const auth: AuthProfileGateway = {
      loadCurrentSession: vi.fn(async () => ({
        context: {}, id: "session-1", userId: "user-1", authMethod: "EMAIL" as const, hasUpstreamTokens: false,
        user: { email: "u@example.com", emailVerified: false, telegramId: null, telegramUsername: null, fullName: null, displayName: null, upstreamUserId: null, pendingUpstreamUserId: null, pendingEmail: null, accountSyncPending: false },
      })),
      authorizeCurrentSession: vi.fn(), loadProviderProfile: vi.fn(), confirmVerifiedEmail: vi.fn(), refreshCurrentAccess: vi.fn(), debug: vi.fn(),
    };
    await expect(loadCheckout(reader, auth)).resolves.toMatchObject({ status: "account-action-required", action: "linkEmail" });
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
