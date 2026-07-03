import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  auditLog: vi.fn(),
  createWebSession: vi.fn(),
  getCurrentSession: vi.fn(),
  upgradeCurrentSessionToFull: vi.fn(),
  prisma: {
    webAuthnChallenge: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    webAuthnCredential: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    webUser: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
  generateAuthenticationOptions: mocks.generateAuthenticationOptions,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}));

vi.mock("@/backend/observability/audit", () => ({
  auditLog: mocks.auditLog,
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/backend/sessions/web-session", () => ({
  createWebSession: mocks.createWebSession,
  getCurrentSession: mocks.getCurrentSession,
  upgradeCurrentSessionToFull: mocks.upgradeCurrentSessionToFull,
}));

import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  deletePasskey,
  finishPasskeyLogin,
  finishPasskeyRegistration,
  listPasskeys,
} from "@/backend/auth/passkeys";
import { BffError } from "@/backend/integrations/remnashop/errors";

function clientData(challenge: string) {
  return Buffer.from(JSON.stringify({ challenge })).toString("base64url");
}

const session = {
  id: "session-1",
  userId: "user-1",
  assuranceLevel: "FULL",
  user: {
    email: "user@example.com",
    telegramUsername: null,
    telegramId: null,
    displayName: "User",
    fullName: "User Full",
  },
};

describe("passkey use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentSession.mockResolvedValue(session);
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: "reg-challenge", rp: { id: "localhost" } });
    mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: "auth-challenge" });
    mocks.prisma.webAuthnCredential.findMany.mockResolvedValue([]);
    mocks.prisma.webAuthnChallenge.findFirst.mockResolvedValue({ id: "challenge-1", userId: "user-1", challenge: "reg-challenge" });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "credential-1",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
        },
        aaguid: "aaguid",
        credentialBackedUp: true,
        credentialDeviceType: "multiDevice",
      },
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 2 },
    });
    mocks.prisma.webAuthnCredential.findUnique.mockResolvedValue({
      id: "db-credential-1",
      userId: "user-1",
      credentialId: "credential-1",
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 1n,
      transports: ["internal"],
      user: session.user,
    });
    mocks.createWebSession.mockResolvedValue({ id: "new-session" });
  });

  it("begins registration with excluded credentials and stores challenge", async () => {
    mocks.prisma.webAuthnCredential.findMany.mockResolvedValue([{ credentialId: "existing", transports: ["internal"] }]);

    await expect(beginPasskeyRegistration()).resolves.toMatchObject({ challenge: "reg-challenge" });

    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: "localhost",
        rpName: "Clean Pay",
        userName: "user@example.com",
        excludeCredentials: [{ id: "existing", transports: ["internal"] }],
      }),
    );
    expect(mocks.prisma.webAuthnChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        challenge: "reg-challenge",
        type: "REGISTRATION",
        userId: "user-1",
      }),
    });
  });

  it("uses custom cabinet brand as WebAuthn relying party name", async () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND_NAME", "Partner Cabinet");

    await beginPasskeyRegistration();

    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpName: "Partner Cabinet",
      }),
    );

    vi.unstubAllEnvs();
  });

  it("finishes registration, persists credential and upgrades partial session", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({ ...session, assuranceLevel: "PARTIAL" });

    await expect(
      finishPasskeyRegistration({
        id: "credential-1",
        rawId: "credential-1",
        type: "public-key",
        response: {
          clientDataJSON: clientData("reg-challenge"),
          attestationObject: "attestation",
          transports: ["internal"],
        },
        clientExtensionResults: {},
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.prisma.webAuthnChallenge.update).toHaveBeenCalledWith({
      where: { id: "challenge-1" },
      data: { consumedAt: expect.any(Date) },
    });
    expect(mocks.prisma.webAuthnCredential.upsert).toHaveBeenCalledWith({
      where: { credentialId: "credential-1" },
      create: expect.objectContaining({ userId: "user-1", credentialId: "credential-1" }),
      update: expect.objectContaining({ counter: 0n }),
    });
    expect(mocks.upgradeCurrentSessionToFull).toHaveBeenCalledOnce();
  });

  it("begins and finishes passkey login", async () => {
    await expect(beginPasskeyLogin()).resolves.toEqual({ challenge: "auth-challenge" });
    expect(mocks.prisma.webAuthnChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ challenge: "auth-challenge", type: "AUTHENTICATION" }),
    });

    mocks.prisma.webAuthnChallenge.findFirst.mockResolvedValueOnce({ id: "challenge-2", challenge: "auth-challenge" });

    await expect(
      finishPasskeyLogin({
        id: "credential-1",
        rawId: "credential-1",
        type: "public-key",
        response: {
          clientDataJSON: clientData("auth-challenge"),
          authenticatorData: "authenticator",
          signature: "signature",
          userHandle: null,
        },
        clientExtensionResults: {},
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.prisma.webAuthnCredential.update).toHaveBeenCalledWith({
      where: { id: "db-credential-1" },
      data: { counter: 2n, lastUsedAt: expect.any(Date) },
    });
    expect(mocks.createWebSession).toHaveBeenCalledWith("user-1", {
      authMethod: "PASSKEY",
      assuranceLevel: "FULL",
    });
  });

  it("lists and deletes passkeys with full-session guard", async () => {
    const credentials = [
      { id: "first", credentialId: "cred-1" },
      { id: "second", credentialId: "cred-2" },
    ];
    mocks.prisma.webAuthnCredential.findMany.mockResolvedValue(credentials);
    mocks.prisma.webAuthnCredential.findFirst.mockResolvedValue({ id: "second", credentialId: "cred-2" });

    await expect(listPasskeys()).resolves.toEqual({ credentials });
    await expect(deletePasskey("second")).resolves.toEqual({ success: true });

    expect(mocks.prisma.webAuthnCredential.delete).toHaveBeenCalledWith({ where: { id: "second" } });
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "passkey_deleted", userId: "user-1" }));
  });

  it("throws BFF errors for missing sessions, invalid challenges and last passkey delete", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null);
    await expect(beginPasskeyRegistration()).rejects.toMatchObject<BffError>({ code: "UNAUTHORIZED" });

    mocks.getCurrentSession.mockResolvedValueOnce(session);
    mocks.prisma.webAuthnChallenge.findFirst.mockResolvedValueOnce(null);
    await expect(
      finishPasskeyRegistration({
        id: "credential-1",
        rawId: "credential-1",
        type: "public-key",
        response: { clientDataJSON: clientData("missing"), attestationObject: "attestation" },
        clientExtensionResults: {},
      }),
    ).rejects.toMatchObject<BffError>({ code: "VALIDATION_ERROR" });

    mocks.prisma.webAuthnCredential.findMany.mockResolvedValueOnce([{ id: "only" }]);
    await expect(deletePasskey("only")).rejects.toMatchObject<BffError>({ code: "FORBIDDEN" });
  });
});
