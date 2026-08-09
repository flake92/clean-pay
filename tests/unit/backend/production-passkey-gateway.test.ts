import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(), verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(), verifyAuthenticationResponse: vi.fn(),
  getCurrentSession: vi.fn(), upgradeCurrentSessionToFull: vi.fn(), createWebSession: vi.fn(),
  verifyTurnstileToken: vi.fn(), assertRateLimit: vi.fn(), withAuthConcurrency: vi.fn(), auditLog: vi.fn(),
  recordPasskeyUse: vi.fn(),
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
vi.mock("@/backend/security/turnstile", () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }));
vi.mock("@/backend/limits/rate-limit", () => ({ assertRateLimit: mocks.assertRateLimit, withAuthConcurrency: mocks.withAuthConcurrency }));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));
vi.mock("@/backend/integrations/auth/passkey-service", () => ({ recordPasskeyUse: mocks.recordPasskeyUse }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "Mozilla/5.0 Windows Chrome/120" }) }));

import {
  beginPasskeyLogin, beginPasskeyRegistration, verifyPasskeyLogin, verifyPasskeyRegistration,
} from "@/application/auth/execute-passkey-command";
import { productionPasskeyCommands as gateway } from "@/backend/integrations/auth/passkey-gateway";

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
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "passkey_login" }));
  });

  it("maps absent sessions, accounts and invalid cryptographic responses", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null);
    await expect(beginPasskeyRegistration(gateway)).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce(null);
    await expect(beginPasskeyLogin(gateway, { email: "missing@example.com" })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    mocks.verifyAuthenticationResponse.mockRejectedValueOnce(new Error("bad signature"));
    await expect(verifyPasskeyLogin(gateway, authenticationResponse)).resolves.toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
});
