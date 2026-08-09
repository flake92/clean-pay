import { describe, expect, it, vi } from "vitest";

import { authenticateTelegramWebApp } from "@/application/auth/authenticate-telegram-webapp";
import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from "@/application/auth/execute-passkey-command";
import {
  cancelLinkedTelegram,
  confirmLinkedTelegram,
  loadLinkAccount,
} from "@/application/auth/manage-linked-account";
import type { LinkAccountReader } from "@/application/auth/ports/link-account";
import type { PasskeyCommands } from "@/application/auth/ports/passkey-commands";
import type { TelegramWebAppGateway } from "@/application/auth/ports/telegram-webapp";
import type { EmailVerificationCommands } from "@/application/auth/ports/email-verification";
import type { TelegramAccountMergeGateway } from "@/application/auth/ports/telegram-account-merge";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";
import type { PasskeyManagementGateway } from "@/application/auth/ports/passkey-management";
import {
  activateCabinetPromocode,
  clearCabinetSession,
  deleteAllCabinetDevices,
  deleteCabinetDevice,
  endCabinetSession,
  reissueCabinetSubscription,
} from "@/application/cabinet/execute-command";
import { loadCabinetViewModel } from "@/application/cabinet/load-cabinet";
import {
  CabinetCommandError,
  type CabinetCommands,
} from "@/application/cabinet/ports/cabinet-commands";
import type { CabinetReader } from "@/application/cabinet/ports/cabinet-reader";
import { loadNavigationShell } from "@/application/navigation/load-navigation";
import { loadPaymentStatus } from "@/application/payments/load-payment-status";
import type { PaymentHistoryGateway } from "@/application/payments/ports/payment-history";
import type { PaymentMaintenanceRunner } from "@/application/payments/ports/payment-maintenance";
import {
  changeProfileEmail,
  changeProfilePassword,
  requestProfileEmailVerification,
} from "@/application/profile/execute-profile-command";
import { loadProfileViewModel } from "@/application/profile/load-profile";
import type { ProfileCommands } from "@/application/profile/ports/profile-commands";

const offers = {
  gateways: [],
  plans: [],
  has_current_subscription: false,
  current_subscription_status: null,
};

function authGateway(overrides: Partial<AuthProfileGateway> = {}): AuthProfileGateway {
  return {
    loadCurrentSession: vi.fn(async () => ({
      context: {}, id: "session-1", userId: "user-1", authMethod: "EMAIL" as const,
      hasUpstreamTokens: false,
      user: {
        email: "u@example.com", emailVerified: true, telegramId: null,
        telegramUsername: null, fullName: null, displayName: null,
        upstreamUserId: null, pendingUpstreamUserId: null, pendingEmail: null,
        accountSyncPending: false,
      },
    })),
    authorizeCurrentSession: vi.fn(async () => { throw new Error("not used"); }),
    loadProviderProfile: vi.fn(async () => { throw new Error("not used"); }),
    confirmVerifiedEmail: vi.fn(async () => undefined),
    refreshCurrentAccess: vi.fn(async () => undefined),
    debug: vi.fn(),
    ...overrides,
  };
}

function passkeyGateway(overrides: Partial<PasskeyManagementGateway> = {}): PasskeyManagementGateway {
  return {
    loadActor: vi.fn(async () => ({ userId: "user-1", fullAssurance: true, email: "u@example.com", emailVerified: true, telegramId: null })),
    loadOwned: vi.fn(async () => []), deleteOwned: vi.fn(async () => ({ externalCredentialId: "external" })),
    auditDeleted: vi.fn(async () => undefined), ...overrides,
  };
}

function paymentMaintenance(): PaymentMaintenanceRunner {
  return {
    claimReconciliation: vi.fn(async () => null), recoverPayment: vi.fn(async () => null),
    completeRecoveredPayment: vi.fn(async () => undefined), resetMissingPayment: vi.fn(async () => undefined),
    releaseReconciliation: vi.fn(async () => undefined), markReconciliationManual: vi.fn(async () => undefined),
    failReconciliation: vi.fn(async () => "released" as const), classifyReconciliationError: vi.fn(() => ({ kind: "other" as const })),
    listHistoryCandidates: vi.fn(async () => []), claimHistory: vi.fn(async () => null), authorizeHistory: vi.fn(async () => ({ context: {} })),
    historyPageSize: vi.fn(async () => 100), loadHistoryPage: vi.fn(async () => ({ context: {} })),
    completeHistoryPage: vi.fn(async () => ({ applied: 0, hasMore: false })), failHistory: vi.fn(async () => undefined), now: vi.fn(() => Date.now()),
  };
}

