import { describe, expect, it, vi } from "vitest";

import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from "@/application/auth/execute-passkey-command";
import type { PasskeyCommands } from "@/application/auth/ports/passkey-commands";

function commands(overrides: Partial<PasskeyCommands> = {}): PasskeyCommands {
  const actor = {
    context: {}, userId: "user-1", assuranceLevel: "FULL" as const,
    email: "user@example.com", emailVerified: true, telegramId: null,
    telegramUsername: null, displayName: "User", fullName: null, hasPendingAccountMerge: false,
  };
  return {
    verifyHuman: vi.fn(async () => undefined), loadRegistrationActor: vi.fn(async () => actor),
    generateRegistrationOptions: vi.fn(async () => ({ challenge: "registration" })),
    registrationChallenge: vi.fn(() => "registration"), storeRegistrationChallenge: vi.fn(async () => undefined),
    consumeRegistrationChallenge: vi.fn(async () => ({ context: {}, challenge: "registration", userId: "user-1" })),
    verifyRegistration: vi.fn(async () => ({ context: {}, credentialId: "credential-1" })),
    persistRegistration: vi.fn(async () => undefined), markRegistrationComplete: vi.fn(async () => undefined),
    upgradeRegistrationSession: vi.fn(async () => undefined), auditRegistration: vi.fn(async () => undefined),
    assertLoginOptionsRateLimit: vi.fn(async () => undefined), withLoginOptionsConcurrency: vi.fn(async (work) => work()),
    findLoginAccount: vi.fn(async () => ({ context: {}, userId: "user-1", credentials: [{ id: "credential-1", transports: [] }] })),
    generateLoginOptions: vi.fn(async () => ({ challenge: "authentication" })), loginChallenge: vi.fn(() => "authentication"),
    storeLoginChallenge: vi.fn(async () => undefined), assertLoginVerificationRateLimit: vi.fn(async () => undefined),
    consumeLoginChallenge: vi.fn(async () => ({ context: {}, challenge: "authentication", userId: "user-1" })),
    findCredential: vi.fn(async () => ({ context: {}, id: "db-1", userId: "user-1", credentialId: "credential-1", oldCounter: 1n })),
    verifyAuthentication: vi.fn(async () => ({ newCounter: 2n })), recordAuthentication: vi.fn(async () => undefined),
    createAuthenticatedSession: vi.fn(async () => ({ id: "session-1" })), auditLogin: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("passkey application workflow", () => {
  it("owns human verification, throttling, account lookup and challenge persistence ordering", async () => {
    const order: string[] = [];
    const subject = commands({
      verifyHuman: vi.fn(async () => { order.push("human"); }),
      assertLoginOptionsRateLimit: vi.fn(async () => { order.push("limit"); }),
      withLoginOptionsConcurrency: vi.fn(async (work) => { order.push("lock"); return work(); }),
      findLoginAccount: vi.fn(async () => { order.push("account"); return { context: {}, userId: "user-1", credentials: [{ id: "key", transports: [] }] }; }),
      generateLoginOptions: vi.fn(async () => { order.push("generate"); return { challenge: "challenge" }; }),
      storeLoginChallenge: vi.fn(async () => { order.push("store"); }),
    });
    await expect(beginPasskeyLogin(subject, { email: " User@Example.com ", turnstileToken: "human" })).resolves.toMatchObject({ ok: true });
    expect(order).toEqual(["human", "limit", "lock", "account", "generate", "store"]);
    expect(subject.findLoginAccount).toHaveBeenCalledWith("user@example.com");
  });

  it("does not generate options for an account without a credential", async () => {
    const subject = commands({ findLoginAccount: vi.fn(async () => null) });
    await expect(beginPasskeyLogin(subject, { email: "none@example.com" })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(subject.generateLoginOptions).not.toHaveBeenCalled();
    expect(subject.storeLoginChallenge).not.toHaveBeenCalled();
  });

  it("rejects a credential selected for another challenge owner before cryptographic verification", async () => {
    const subject = commands({
      consumeLoginChallenge: vi.fn(async () => ({ context: {}, challenge: "authentication", userId: "other-user" })),
    });
    await expect(verifyPasskeyLogin(subject, {})).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect(subject.verifyAuthentication).not.toHaveBeenCalled();
    expect(subject.createAuthenticatedSession).not.toHaveBeenCalled();
  });

  it("records the authenticator counter before creating and auditing the session", async () => {
    const order: string[] = [];
    const subject = commands({
      verifyAuthentication: vi.fn(async () => { order.push("verify"); return { newCounter: 2n }; }),
      recordAuthentication: vi.fn(async () => { order.push("counter"); }),
      createAuthenticatedSession: vi.fn(async () => { order.push("session"); return { id: "session-1" }; }),
      auditLogin: vi.fn(async () => { order.push("audit"); }),
    });
    await expect(verifyPasskeyLogin(subject, {})).resolves.toEqual({ ok: true });
    expect(order).toEqual(["verify", "counter", "session", "audit"]);
  });

  it("persists a verified registration before completing and upgrading a bootstrap session", async () => {
    const order: string[] = [];
    const subject = commands({
      loadRegistrationActor: vi.fn(async () => ({
        context: {}, userId: "user-1", assuranceLevel: "BOOTSTRAP" as const, email: null, emailVerified: false,
        telegramId: "777", telegramUsername: null, displayName: null, fullName: null, hasPendingAccountMerge: true,
      })),
      persistRegistration: vi.fn(async () => { order.push("persist"); }),
      markRegistrationComplete: vi.fn(async () => { order.push("complete"); }),
      upgradeRegistrationSession: vi.fn(async () => { order.push("upgrade"); }),
      auditRegistration: vi.fn(async (_actor, _registration, upgraded) => { order.push(`audit:${upgraded}`); }),
    });
    await expect(verifyPasskeyRegistration(subject, {})).resolves.toEqual({ ok: true });
    expect(order).toEqual(["persist", "complete", "upgrade", "audit:true"]);
  });

  it("enforces verified identity policy for full sessions in the application layer", async () => {
    const subject = commands({
      loadRegistrationActor: vi.fn(async () => ({
        context: {}, userId: "user-1", assuranceLevel: "FULL" as const, email: "u@example.com", emailVerified: false,
        telegramId: null, telegramUsername: null, displayName: null, fullName: null, hasPendingAccountMerge: false,
      })),
    });
    await expect(beginPasskeyRegistration(subject)).resolves.toMatchObject({ ok: false, code: "EMAIL_NOT_VERIFIED" });
    expect(subject.generateRegistrationOptions).not.toHaveBeenCalled();
  });
});
