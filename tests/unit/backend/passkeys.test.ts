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
  assertEmailVerificationPolicy: vi.fn(),
  assertRateLimit: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    webAuthnChallenge: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    webAuthnCredential: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
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
  assertEmailVerificationPolicy: mocks.assertEmailVerificationPolicy,
  createWebSession: mocks.createWebSession,
  getCurrentSession: mocks.getCurrentSession,
  upgradeCurrentSessionToFull: mocks.upgradeCurrentSessionToFull,
}));

vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.assertRateLimit,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0" })),
}));

import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  deletePasskey,
  finishPasskeyLogin,
  finishPasskeyRegistration,
  listPasskeys,
} from "@/backend/auth/passkeys";

function clientData(challenge: string) {
  return Buffer.from(JSON.stringify({ challenge })).toString("base64url");
}

function registrationResponse(name = "Рабочий ноутбук"): Parameters<typeof finishPasskeyRegistration>[0] {
  return {
    id: "credential-1",
    rawId: "credential-1",
    type: "public-key",
    response: {
      clientDataJSON: clientData("reg-challenge"),
      attestationObject: "attestation",
      transports: ["internal"],
    },
    clientExtensionResults: {},
    name,
  };
}

const session = {
  id: "session-1",
  userId: "user-1",
  assuranceLevel: "FULL",
  user: {
    email: "user@example.com",
    emailVerified: true,
    telegramUsername: null,
    telegramId: null,
    displayName: "User",
    fullName: "User Full",
  },
};

