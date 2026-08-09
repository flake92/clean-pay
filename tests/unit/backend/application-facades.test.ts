import { describe, expect, it, vi } from "vitest";

import { authenticateTelegramWebApp } from "@/backend/application/auth/authenticate-telegram-webapp";
import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from "@/backend/application/auth/execute-passkey-command";
import {
  cancelLinkedTelegram,
  confirmLinkedTelegram,
  loadLinkAccount,
} from "@/backend/application/auth/manage-linked-account";
import type { LinkAccountCommands, LinkAccountReader } from "@/backend/application/auth/ports/link-account";
import type { PasskeyCommands } from "@/backend/application/auth/ports/passkey-commands";
import {
  activateCabinetPromocode,
  clearCabinetSession,
  deleteAllCabinetDevices,
  deleteCabinetDevice,
  endCabinetSession,
  reissueCabinetSubscription,
} from "@/backend/application/cabinet/execute-command";
import { loadCabinetViewModel } from "@/backend/application/cabinet/load-cabinet";
import {
  CabinetCommandError,
  type CabinetCommands,
} from "@/backend/application/cabinet/ports/cabinet-commands";
import type { CabinetReader } from "@/backend/application/cabinet/ports/cabinet-reader";
import { loadNavigation } from "@/backend/application/navigation/load-navigation";
import { loadPaymentStatus } from "@/backend/application/payments/load-payment-status";
import {
  changeProfileEmail,
  changeProfilePassword,
  requestProfileEmailVerification,
} from "@/backend/application/profile/execute-profile-command";
import { loadProfileViewModel } from "@/backend/application/profile/load-profile";
import type { ProfileCommands } from "@/backend/application/profile/ports/profile-commands";

