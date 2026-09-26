import { describe, expect, it } from "vitest";

import {
  authCommandForStage,
  authPasswordLabel,
  authRejectedTransition,
  authStageAfterIdentification,
  authSubmitLabel,
} from "@/frontend/components/auth-form-presentation";

describe("auth form presentation transitions", () => {
  it("builds every existing Server Action payload without adding empty fields", () => {
    const fields = { email: "person@example.test", password: "password", code: "123456" };

    expect(authCommandForStage("identify", fields, null)).toEqual({
      kind: "identify",
      email: fields.email,
    });
    expect(authCommandForStage("password", fields, "challenge")).toEqual({
      kind: "login",
      email: fields.email,
      password: fields.password,
      turnstileToken: "challenge",
    });
    expect(authCommandForStage("register", fields, null)).toEqual({
      kind: "register",
      email: fields.email,
      password: fields.password,
    });
    expect(authCommandForStage("resetStart", fields, null)).toEqual({
      kind: "request-password-reset",
      email: fields.email,
    });
    expect(authCommandForStage("resetConfirm", fields, null)).toEqual({
      kind: "confirm-password-reset",
      email: fields.email,
      code: fields.code,
      newPassword: fields.password,
    });
  });

  it("preserves the existing identify and rejected-password transitions", () => {
    expect(authStageAfterIdentification(true)).toBe("password");
    expect(authStageAfterIdentification(false)).toBe("register");
    expect(authRejectedTransition("register", "AUTH_FAILED")).toEqual({
      canRecoverPassword: true,
      stage: "password",
    });
    expect(authRejectedTransition("password", "AUTH_FAILED")).toEqual({
      canRecoverPassword: true,
      stage: "password",
    });
    expect(authRejectedTransition("resetConfirm", "AUTH_FAILED")).toEqual({
      canRecoverPassword: false,
      stage: "resetConfirm",
    });
  });

  it("keeps the visible labels byte-for-byte stable", () => {
    expect(authPasswordLabel("password")).toBe("Пароль");
    expect(authPasswordLabel("register")).toBe("Придумайте пароль");
    expect(authPasswordLabel("resetConfirm")).toBe("Новый пароль");
    expect(authSubmitLabel("identify")).toBe("Продолжить");
    expect(authSubmitLabel("password")).toBe("Продолжить");
    expect(authSubmitLabel("register")).toBe("Создать аккаунт");
    expect(authSubmitLabel("resetStart")).toBe("Получить код восстановления");
    expect(authSubmitLabel("resetConfirm")).toBe("Сохранить новый пароль");
  });
});
