import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(), verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(), verifyAuthenticationResponse: vi.fn(),
  getCurrentSession: vi.fn(), upgradeCurrentSessionToFull: vi.fn(), createWebSession: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(), authDebugLog: vi.fn(),
  verifyTurnstileToken: vi.fn(), assertRateLimit: vi.fn(), withAuthConcurrency: vi.fn(), auditLog: vi.fn(),
  recordPasskeyUse: vi.fn(),
  headerGet: vi.fn<(name: string) => string | null>(() => "Mozilla/5.0 Windows Chrome/120"),
  prisma: {
    webAuthnChallenge: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    webAuthnCredential: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    webUser: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
  generateAuthenticationOptions: mocks.generateAuthenticationOptions,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}));
vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  getCurrentSession: mocks.getCurrentSession, upgradeCurrentSessionToFull: mocks.upgradeCurrentSessionToFull,
  createWebSession: mocks.createWebSession,
}));
vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
}));
vi.mock("@/backend/observability/auth-debug-log", () => ({ authDebugLog: mocks.authDebugLog }));
vi.mock("@/backend/security/turnstile", () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }));
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit, withAuthConcurrency: mocks.withAuthConcurrency }));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));
vi.mock("@/backend/integrations/auth/passkey-service", () => ({ recordPasskeyUse: mocks.recordPasskeyUse }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: mocks.headerGet }) }));

import {
  beginPasskeyLogin, beginPasskeyRegistration, verifyPasskeyLogin, verifyPasskeyRegistration,
} from "@/application/auth/execute-passkey-command";
import { createProductionPasskeyCommands } from "@/backend/integrations/auth/passkey-gateway";

const gateway = createProductionPasskeyCommands();

function clientData(challenge: string) {
  return Buffer.from(JSON.stringify({ challenge })).toString("base64url");
}

const session = {
  id: "session-1", userId: "user-1", assuranceLevel: "FULL",
  user: {
    email: "u@example.com", emailVerified: true, telegramId: null, telegramUsername: null,
    displayName: "User", fullName: null, pendingRemnashopUserId: null, pendingRemnashopEmail: null,
  },
};

const registrationResponse = {
  id: "credential-1", rawId: "credential-1", type: "public-key",
  response: { clientDataJSON: clientData("registration"), attestationObject: "attestation", transports: ["internal"] },
  clientExtensionResults: {}, name: "Laptop",
};

const authenticationResponse = {
  id: "credential-1", rawId: "credential-1", type: "public-key",
  response: { clientDataJSON: clientData("authentication"), authenticatorData: "data", signature: "signature", userHandle: null },
  clientExtensionResults: {},
};

