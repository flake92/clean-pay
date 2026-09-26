import { describe, expect, it } from "vitest";

import {
  initialPasskeySetupState,
  reducePasskeySetup,
  selectPasskeySetupView,
} from "@/frontend/components/passkey-setup-transitions";

describe("passkey setup transitions", () => {
  it("projects the exact initial view", () => {
    expect(selectPasskeySetupView(initialPasskeySetupState)).toEqual({
      error: null,
      loading: false,
      name: "",
      restarting: false,
    });
  });

  it("keeps create and restart loading states mutually exclusive", () => {
    const creating = reducePasskeySetup(initialPasskeySetupState, {
      type: "started",
      operation: "create",
    });
    const restarting = reducePasskeySetup(initialPasskeySetupState, {
      type: "started",
      operation: "restart",
    });

    expect(selectPasskeySetupView(creating)).toMatchObject({
      loading: true,
      restarting: false,
    });
    expect(selectPasskeySetupView(restarting)).toMatchObject({
      loading: false,
      restarting: true,
    });
  });

  it("preserves a changed name and error through settling", () => {
    const named = reducePasskeySetup(initialPasskeySetupState, {
      type: "name-changed",
      value: "Рабочий ноутбук",
    });
    const creating = reducePasskeySetup(named, {
      type: "started",
      operation: "create",
    });
    const failed = reducePasskeySetup(creating, {
      type: "failed",
      message: "Не удалось сохранить быстрый вход.",
    });
    const settled = reducePasskeySetup(failed, { type: "settled" });

    expect(selectPasskeySetupView(settled)).toEqual({
      error: "Не удалось сохранить быстрый вход.",
      loading: false,
      name: "Рабочий ноутбук",
      restarting: false,
    });
    expect(named).toEqual({
      error: null,
      name: "Рабочий ноутбук",
      phase: "idle",
    });
  });

  it("clears only the previous error when a new operation starts", () => {
    const failed = reducePasskeySetup(initialPasskeySetupState, {
      type: "failed",
      message: "Предыдущая ошибка",
    });
    const named = reducePasskeySetup(failed, {
      type: "name-changed",
      value: "Телефон",
    });

    expect(reducePasskeySetup(named, {
      type: "started",
      operation: "restart",
    })).toEqual({
      error: null,
      name: "Телефон",
      phase: "restarting",
    });
  });
});
