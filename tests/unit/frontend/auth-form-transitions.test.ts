import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  authFormControllerReducer,
  authPasswordsMatch,
  createInitialAuthFormControllerState,
  createTelegramAuthStartUrl,
  missingAuthTurnstileTokenMessage,
  normalizeAuthCode,
  selectAuthFormView,
} from "@/frontend/components/auth-form-transitions";

describe("auth form controller transitions", () => {
  it("preserves initial feedback and the exact e-mail-change reset", () => {
    const initial = createInitialAuthFormControllerState("Исходная ошибка");
    expect(initial).toEqual({
      stage: "identify",
      api: { loading: false, error: "Исходная ошибка" },
      email: "",
      password: "",
      passwordConfirmation: "",
      code: "",
      hasPasskey: false,
      canRecoverPassword: false,
    });

    const populated = {
      ...initial,
      stage: "password" as const,
      api: { loading: true, error: "Ошибка" },
      email: "person@example.test",
      password: "password",
      passwordConfirmation: "confirmation",
      code: "123456",
      hasPasskey: true,
      canRecoverPassword: true,
    };
    expect(authFormControllerReducer(populated, {
      type: "email-change-requested",
    })).toEqual({
      ...initial,
      email: "person@example.test",
      api: { loading: false, error: null },
    });
  });

  it("keeps recovery and rejection state-machine edge semantics", () => {
    const register = {
      ...createInitialAuthFormControllerState(null),
      stage: "register" as const,
      password: "password",
      passwordConfirmation: "hidden-confirmation",
      canRecoverPassword: false,
    };
    const rejected = authFormControllerReducer(register, {
      type: "request-rejected",
      code: "AUTH_FAILED",
      message: "Неверный e-mail или пароль.",
    });
    expect(rejected.stage).toBe("password");
    expect(rejected.canRecoverPassword).toBe(true);
    expect(rejected.api).toEqual({
      loading: false,
      error: "Неверный e-mail или пароль.",
    });

    const recovery = authFormControllerReducer(rejected, {
      type: "password-recovery-requested",
    });
    expect(recovery).toMatchObject({
      stage: "resetStart",
      password: "",
      passwordConfirmation: "hidden-confirmation",
      code: "",
      canRecoverPassword: false,
      api: { loading: false, error: null },
    });
    expect(authFormControllerReducer(recovery, {
      type: "password-reset-requested",
    })).toMatchObject({
      stage: "resetConfirm",
      password: "",
      passwordConfirmation: "",
      code: "",
      api: { loading: false, error: null },
    });
  });

  it("selects the same visible fields for every stage", () => {
    const initial = createInitialAuthFormControllerState(null);
    expect(selectAuthFormView(initial)).toEqual({
      showPasskey: false,
      showIdentifyMessage: true,
      showResetStartMessage: false,
      showCredentialFields: false,
      showRegisterMessage: false,
      showResetConfirmation: false,
      showPasswordConfirmation: false,
      showPasswordRecovery: false,
      showEmailChange: false,
    });

    const password = authFormControllerReducer(initial, {
      type: "identity-resolved",
      exists: true,
      hasPasskey: true,
    });
    expect(selectAuthFormView({
      ...password,
      canRecoverPassword: true,
    })).toMatchObject({
      showPasskey: true,
      showCredentialFields: true,
      showPasswordRecovery: true,
      showEmailChange: true,
    });

    const register = authFormControllerReducer(initial, {
      type: "identity-resolved",
      exists: false,
      hasPasskey: false,
    });
    expect(selectAuthFormView(register)).toMatchObject({
      showRegisterMessage: true,
      showPasswordConfirmation: true,
      showEmailChange: true,
    });
  });

  it("keeps validation, code normalization and Turnstile copy exact", () => {
    expect(authPasswordsMatch("identify", "one", "two")).toBe(true);
    expect(authPasswordsMatch("password", "one", "two")).toBe(true);
    expect(authPasswordsMatch("register", "one", "two")).toBe(false);
    expect(authPasswordsMatch("resetConfirm", "same", "same")).toBe(true);
    expect(normalizeAuthCode("a1 2-3b456789")).toBe("123456");
    expect(missingAuthTurnstileTokenMessage("site-key")).toBe(
      "Пройдите единую проверку безопасности.",
    );
    expect(missingAuthTurnstileTokenMessage(null)).toBe(
      "Проверка безопасности временно недоступна.",
    );
  });

  it("keeps Telegram query order, encoding and optional token exact", () => {
    expect(createTelegramAuthStartUrl(
      "https://pay.example",
      "/cabinet?tab=devices#active",
      "challenge token",
    )).toBe(
      "https://pay.example/auth/telegram/start?redirect_to=%2Fcabinet%3Ftab%3Ddevices%23active&turnstile_token=challenge+token",
    );
    expect(createTelegramAuthStartUrl(
      "https://pay.example",
      "/cabinet",
      null,
    )).toBe(
      "https://pay.example/auth/telegram/start?redirect_to=%2Fcabinet",
    );
  });

  it("keeps the auth façade at exactly three runtime exports and no type exports", () => {
    const source = readFileSync("src/frontend/components/auth-forms.tsx", "utf8");
    const runtimeExports = Array.from(
      source.matchAll(/^export function (\w+)/gm),
      (match) => match[1],
    );
    const typeExports = Array.from(
      source.matchAll(/^export (?:type|interface) (\w+)/gm),
      (match) => match[1],
    );

    expect(runtimeExports).toEqual([
      "AuthTurnstileProvider",
      "LoginForm",
      "TelegramLoginButton",
    ]);
    expect(typeExports).toEqual([]);
  });
});