describe("production passkey gateway through application workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withAuthConcurrency.mockImplementation(async (_key: string, work: () => Promise<unknown>) => work());
    mocks.getCurrentSession.mockResolvedValue(session);
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: "registration" });
    mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: "authentication" });
    mocks.prisma.webAuthnChallenge.findFirst.mockImplementation(async ({ where }: { where: { type: string } }) => ({
      id: "challenge-1", userId: "user-1", challenge: where.type === "REGISTRATION" ? "registration" : "authentication",
    }));
    mocks.prisma.webAuthnChallenge.updateMany.mockResolvedValue({ count: 1 });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "credential-1", publicKey: new Uint8Array([1, 2]), counter: 0 },
        aaguid: "aaguid", credentialBackedUp: true, credentialDeviceType: "multiDevice",
      },
    });
    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.webAuthnCredential.create.mockResolvedValue({});
    mocks.prisma.webUser.findUnique.mockResolvedValue({
      id: "user-1", webAuthnCredentials: [{ credentialId: "credential-1", transports: ["internal"] }],
    });
    mocks.prisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: "db-key", userId: "user-1", credentialId: "credential-1", publicKey: new Uint8Array([1, 2]),
      counter: 1n, transports: ["internal"], user: session.user,
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 2 } });
    mocks.createWebSession.mockResolvedValue({ id: "new-session" });
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({});
    mocks.headerGet.mockReturnValue("Mozilla/5.0 Windows Chrome/120");
  });

  it("generates and stores registration options through the application policy", async () => {
    await expect(beginPasskeyRegistration(gateway)).resolves.toEqual({ ok: true, options: { challenge: "registration" } });
    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      rpID: "localhost", userName: "u@example.com", authenticatorSelection: expect.objectContaining({ userVerification: "required" }),
    }));
    expect(mocks.prisma.webAuthnChallenge.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "REGISTRATION", userId: "user-1" }) });
  });

  it("verifies and persists registration before completing the actor", async () => {
    await expect(verifyPasskeyRegistration(gateway, registrationResponse)).resolves.toEqual({ ok: true });
    expect(mocks.verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({ expectedChallenge: "registration" }));
    expect(mocks.prisma.webAuthnCredential.create).toHaveBeenCalledWith({ data: expect.objectContaining({ credentialId: "credential-1", name: "Laptop" }) });
    expect(mocks.prisma.webUser.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: expect.objectContaining({ authPending: false }) });
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "passkey_registered" }));
  });

  it("upgrades the registration session through the production adapter", async () => {
    mocks.upgradeCurrentSessionToFull.mockResolvedValue({ id: "session-full" });

    await expect(gateway.upgradeRegistrationSession()).resolves.toBeUndefined();
    expect(mocks.upgradeCurrentSessionToFull).toHaveBeenCalledOnce();
  });

  it("generates login options under Turnstile, rate and concurrency guards", async () => {
    await expect(beginPasskeyLogin(gateway, { email: " U@Example.com ", turnstileToken: "human" })).resolves.toEqual({ ok: true, options: { challenge: "authentication" } });
    expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith("human", "auth_login");
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({ action: "passkey_login_options", email: "u@example.com" }));
    expect(mocks.generateAuthenticationOptions).toHaveBeenCalledWith(expect.objectContaining({ allowCredentials: [{ id: "credential-1", transports: ["internal"] }] }));
  });

  it("verifies login, advances counter and creates the full session in order", async () => {
    await expect(verifyPasskeyLogin(gateway, authenticationResponse)).resolves.toEqual({ ok: true });
    expect(mocks.verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({ expectedChallenge: "authentication" }));
    expect(mocks.recordPasskeyUse).toHaveBeenCalledWith(expect.objectContaining({ oldCounter: 1n, newCounter: 2n }));
    expect(mocks.createWebSession).toHaveBeenCalledWith("user-1", expect.objectContaining({ authMethod: "PASSKEY", assuranceLevel: "FULL" }));
    expect(mocks.getAuthorizedRemnashopTokens).toHaveBeenCalledWith({ allowUnverifiedEmail: true });
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "passkey_login" }));
  });

  it("keeps a valid passkey login when upstream session recovery is temporarily unavailable", async () => {
    const { ServiceError } = await import("@/backend/errors/service-error");
    mocks.getAuthorizedRemnashopTokens.mockRejectedValueOnce(
      new ServiceError("UPSTREAM_UNAVAILABLE", 503),
    );

    await expect(verifyPasskeyLogin(gateway, authenticationResponse)).resolves.toEqual({ ok: true });
    expect(mocks.authDebugLog).toHaveBeenCalledWith(
      "passkey_upstream_session_restore_deferred",
      { sessionId: "new-session", userId: "user-1", code: "UPSTREAM_UNAVAILABLE" },
    );
  });

  it("maps absent sessions, accounts and invalid cryptographic responses", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null);
    await expect(beginPasskeyRegistration(gateway)).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce(null);
    await expect(beginPasskeyLogin(gateway, { email: "missing@example.com" })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    mocks.verifyAuthenticationResponse.mockRejectedValueOnce(new Error("bad signature"));
    await expect(verifyPasskeyLogin(gateway, authenticationResponse)).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("validates option and client challenge shapes before persistence", async () => {
    expect(() => gateway.registrationChallenge({})).toThrowError(expect.objectContaining({ code: "INTERNAL_ERROR" }));
    expect(() => gateway.loginChallenge({ challenge: 123 })).toThrowError(expect.objectContaining({ code: "INTERNAL_ERROR" }));
    await expect(gateway.consumeRegistrationChallenge({ response: {} })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(gateway.consumeLoginChallenge({ response: { clientDataJSON: "not-base64-json" } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    mocks.prisma.webAuthnChallenge.findFirst.mockResolvedValueOnce(null);
    await expect(gateway.consumeLoginChallenge(authenticationResponse)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    mocks.prisma.webAuthnChallenge.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(gateway.consumeLoginChallenge(authenticationResponse)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("maps provider service errors while preserving programming failures", async () => {
    const { ServiceError } = await import("@/backend/errors/service-error");
    mocks.getCurrentSession.mockRejectedValueOnce(new ServiceError("UNAUTHORIZED", 401));
    await expect(gateway.loadRegistrationActor()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const programmingFailure = new TypeError("broken adapter");
    mocks.getCurrentSession.mockRejectedValueOnce(programmingFailure);
    await expect(gateway.loadRegistrationActor()).rejects.toBe(programmingFailure);
  });

  it("uses stable registration identity fallbacks and preserves pending merges", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session, assuranceLevel: "BOOTSTRAP",
      user: { ...session.user, email: null, telegramUsername: null, telegramId: "777", displayName: null,
        pendingRemnashopUserId: "pending-owner", pendingRemnashopEmail: "pending@example.com" },
    });
    const actor = await gateway.loadRegistrationActor();
    expect(actor).toMatchObject({ assuranceLevel: "BOOTSTRAP", hasPendingAccountMerge: true });
    await gateway.generateRegistrationOptions(actor!);
    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({ userName: "777", userDisplayName: "777" }));
    await gateway.markRegistrationComplete(actor!);
    expect(mocks.prisma.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" }, data: { lastLoginAt: expect.any(Date) },
    });
  });

  it("rejects invalid registration proofs", async () => {
    const challenge = { context: {}, challenge: "registration", userId: "user-1" };
    mocks.verifyRegistrationResponse.mockRejectedValueOnce(new Error("bad attestation"));
    await expect(gateway.verifyRegistration(registrationResponse, challenge)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    mocks.verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });
    await expect(gateway.verifyRegistration(registrationResponse, challenge)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("updates an owned credential and safely resolves unique registration races", async () => {
    const actor = { userId: "user-1" } as never;
    const verified = { context: {
      credential: { id: "credential-1", publicKey: new Uint8Array([1, 2]), counter: 0 },
      aaguid: "aaguid", credentialBackedUp: false, credentialDeviceType: "singleDevice",
    } } as never;
    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValueOnce({ count: 1 });
    await gateway.persistRegistration(actor, { ...registrationResponse, name: "  Work   Laptop  " }, verified);
    expect(mocks.prisma.webAuthnCredential.create).not.toHaveBeenCalled();

    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocks.prisma.webAuthnCredential.create.mockRejectedValueOnce({ code: "P2002" });
    await expect(gateway.persistRegistration(actor, { ...registrationResponse, name: "" }, verified)).resolves.toBeUndefined();

    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    mocks.prisma.webAuthnCredential.create.mockRejectedValueOnce({ code: "P2002" });
    await expect(gateway.persistRegistration(actor, registrationResponse, verified)).rejects.toMatchObject({ code: "CONFLICT" });

    const failure = new TypeError("db failed");
    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.prisma.webAuthnCredential.create.mockRejectedValueOnce(failure);
    await expect(gateway.persistRegistration(actor, registrationResponse, verified)).rejects.toBe(failure);
  });

  it.each([
    ["Mozilla/5.0 iPhone Safari/17", "iPhone Safari"],
    ["Mozilla/5.0 iPad CriOS/120", "iPad Chrome"],
    ["Mozilla/5.0 Android Edg/120", "Android Edge"],
    ["Mozilla/5.0 Macintosh Firefox/120", "macOS Firefox"],
    ["Mozilla/5.0 Linux", "Linux браузер"],
    [null, "Устройство браузер"],
  ])("infers a bounded credential name from %s", async (userAgent, expectedName) => {
    mocks.headerGet.mockReturnValueOnce(userAgent);
    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValueOnce({ count: 1 });
    await gateway.persistRegistration(
      { userId: "user-1" } as never,
      { ...registrationResponse, name: undefined },
      { context: {
        credential: { id: "credential-1", publicKey: new Uint8Array([1]), counter: 0 },
        aaguid: "aaguid", credentialBackedUp: false, credentialDeviceType: "singleDevice",
      } } as never,
    );
    expect(mocks.prisma.webAuthnCredential.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: expectedName }),
    }));
  });

  it("validates credential lookup and authentication verification", async () => {
    await expect(gateway.findCredential({})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    mocks.prisma.webAuthnCredential.findUnique.mockResolvedValueOnce(null);
    await expect(gateway.findCredential({ id: "missing" })).resolves.toBeNull();
    const credential = await gateway.findCredential({ id: "credential-1" });
    const challenge = { context: {}, challenge: "authentication", userId: "user-1" };
    mocks.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false });
    await expect(gateway.verifyAuthentication(authenticationResponse, challenge, credential!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
