import { describe, expect, it, vi } from "vitest";

import {
  executePasskeyLogin,
  type PasskeyLoginOrchestratorDependencies,
} from "@/frontend/lib/passkey-login-orchestrator";

type Options = { challenge: string };
type Assertion = { id: string };

function dependencies(
  events: string[],
  overrides: Partial<PasskeyLoginOrchestratorDependencies<Options, Assertion>> = {},
): PasskeyLoginOrchestratorDependencies<Options, Assertion> {
  return {
    beginLogin: vi.fn(async () => {
      events.push("begin");
      return { ok: true as const, options: { challenge: "options" } };
    }),
    navigate: vi.fn(() => events.push("navigate")),
    resetTurnstile: vi.fn(() => events.push("reset")),
    startAuthentication: vi.fn(async () => {
      events.push("authenticate");
      return { id: "credential" };
    }),
    verifyLogin: vi.fn(async () => {
      events.push("verify");
      return { ok: true as const };
    }),
    ...overrides,
  };
}

describe("passkey login orchestrator", () => {
  it("reads top-to-bottom and preserves the exact successful dependency order", async () => {
    const events: string[] = [];
    const commands = dependencies(events);

    await expect(executePasskeyLogin({
      dependencies: commands,
      destination: "/cabinet?tab=devices#active",
      email: "person@example.test",
      turnstileToken: "turnstile-token",
    })).resolves.toEqual({ ok: true });

    expect(commands.beginLogin).toHaveBeenCalledWith({
      email: "person@example.test",
      turnstileToken: "turnstile-token",
    });
    expect(commands.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "options" },
    });
    expect(commands.verifyLogin).toHaveBeenCalledWith({ id: "credential" });
    expect(commands.navigate).toHaveBeenCalledWith("/cabinet?tab=devices#active");
    expect(events).toEqual(["begin", "reset", "authenticate", "verify", "navigate"]);
  });

  it("returns an options failure unchanged after exactly one reset", async () => {
    const events: string[] = [];
    const failure = {
      code: "NOT_FOUND",
      message: "Не удалось начать быстрый вход.",
      ok: false as const,
    };
    const commands = dependencies(events, {
      beginLogin: vi.fn(async () => {
        events.push("begin");
        return failure;
      }),
    });

    await expect(executePasskeyLogin({
      dependencies: commands,
      destination: "/cabinet",
      email: "person@example.test",
      turnstileToken: null,
    })).resolves.toBe(failure);

    expect(commands.beginLogin).toHaveBeenCalledWith({
      email: "person@example.test",
    });
    expect(commands.startAuthentication).not.toHaveBeenCalled();
    expect(commands.verifyLogin).not.toHaveBeenCalled();
    expect(commands.navigate).not.toHaveBeenCalled();
    expect(events).toEqual(["begin", "reset"]);
  });

  it("returns a verification failure without navigating or adding a reset", async () => {
    const events: string[] = [];
    const failure = {
      code: "UNAUTHORIZED",
      message: "Быстрый вход не подошёл. Войдите по паролю.",
      ok: false as const,
    };
    const commands = dependencies(events, {
      verifyLogin: vi.fn(async () => {
        events.push("verify");
        return failure;
      }),
    });

    await expect(executePasskeyLogin({
      dependencies: commands,
      destination: "/cabinet",
      email: "person@example.test",
      turnstileToken: null,
    })).resolves.toBe(failure);

    expect(commands.navigate).not.toHaveBeenCalled();
    expect(events).toEqual(["begin", "reset", "authenticate", "verify"]);
  });

  it("leaves thrown browser failures for the controller catch-reset policy", async () => {
    const events: string[] = [];
    const browserFailure = new Error("browser cancelled");
    const commands = dependencies(events, {
      startAuthentication: vi.fn(async () => {
        events.push("authenticate");
        throw browserFailure;
      }),
    });

    await expect(executePasskeyLogin({
      dependencies: commands,
      destination: "/cabinet",
      email: "person@example.test",
      turnstileToken: null,
    })).rejects.toBe(browserFailure);

    expect(events).toEqual(["begin", "reset", "authenticate"]);
  });
});
