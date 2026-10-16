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
    });
  });

  it("shows loading only while a passkey is being created", () => {
    const creating = reducePasskeySetup(initialPasskeySetupState, {
      type: "started",
    });

    expect(selectPasskeySetupView(creating)).toMatchObject({ loading: true });
    expect(selectPasskeySetupView(
      reducePasskeySetup(creating, { type: "settled" }),
    )).toMatchObject({ loading: false });
  });

  it("preserves a changed name and error through settling", () => {
    const named = reducePasskeySetup(initialPasskeySetupState, {
      type: "name-changed",
      value: "Рабочий ноутбук",
    });
    const creating = reducePasskeySetup(named, { type: "started" });
    const failed = reducePasskeySetup(creating, {
      type: "failed",
      message: "Не удалось сохранить быстрый вход.",
    });
    const settled = reducePasskeySetup(failed, { type: "settled" });

    expect(selectPasskeySetupView(settled)).toEqual({
      error: "Не удалось сохранить быстрый вход.",
      loading: false,
      name: "Рабочий ноутбук",
    });
    expect(named).toEqual({
      error: null,
      name: "Рабочий ноутбук",
      phase: "idle",
    });
  });

  it("clears only the previous error when a new attempt starts", () => {
    const failed = reducePasskeySetup(initialPasskeySetupState, {
      type: "failed",
      message: "Предыдущая ошибка",
    });
    const named = reducePasskeySetup(failed, {
      type: "name-changed",
      value: "Телефон",
    });

    expect(reducePasskeySetup(named, { type: "started" })).toEqual({
      error: null,
      name: "Телефон",
      phase: "creating",
    });
  });
});
