import { describe, expect, it } from "vitest";

import {
  initialPasskeyLoginState,
  reducePasskeyLogin,
  selectPasskeyLoginView,
} from "@/frontend/components/passkey-login-transitions";

describe("passkey login transitions", () => {
  it("projects the exact initial idle view", () => {
    expect(selectPasskeyLoginView(initialPasskeyLoginState)).toEqual({
      error: null,
      loading: false,
    });
  });

  it("starts without mutating the previous error state", () => {
    const previous = {
      error: "Предыдущая ошибка",
      phase: "idle" as const,
    };

    const started = reducePasskeyLogin(previous, { type: "started" });

    expect(started).toEqual({ error: null, phase: "loading" });
    expect(previous).toEqual({ error: "Предыдущая ошибка", phase: "idle" });
    expect(selectPasskeyLoginView(started)).toEqual({
      error: null,
      loading: true,
    });
  });

  it("preserves the loading phase until the controller settles a failure", () => {
    const started = reducePasskeyLogin(initialPasskeyLoginState, {
      type: "started",
    });
    const failed = reducePasskeyLogin(started, {
      type: "failed",
      message: "Не удалось войти",
    });

    expect(selectPasskeyLoginView(failed)).toEqual({
      error: "Не удалось войти",
      loading: true,
    });
    expect(selectPasskeyLoginView(reducePasskeyLogin(failed, {
      type: "settled",
    }))).toEqual({
      error: "Не удалось войти",
      loading: false,
    });
  });

  it("records a preflight failure without entering loading", () => {
    const failed = reducePasskeyLogin(initialPasskeyLoginState, {
      type: "failed",
      message: "Пройдите единую проверку безопасности.",
    });

    expect(selectPasskeyLoginView(failed)).toEqual({
      error: "Пройдите единую проверку безопасности.",
      loading: false,
    });
  });
});
