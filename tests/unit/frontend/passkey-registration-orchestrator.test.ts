import { describe, expect, it, vi } from "vitest";

import {
  executePasskeyRegistration,
  type PasskeyRegistrationOrchestratorDependencies,
} from "@/frontend/lib/passkey-registration-orchestrator";

type Options = { challenge: string };
type Attestation = { id: string };

function dependencies(
  events: string[],
  overrides: Partial<
    PasskeyRegistrationOrchestratorDependencies<Options, Attestation>
  > = {},
): PasskeyRegistrationOrchestratorDependencies<Options, Attestation> {
  return {
    beginRegistration: vi.fn(async () => {
      events.push("begin");
      return { ok: true as const, options: { challenge: "options" } };
    }),
    navigateTo: vi.fn(() => events.push("navigate")),
    startRegistration: vi.fn(async () => {
      events.push("register");
      return { id: "credential" };
    }),
    supportsWebAuthn: vi.fn(() => {
      events.push("support");
      return true;
    }),
    verifyRegistration: vi.fn(async () => {
      events.push("verify");
      return { ok: true as const };
    }),
    ...overrides,
  };
}

describe("passkey registration orchestrator", () => {
  it("preserves support, action, browser, verification and navigation order", async () => {
    const events: string[] = [];
    const commands = dependencies(events);

    await expect(executePasskeyRegistration({
      dependencies: commands,
      destination: "/profile#security",
      name: "  Рабочий ноутбук  ",
      unsupportedMessage: "unsupported",
    })).resolves.toEqual({ ok: true });

    expect(commands.beginRegistration).toHaveBeenCalledWith();
    expect(commands.startRegistration).toHaveBeenCalledWith({
      optionsJSON: { challenge: "options" },
    });
    expect(commands.verifyRegistration).toHaveBeenCalledWith({
      id: "credential",
      name: "Рабочий ноутбук",
    });
    expect(commands.navigateTo).toHaveBeenCalledWith("/profile#security");
    expect(events).toEqual(["support", "begin", "register", "verify", "navigate"]);
  });

  it("keeps an empty registration name as undefined", async () => {
    const events: string[] = [];
    const commands = dependencies(events);

    await executePasskeyRegistration({
      dependencies: commands,
      destination: "/cabinet",
      name: "   ",
      unsupportedMessage: "unsupported",
    });

    expect(commands.verifyRegistration).toHaveBeenCalledWith({
      id: "credential",
      name: undefined,
    });
  });

  it("fails before Server Actions when WebAuthn support disappears", async () => {
    const events: string[] = [];
    const commands = dependencies(events, {
      supportsWebAuthn: vi.fn(() => {
        events.push("support");
        return false;
      }),
    });

    await expect(executePasskeyRegistration({
      dependencies: commands,
      destination: "/cabinet",
      name: "",
      unsupportedMessage: "Точное сообщение",
    })).resolves.toEqual({ ok: false, message: "Точное сообщение" });

    expect(commands.beginRegistration).not.toHaveBeenCalled();
    expect(commands.startRegistration).not.toHaveBeenCalled();
    expect(commands.verifyRegistration).not.toHaveBeenCalled();
    expect(commands.navigateTo).not.toHaveBeenCalled();
    expect(events).toEqual(["support"]);
  });

  it("returns action failures unchanged and does not continue", async () => {
    const events: string[] = [];
    const failure = { ok: false as const, message: "registration unavailable" };
    const commands = dependencies(events, {
      beginRegistration: vi.fn(async () => {
        events.push("begin");
        return failure;
      }),
    });

    await expect(executePasskeyRegistration({
      dependencies: commands,
      destination: "/cabinet",
      name: "",
      unsupportedMessage: "unsupported",
    })).resolves.toBe(failure);

    expect(commands.startRegistration).not.toHaveBeenCalled();
    expect(commands.verifyRegistration).not.toHaveBeenCalled();
    expect(commands.navigateTo).not.toHaveBeenCalled();
    expect(events).toEqual(["support", "begin"]);
  });
});