function cabinetCommands(overrides: Partial<CabinetCommands> = {}): CabinetCommands {
  return {
    deleteDevice: vi.fn(async () => undefined),
    deleteAllDevices: vi.fn(async () => undefined),
    reissueSubscription: vi.fn(async () => undefined),
    activatePromocode: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("application facades", () => {
  it("validates and normalizes Telegram WebApp input before the port", async () => {
    const gateway: TelegramWebAppGateway = {
      authenticateProvider: vi.fn(async () => ({ context: {} })),
      verifiedIdentity: vi.fn(async () => ({ telegramId: "777", context: {} })),
      rateLimit: vi.fn(async () => undefined),
      reconcileIdentity: vi.fn(async () => ({
        userId: "user-1",
        upstreamSession: {
          accessTokenEncrypted: "a",
          refreshTokenEncrypted: "r",
          accessExpiresAt: new Date(0),
          refreshExpiresAt: new Date(0),
        },
        requiresRecovery: true,
      })),
      createSession: vi.fn(async () => ({ id: "session-1" })),
      recoverSession: vi.fn(async () => undefined),
    };

    await expect(authenticateTelegramWebApp(gateway, "   ")).resolves.toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    await expect(authenticateTelegramWebApp(gateway, " signed-data ")).resolves.toEqual({ ok: true });
    expect(gateway.authenticateProvider).toHaveBeenCalledWith("signed-data");
    expect(gateway.rateLimit).toHaveBeenCalledWith("777");
    expect(gateway.recoverSession).toHaveBeenCalledWith("session-1", "user-1");

    vi.mocked(gateway.authenticateProvider).mockRejectedValueOnce(Object.assign(new Error("rejected"), { code: "UNAUTHORIZED" }));
    await expect(authenticateTelegramWebApp(gateway, "bad")).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("keeps WebAuthn ceremonies behind the passkey port", async () => {
    const actor = {
      context: {}, userId: "user-1", assuranceLevel: "FULL" as const,
      email: "user@example.com", emailVerified: true, telegramId: null,
      telegramUsername: null, displayName: null, fullName: null, hasPendingAccountMerge: false,
    };
    const credential = { context: {}, id: "db-key", userId: "user-1", credentialId: "key", oldCounter: 0n };
    const commands: PasskeyCommands = {
      verifyHuman: vi.fn(async () => undefined),
      loadRegistrationActor: vi.fn(async () => actor),
      generateRegistrationOptions: vi.fn(async () => ({ challenge: "register" })),
      registrationChallenge: vi.fn(() => "register"),
      storeRegistrationChallenge: vi.fn(async () => undefined),
      consumeRegistrationChallenge: vi.fn(async () => ({ context: {}, challenge: "register", userId: "user-1" })),
      verifyRegistration: vi.fn(async () => ({ context: {}, credentialId: "key" })),
      persistRegistration: vi.fn(async () => undefined),
      markRegistrationComplete: vi.fn(async () => undefined),
      upgradeRegistrationSession: vi.fn(async () => undefined),
      auditRegistration: vi.fn(async () => undefined),
      assertLoginOptionsRateLimit: vi.fn(async () => undefined),
      withLoginOptionsConcurrency: vi.fn(async (work) => work()),
      findLoginAccount: vi.fn(async () => ({ context: {}, userId: "user-1", credentials: [{ id: "key", transports: [] }] })),
      generateLoginOptions: vi.fn(async () => ({ challenge: "login" })),
      loginChallenge: vi.fn(() => "login"),
      storeLoginChallenge: vi.fn(async () => undefined),
      assertLoginVerificationRateLimit: vi.fn(async () => undefined),
      consumeLoginChallenge: vi.fn(async () => ({ context: {}, challenge: "login", userId: "user-1" })),
      findCredential: vi.fn(async () => credential),
      verifyAuthentication: vi.fn(async () => ({ newCounter: 1n })),
      recordAuthentication: vi.fn(async () => undefined),
      createAuthenticatedSession: vi.fn(async () => ({ id: "session-1" })),
      auditLogin: vi.fn(async () => undefined),
    };

    await expect(beginPasskeyLogin(commands, { email: " User@Example.COM " })).resolves.toMatchObject({ ok: true });
    expect(commands.verifyHuman).toHaveBeenCalledWith(null);
    expect(commands.findLoginAccount).toHaveBeenCalledWith("user@example.com");
    await expect(beginPasskeyRegistration(commands)).resolves.toMatchObject({ ok: true });
    await expect(verifyPasskeyLogin(commands, {} as never)).resolves.toEqual({ ok: true });
    await expect(verifyPasskeyRegistration(commands, {} as never)).resolves.toEqual({ ok: true });

    vi.mocked(commands.findCredential).mockRejectedValueOnce(Object.assign(new Error(), { code: "NOT_FOUND" }));
    await expect(verifyPasskeyLogin(commands, {} as never)).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("loads linked-account state with optional port fallbacks", async () => {
    const reader: LinkAccountReader = {
      loadMergeActor: vi.fn(async () => ({ userId: "user-1", fullAssurance: true })),
      loadTelegramMergeConfirmation: vi.fn(async () => null),
    };
    const passkeys = passkeyGateway({ loadOwned: vi.fn(async () => { throw new Error("optional unavailable"); }) });

    await expect(loadLinkAccount(reader, authGateway(), passkeys, "telegram_failed")).resolves.toMatchObject({
      status: "ready",
      passkeys: [],
      callbackError: "Не удалось завершить привязку Telegram.",
    });
    expect(reader.loadTelegramMergeConfirmation).not.toHaveBeenCalled();

    await expect(loadLinkAccount(reader, authGateway({ loadCurrentSession: vi.fn(async () => null) }), passkeys, null)).resolves.toEqual({ status: "unauthorized" });
  });

  it("presents linked-account command outcomes", async () => {
    const mergeGateway: TelegramAccountMergeGateway = {
      loadActor: vi.fn(async () => ({ userId: "user-1", fullAssurance: true })),
      loadConfirmation: vi.fn(async () => ({
        context: {}, id: "merge-1", userId: "user-1", status: "COMPLETED" as const, expiresAt: new Date(Date.now() + 60_000),
        sourceAccountId: "source", targetAccountId: "target", sourceEmail: null, targetEmail: "u@example.com", telegramId: "777", telegramUsername: null,
      })),
      assertRateLimit: vi.fn(async () => undefined), audit: vi.fn(async () => undefined), claim: vi.fn(async () => true),
      withOwnerChangeFence: vi.fn(async (_confirmation, work) => work()), loadCurrentOwner: vi.fn(), authenticateTelegram: vi.fn(),
      preflight: vi.fn(), mergeProviderAccounts: vi.fn(), loadCurrentSubscription: vi.fn(), linkCurrentAccount: vi.fn(),
      complete: vi.fn(), cancel: vi.fn(async () => true), release: vi.fn(), refreshLocalSession: vi.fn(),
    };

    await expect(confirmLinkedTelegram(mergeGateway)).resolves.toEqual({ ok: true, kind: "merge-confirmed" });
    vi.mocked(mergeGateway.loadConfirmation).mockResolvedValueOnce({
      context: {}, id: "merge-2", userId: "user-1", status: "PENDING", expiresAt: new Date(Date.now() + 60_000),
      sourceAccountId: "source", targetAccountId: "target", sourceEmail: null, targetEmail: "u@example.com", telegramId: "777", telegramUsername: null,
    });
    await expect(cancelLinkedTelegram(mergeGateway)).resolves.toEqual({ ok: true, kind: "merge-cancelled" });
    vi.mocked(mergeGateway.loadConfirmation).mockRejectedValueOnce(Object.assign(new Error(), { code: "UNAUTHORIZED" }));
    await expect(confirmLinkedTelegram(mergeGateway)).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("validates cabinet commands and never exposes adapter errors", async () => {
    const commands = cabinetCommands();

    await expect(deleteCabinetDevice(commands, " device-1 ")).resolves.toMatchObject({ status: "success" });
    expect(commands.deleteDevice).toHaveBeenCalledWith("device-1");
    await expect(deleteCabinetDevice(commands, "\u0000bad")).resolves.toMatchObject({ status: "error" });
    await expect(activateCabinetPromocode(commands, " PROMO ")).resolves.toMatchObject({ status: "success" });
    expect(commands.activatePromocode).toHaveBeenCalledWith("PROMO");
    await expect(deleteAllCabinetDevices(commands)).resolves.toMatchObject({ status: "success" });
    await expect(reissueCabinetSubscription(commands)).resolves.toMatchObject({ status: "success" });

    vi.mocked(commands.deleteAllDevices).mockRejectedValueOnce(new Error("provider detail"));
    await expect(deleteAllCabinetDevices(commands)).resolves.toEqual({ status: "error", message: "Не удалось удалить устройства." });
  });

  it("keeps session termination behind the cabinet command port", async () => {
    const commands = cabinetCommands();

    await expect(endCabinetSession(commands)).resolves.toBeUndefined();
    await expect(clearCabinetSession(commands)).resolves.toEqual({ status: "success" });
    expect(commands.logout).toHaveBeenCalledTimes(2);

    vi.mocked(commands.logout).mockRejectedValueOnce(new Error("provider detail"));
    await expect(clearCabinetSession(commands)).resolves.toEqual({
      status: "error",
      message: "Не удалось завершить сессию.",
    });
  });

  it("uses the explicit public error contract for cabinet commands", async () => {
    const commands = cabinetCommands();

    vi.mocked(commands.activatePromocode).mockRejectedValueOnce(
      new CabinetCommandError("Срок действия промокода истёк."),
    );
    await expect(activateCabinetPromocode(commands, "EXPIRED")).resolves.toEqual({
      status: "error",
      message: "Срок действия промокода истёк.",
    });

    vi.mocked(commands.activatePromocode).mockRejectedValueOnce(
      new CabinetCommandError("Этот промокод уже был активирован."),
    );
    await expect(activateCabinetPromocode(commands, "USED")).resolves.toEqual({
      status: "error",
      message: "Этот промокод уже был активирован.",
    });

    vi.mocked(commands.activatePromocode).mockRejectedValueOnce(
      new CabinetCommandError("Слишком много попыток. Попробуйте позже."),
    );
    await expect(activateCabinetPromocode(commands, "LIMIT")).resolves.toEqual({
      status: "error",
      message: "Слишком много попыток. Попробуйте позже.",
    });

    vi.mocked(commands.deleteDevice).mockRejectedValueOnce(
      new CabinetCommandError("Сервис временно недоступен. Попробуйте позже."),
    );
    await expect(deleteCabinetDevice(commands, "hwid-1")).resolves.toEqual({
      status: "error",
      message: "Сервис временно недоступен. Попробуйте позже.",
    });

    vi.mocked(commands.deleteAllDevices).mockRejectedValueOnce(new Error("unknown"));
    await expect(deleteAllCabinetDevices(commands)).resolves.toEqual({
      status: "error",
      message: "Не удалось удалить устройства.",
    });
  });

  it("builds a cabinet view model and isolates optional read failures", async () => {
    const reader: CabinetReader = {
      loadSubscription: vi.fn(async () => null),
      loadOffers: vi.fn(async () => offers),
      loadDevices: vi.fn(async () => { throw new Error("devices unavailable"); }),
      loadSupport: vi.fn(async () => { throw new Error("support unavailable"); }),
    };
    const history: PaymentHistoryGateway = {
      authorize: vi.fn(async () => { throw new Error("sync unavailable"); }), loadCapabilities: vi.fn(async () => null),
      findPendingPaymentIds: vi.fn(async () => []), loadExactTransaction: vi.fn(async () => null), persistExactTransaction: vi.fn(async () => undefined),
      loadLegacyTransactions: vi.fn(async () => []), persistLegacyTransactions: vi.fn(async () => undefined),
      loadRecent: vi.fn(async () => []), logExactFailure: vi.fn(), logDegraded: vi.fn(),
    };
    const maintenance = paymentMaintenance();

    await expect(loadCabinetViewModel(reader, authGateway(), history, maintenance)).resolves.toMatchObject({
      status: "ready",
      offers,
      devices: null,
      paymentsWarning: "История показана из сохранённых данных. Обновление статусов временно недоступно.",
      support: { enabled: false },
    });
    expect(history.loadRecent).toHaveBeenCalledWith("user-1", 20);

    await expect(loadCabinetViewModel(reader, authGateway({ loadCurrentSession: vi.fn(async () => null) }), history, maintenance)).resolves.toEqual({ status: "unauthorized" });
  });

  it("uses safe fallbacks for navigation and payment status", async () => {
    const shellGateway = authGateway();
    await expect(loadNavigationShell(shellGateway)).resolves.toEqual({
      authenticated: true,
      emailVerificationRequired: false,
      hasSubscription: false,
      canRenewSubscription: false,
    });
    expect(shellGateway.authorizeCurrentSession).not.toHaveBeenCalled();
    expect(shellGateway.loadProviderProfile).not.toHaveBeenCalled();

    const paymentStatus = { payment: null, operation: null, subscription: null };
    const statusReader = {
      loadActor: vi.fn(async () => ({ id: "user-1", emailVerified: true, telegramId: null })),
      findOperation: vi.fn(async () => null), authorize: vi.fn(async () => ({ context: {}, upstreamAccountId: "upstream-1" })),
      assertUpstreamOwner: vi.fn(async () => undefined), loadCapabilities: vi.fn(async () => null),
      loadExactTransaction: vi.fn(async () => null), persistExactTransaction: vi.fn(async () => undefined),
      loadLegacyTransactions: vi.fn(async () => []), persistLegacyTransactions: vi.fn(async () => undefined),
      loadSubscription: vi.fn(async () => null), findPayment: vi.fn(async () => null),
      findLatestPayment: vi.fn(async () => null), isSubscriptionMissing: vi.fn(() => false),
    };
    const reconciliation = paymentMaintenance();
    await expect(loadPaymentStatus(statusReader, reconciliation, { paymentId: null, operationId: "op-1" })).resolves.toEqual({
      status: "ready",
      data: paymentStatus,
    });
    statusReader.loadActor.mockRejectedValueOnce(new Error());
    await expect(loadPaymentStatus(statusReader, reconciliation, { paymentId: null, operationId: null })).resolves.toMatchObject({ status: "error" });
  });

  it("normalizes profile commands and presents stable failures", async () => {
    const commands: ProfileCommands = {
      loadPasswordSession: vi.fn(async () => ({ context: {}, userId: "user-1" })),
      changeProviderPassword: vi.fn(async () => ({ context: {} })),
      refreshProviderSession: vi.fn(async () => ({ context: {} })),
      persistRefreshedProviderSession: vi.fn(async () => undefined),
      replaceLocalPasswordSession: vi.fn(async () => undefined),
      auditPasswordChanged: vi.fn(async () => undefined),
    };
    const emailCommands: EmailVerificationCommands = {
      verifyHuman: vi.fn(async () => undefined),
      loadActor: vi.fn(async () => ({
        context: {}, userId: "user-1", email: "u@example.com", emailVerified: false,
        telegramId: null, pendingUpstreamAccountId: null, pendingEmail: null,
        authorizedUpstreamAccountId: "upstream-1", telegramUsername: null,
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
      withOwnerChangeFence: vi.fn(async ({ work }) => work()),
      refreshLocalSession: vi.fn(async () => undefined),
      auditEmailVerified: vi.fn(async () => undefined),
      markAccountSyncPending: vi.fn(async () => undefined),
      assertChangeLimits: vi.fn(async () => undefined),
      changeProviderEmail: vi.fn(async (_actor, email) => ({ pendingEmail: email })),
      persistPendingEmail: vi.fn(async () => undefined),
      auditEmailChangeRequested: vi.fn(async () => undefined),
    };

    await expect(requestProfileEmailVerification(emailCommands, {})).resolves.toMatchObject({ ok: true, targetEmail: "u@example.com" });
    await expect(changeProfileEmail(emailCommands, { email: " New@Example.COM " })).resolves.toMatchObject({ ok: true, targetEmail: "u@example.com" });
    expect(emailCommands.changeProviderEmail).toHaveBeenCalledWith(expect.anything(), "new@example.com");
    await expect(changeProfilePassword(commands, { currentPassword: "old", newPassword: "new-pass-123" })).resolves.toMatchObject({ ok: true });
    await expect(changeProfilePassword(commands, { currentPassword: "", newPassword: "short" })).resolves.toMatchObject({ ok: false, code: "VALIDATION_ERROR" });

    vi.mocked(commands.changeProviderPassword).mockRejectedValueOnce(Object.assign(new Error(), { code: "CURRENT_PASSWORD_INVALID" }));
    await expect(changeProfilePassword(commands, { currentPassword: "bad", newPassword: "new-pass-123" })).resolves.toMatchObject({
      ok: false,
      code: "CURRENT_PASSWORD_INVALID",
    });
  });

  it("loads profile data through its reader port", async () => {
    const user = { authType: "email", email: "u@example.com", emailVerified: true, pendingEmail: null, telegramId: null };
    await expect(loadProfileViewModel(authGateway())).resolves.toEqual({ status: "ready", user });
    await expect(loadProfileViewModel(authGateway({ loadCurrentSession: vi.fn(async () => null) }))).resolves.toEqual({ status: "unauthorized" });
    await expect(loadProfileViewModel(authGateway({ loadCurrentSession: vi.fn(async () => { throw new Error(); }) }))).resolves.toMatchObject({ status: "error" });
  });
});