describe("passkey use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertEmailVerificationPolicy.mockImplementation(() => undefined);
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma));
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: "user-1" }]);
    mocks.getCurrentSession.mockResolvedValue(session);
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: "reg-challenge", rp: { id: "localhost" } });
    mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: "auth-challenge" });
    mocks.prisma.webAuthnCredential.findMany.mockResolvedValue([]);
    mocks.prisma.webAuthnCredential.create.mockResolvedValue(undefined);
    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.webAuthnCredential.count.mockResolvedValue(2);
    mocks.prisma.webAuthnChallenge.findFirst.mockResolvedValue({ id: "challenge-1", userId: "user-1", challenge: "reg-challenge" });
    mocks.prisma.webAuthnChallenge.updateMany.mockResolvedValue({ count: 1 });
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

  it("begins registration with cross-device friendly options and stores challenge", async () => {
    mocks.prisma.webAuthnCredential.findMany.mockResolvedValue([{ credentialId: "existing", transports: ["internal"] }]);

    await expect(beginPasskeyRegistration()).resolves.toMatchObject({ challenge: "reg-challenge" });

    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: "localhost",
        rpName: "Clean Pay",
        userName: "user@example.com",
        timeout: 120_000,
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
      }),
    );
    expect(mocks.generateRegistrationOptions.mock.calls[0]?.[0]).not.toHaveProperty("excludeCredentials");
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
    mocks.getCurrentSession.mockResolvedValueOnce({ ...session, assuranceLevel: "BOOTSTRAP" });

    await expect(
      finishPasskeyRegistration(registrationResponse()),
    ).resolves.toEqual({ success: true });

    expect(mocks.prisma.webAuthnChallenge.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "challenge-1", consumedAt: null }),
      data: { consumedAt: expect.any(Date) },
    });
    expect(mocks.prisma.webAuthnCredential.updateMany).toHaveBeenCalledWith({
      where: {
        credentialId: "credential-1",
        userId: "user-1",
        publicKey: { equals: Buffer.from([1, 2, 3]) },
      },
      data: expect.objectContaining({ name: "Рабочий ноутбук" }),
    });
    expect(mocks.prisma.webAuthnCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        credentialId: "credential-1",
        publicKey: Buffer.from([1, 2, 3]),
        counter: 0n,
        name: "Рабочий ноутбук",
      }),
    });
    expect(mocks.upgradeCurrentSessionToFull).toHaveBeenCalledOnce();
  });

  it("allows exactly one concurrent consumer of a WebAuthn challenge", async () => {
    mocks.prisma.webAuthnChallenge.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const results = await Promise.allSettled([
      finishPasskeyRegistration(registrationResponse()),
      finishPasskeyRegistration(registrationResponse()),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(mocks.prisma.webAuthnCredential.create).toHaveBeenCalledOnce();
  });

  it("updates a credential already owned by the current user", async () => {
    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(finishPasskeyRegistration(registrationResponse("Синхронизированный ключ"))).resolves.toEqual({ success: true });

    expect(mocks.prisma.webAuthnCredential.updateMany).toHaveBeenCalledWith({
      where: {
        credentialId: "credential-1",
        userId: "user-1",
        publicKey: { equals: Buffer.from([1, 2, 3]) },
      },
      data: expect.objectContaining({ name: "Синхронизированный ключ" }),
    });
    expect(mocks.prisma.webAuthnCredential.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty("publicKey");
    expect(mocks.prisma.webAuthnCredential.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty("counter");
    expect(mocks.prisma.webAuthnCredential.create).not.toHaveBeenCalled();
  });

  it("rejects a credential that is already owned by another user", async () => {
    mocks.prisma.webAuthnCredential.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.prisma.webAuthnCredential.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(finishPasskeyRegistration(registrationResponse())).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    expect(mocks.prisma.webAuthnCredential.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.webUser.update).not.toHaveBeenCalled();
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });

  it("rejects the same credential id when its verified public key changed", async () => {
    mocks.verifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: "credential-1",
          publicKey: new Uint8Array([9, 9, 9]),
          counter: 0,
        },
        aaguid: "aaguid",
        credentialBackedUp: true,
        credentialDeviceType: "multiDevice",
      },
    });
    mocks.prisma.webAuthnCredential.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.prisma.webAuthnCredential.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(finishPasskeyRegistration(registrationResponse())).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });

    expect(mocks.prisma.webAuthnCredential.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        credentialId: "credential-1",
        userId: "user-1",
        publicKey: { equals: Buffer.from([9, 9, 9]) },
      },
      data: expect.any(Object),
    });
  });

  it("finishes a concurrent registration when the credential was created by the same user", async () => {
    mocks.prisma.webAuthnCredential.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.prisma.webAuthnCredential.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(finishPasskeyRegistration(registrationResponse())).resolves.toEqual({ success: true });

    expect(mocks.prisma.webAuthnCredential.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.webUser.update).toHaveBeenCalledOnce();
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "passkey_registered", userId: "user-1" }));
  });

  it("does not clear a pending upstream merge when registering a passkey", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      user: {
        ...session.user,
        pendingRemnashopUserId: "101",
        pendingRemnashopEmail: "user@example.com",
      },
    });

    await expect(
      finishPasskeyRegistration(registrationResponse()),
    ).resolves.toEqual({ success: true });

    expect(mocks.prisma.webUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastLoginAt: expect.any(Date) },
    });
  });

  it("begins and finishes passkey login", async () => {
    await expect(beginPasskeyLogin()).resolves.toEqual({ challenge: "auth-challenge" });
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      action: "passkey_login_options",
    }));
    expect(mocks.prisma.webAuthnChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ challenge: "auth-challenge", type: "AUTHENTICATION" }),
    });

    mocks.prisma.webAuthnChallenge.findFirst.mockResolvedValueOnce({ id: "challenge-2", challenge: "auth-challenge" });
    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      finishPasskeyLogin({
        id: "credential-1",
        rawId: "credential-1",
        type: "public-key",
        response: {
          clientDataJSON: clientData("auth-challenge"),
          authenticatorData: "authenticator",
          signature: "signature",
          userHandle: undefined,
        },
        clientExtensionResults: {},
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.prisma.webAuthnCredential.updateMany).toHaveBeenCalledWith({
      where: { id: "db-credential-1", counter: 1n },
      data: { counter: 2n, lastUsedAt: expect.any(Date) },
    });
    expect(mocks.createWebSession).toHaveBeenCalledWith("user-1", {
      authMethod: "PASSKEY",
      assuranceLevel: "FULL",
    });
  });

  it("rejects a non-zero counter CAS conflict before creating a session", async () => {
    mocks.prisma.webAuthnChallenge.findFirst.mockResolvedValueOnce({ id: "challenge-2", challenge: "auth-challenge" });
    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(finishPasskeyLogin({
      id: "credential-1",
      rawId: "credential-1",
      type: "public-key",
      response: {
        clientDataJSON: clientData("auth-challenge"),
        authenticatorData: "authenticator",
        signature: "signature",
        userHandle: undefined,
      },
      clientExtensionResults: {},
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    expect(mocks.createWebSession).not.toHaveBeenCalled();
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "passkey_counter_conflict",
      severity: "WARN",
      userId: "user-1",
    }));
  });

  it("allows authenticators without counters to use the 0 to 0 branch", async () => {
    mocks.prisma.webAuthnChallenge.findFirst.mockResolvedValueOnce({ id: "challenge-2", challenge: "auth-challenge" });
    mocks.prisma.webAuthnCredential.findUnique.mockResolvedValueOnce({
      id: "db-credential-1",
      userId: "user-1",
      credentialId: "credential-1",
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0n,
      transports: ["internal"],
      user: session.user,
    });
    mocks.verifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    });

    await expect(finishPasskeyLogin({
      id: "credential-1",
      rawId: "credential-1",
      type: "public-key",
      response: {
        clientDataJSON: clientData("auth-challenge"),
        authenticatorData: "authenticator",
        signature: "signature",
        userHandle: undefined,
      },
      clientExtensionResults: {},
    })).resolves.toEqual({ success: true });

    expect(mocks.prisma.webAuthnCredential.update).toHaveBeenCalledWith({
      where: { id: "db-credential-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
    expect(mocks.prisma.webAuthnCredential.updateMany).not.toHaveBeenCalled();
    expect(mocks.createWebSession).toHaveBeenCalledOnce();
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

  it("applies the database e-mail policy before every FULL-session passkey action", async () => {
    const blocked = Object.assign(new Error("E-mail must be verified"), {
      code: "EMAIL_NOT_VERIFIED",
      status: 403,
    });
    mocks.getCurrentSession.mockResolvedValue({
      ...session,
      user: { ...session.user, emailVerified: false, telegramId: null },
    });
    mocks.assertEmailVerificationPolicy.mockImplementation(() => {
      throw blocked;
    });

    await expect(beginPasskeyRegistration()).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
      status: 403,
    });
    await expect(finishPasskeyRegistration(registrationResponse())).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
      status: 403,
    });
    await expect(listPasskeys()).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
      status: 403,
    });
    await expect(deletePasskey("credential-1")).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
      status: 403,
    });

    expect(mocks.assertEmailVerificationPolicy).toHaveBeenCalledTimes(4);
    expect(mocks.generateRegistrationOptions).not.toHaveBeenCalled();
    expect(mocks.prisma.webAuthnChallenge.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.webAuthnCredential.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.webAuthnCredential.findFirst).not.toHaveBeenCalled();
  });

  it("keeps BOOTSTRAP registration exempt and allows Telegram-backed FULL sessions", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      assuranceLevel: "BOOTSTRAP",
      user: { ...session.user, emailVerified: false, telegramId: null },
    });
    await expect(beginPasskeyRegistration()).resolves.toMatchObject({
      challenge: "reg-challenge",
    });
    expect(mocks.assertEmailVerificationPolicy).not.toHaveBeenCalled();

    mocks.getCurrentSession.mockResolvedValueOnce({
      ...session,
      user: { ...session.user, emailVerified: false, telegramId: "123" },
    });
    await expect(listPasskeys()).resolves.toEqual({ credentials: [] });
    expect(mocks.assertEmailVerificationPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: false, telegramId: "123" }),
    );
  });

  it("throws BFF errors for missing sessions, invalid challenges and last passkey delete", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null);
    await expect(beginPasskeyRegistration()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

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
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    mocks.prisma.webAuthnCredential.findFirst.mockResolvedValueOnce({ id: "only", credentialId: "cred-only" });
    mocks.prisma.webAuthnCredential.count.mockResolvedValueOnce(1);
    await expect(deletePasskey("only")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