const offers = {
  gateways: [],
  plans: [],
  has_current_subscription: false,
  current_subscription_status: null,
};

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
    const authenticate = vi.fn(async () => undefined);
    const authenticator = { authenticate };

    await expect(authenticateTelegramWebApp(authenticator, "   ")).resolves.toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    await expect(authenticateTelegramWebApp(authenticator, " signed-data ")).resolves.toEqual({ ok: true });
    expect(authenticate).toHaveBeenCalledWith("signed-data");

    authenticate.mockRejectedValueOnce(Object.assign(new Error("rejected"), { code: "UNAUTHORIZED" }));
    await expect(authenticateTelegramWebApp(authenticator, "bad")).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("keeps WebAuthn ceremonies behind the passkey port", async () => {
    const commands: PasskeyCommands = {
      beginLogin: vi.fn(async () => ({ challenge: "login" }) as never),
      finishLogin: vi.fn(async () => undefined),
      beginRegistration: vi.fn(async () => ({ challenge: "register" }) as never),
      finishRegistration: vi.fn(async () => undefined),
    };

    await expect(beginPasskeyLogin(commands, { email: " User@Example.COM " })).resolves.toMatchObject({ ok: true });
    expect(commands.beginLogin).toHaveBeenCalledWith({ email: "user@example.com" });
    await expect(beginPasskeyRegistration(commands)).resolves.toMatchObject({ ok: true });
    await expect(verifyPasskeyLogin(commands, {} as never)).resolves.toEqual({ ok: true });
    await expect(verifyPasskeyRegistration(commands, {} as never)).resolves.toEqual({ ok: true });

    vi.mocked(commands.finishLogin).mockRejectedValueOnce(Object.assign(new Error(), { code: "NOT_FOUND" }));
    await expect(verifyPasskeyLogin(commands, {} as never)).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("loads linked-account state with optional port fallbacks", async () => {
    const reader: LinkAccountReader = {
      loadProfile: vi.fn(async () => ({ email: "u@example.com", emailVerified: true, telegramId: null })),
      loadPasskeys: vi.fn(async () => { throw new Error("optional unavailable"); }),
      loadTelegramMergeConfirmation: vi.fn(async () => null),
    };

    await expect(loadLinkAccount(reader, "telegram_failed")).resolves.toMatchObject({
      status: "ready",
      passkeys: [],
      callbackError: "Не удалось завершить привязку Telegram.",
    });
    expect(reader.loadTelegramMergeConfirmation).not.toHaveBeenCalled();

    vi.mocked(reader.loadProfile).mockRejectedValueOnce(Object.assign(new Error(), { code: "UNAUTHORIZED" }));
    await expect(loadLinkAccount(reader, null)).resolves.toEqual({ status: "unauthorized" });
  });

  it("presents linked-account command outcomes", async () => {
    const commands: LinkAccountCommands = {
      linkEmail: vi.fn(async () => ({ linked: true })),
      confirmTelegramMerge: vi.fn(async () => undefined),
      cancelTelegramMerge: vi.fn(async () => undefined),
      deletePasskey: vi.fn(async () => undefined),
    };

    await expect(confirmLinkedTelegram(commands)).resolves.toEqual({ ok: true, kind: "merge-confirmed" });
    await expect(cancelLinkedTelegram(commands)).resolves.toEqual({ ok: true, kind: "merge-cancelled" });
    vi.mocked(commands.confirmTelegramMerge).mockRejectedValueOnce(Object.assign(new Error(), { code: "UNAUTHORIZED" }));
    await expect(confirmLinkedTelegram(commands)).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
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
      loadUser: vi.fn(async () => ({ id: "user-1", profile: { email: "u@example.com", emailVerified: true } })),
      loadSubscription: vi.fn(async () => null),
      loadOffers: vi.fn(async () => offers),
      loadDevices: vi.fn(async () => { throw new Error("devices unavailable"); }),
      loadPayments: vi.fn(async () => ({ records: [], stale: true })),
      loadSupport: vi.fn(async () => { throw new Error("support unavailable"); }),
    };

    await expect(loadCabinetViewModel(reader)).resolves.toMatchObject({
      status: "ready",
      offers,
      devices: null,
      paymentsWarning: "История показана из сохранённых данных. Обновление статусов временно недоступно.",
      support: { enabled: false },
    });
    expect(reader.loadPayments).toHaveBeenCalledWith("user-1");

    vi.mocked(reader.loadUser).mockRejectedValueOnce(new Error("no session"));
    await expect(loadCabinetViewModel(reader)).resolves.toEqual({ status: "error", message: "Нужно войти в аккаунт." });
  });

  it("uses safe fallbacks for navigation and payment status", async () => {
    const navigation = { authenticated: true, emailVerificationRequired: false, hasSubscription: true, canRenewSubscription: true };
    await expect(loadNavigation({ load: async () => navigation })).resolves.toEqual(navigation);
    await expect(loadNavigation({ load: async () => { throw new Error(); } })).resolves.toEqual({
      authenticated: false,
      emailVerificationRequired: false,
      hasSubscription: false,
      canRenewSubscription: false,
    });

    const paymentStatus = { payment: null, operation: null, subscription: null };
    await expect(loadPaymentStatus({ load: async () => paymentStatus }, { paymentId: null, operationId: "op-1" })).resolves.toEqual({
      status: "ready",
      data: paymentStatus,
    });
    await expect(loadPaymentStatus({ load: async () => { throw new Error(); } }, { paymentId: null, operationId: null })).resolves.toMatchObject({ status: "error" });
  });

  it("normalizes profile commands and presents stable failures", async () => {
    const commands: ProfileCommands = {
      requestEmailVerification: vi.fn(async () => ({ targetEmail: "u@example.com" })),
      changeEmail: vi.fn(async ({ email }) => ({ targetEmail: email })),
      changePassword: vi.fn(async () => undefined),
    };

    await expect(requestProfileEmailVerification(commands, {})).resolves.toMatchObject({ ok: true, targetEmail: "u@example.com" });
    await expect(changeProfileEmail(commands, { email: " New@Example.COM " })).resolves.toMatchObject({ ok: true, targetEmail: "new@example.com" });
    expect(commands.changeEmail).toHaveBeenCalledWith({ email: "new@example.com" });
    await expect(changeProfilePassword(commands, { currentPassword: "old", newPassword: "new-pass-123" })).resolves.toMatchObject({ ok: true });
    await expect(changeProfilePassword(commands, { currentPassword: "", newPassword: "short" })).resolves.toMatchObject({ ok: false, code: "VALIDATION_ERROR" });

    vi.mocked(commands.changePassword).mockRejectedValueOnce(Object.assign(new Error(), { code: "CURRENT_PASSWORD_INVALID" }));
    await expect(changeProfilePassword(commands, { currentPassword: "bad", newPassword: "new-pass-123" })).resolves.toMatchObject({
      ok: false,
      code: "CURRENT_PASSWORD_INVALID",
    });
  });

  it("loads profile data through its reader port", async () => {
    const user = { authType: "EMAIL", email: "u@example.com", emailVerified: true, pendingEmail: null, telegramId: null };
    await expect(loadProfileViewModel({ loadCurrent: async () => user })).resolves.toEqual({ status: "ready", user });
    await expect(loadProfileViewModel({ loadCurrent: async () => { throw new Error(); } })).resolves.toMatchObject({ status: "error" });
  });
});
