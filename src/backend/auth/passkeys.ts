import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential as SimpleWebAuthnCredential,
} from "@simplewebauthn/server";
import { WebAuthnChallengeType, WebSessionAssuranceLevel, WebSessionAuthMethod } from "@prisma/client";

import { auditLog } from "@/backend/observability/audit";
import { getEnv } from "@/backend/config/env";
import { prisma } from "@/backend/database/prisma";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { createWebSession, getCurrentSession, upgradeCurrentSessionToFull } from "@/backend/sessions/web-session";

const challengeTtlMs = 5 * 60 * 1000;

function addMs(date: Date, ms: number) {
  return new Date(date.getTime() + ms);
}

function webAuthnRelyingParty() {
  const env = getEnv();
  const origin = env.publicAppUrl;
  const rpID = new URL(origin).hostname;

  return {
    rpID,
    rpName: env.branding.name,
    origin,
  };
}

function userHandle(userId: string) {
  return Buffer.from(userId, "utf8");
}

async function consumeChallenge(challenge: string, type: WebAuthnChallengeType) {
  const record = await prisma.webAuthnChallenge.findFirst({
    where: {
      challenge,
      type,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!record) {
    throw new BffError("VALIDATION_ERROR", 400, "WebAuthn challenge is invalid or expired");
  }

  await prisma.webAuthnChallenge.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  return record;
}

function challengeFromClientDataJSON(clientDataJSON: unknown) {
  if (typeof clientDataJSON !== "string") {
    throw new BffError("VALIDATION_ERROR", 400, "WebAuthn client data is required");
  }

  try {
    const data = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as {
      challenge?: unknown;
    };

    if (typeof data.challenge !== "string" || !data.challenge) {
      throw new Error("Missing challenge");
    }

    return data.challenge;
  } catch {
    throw new BffError("VALIDATION_ERROR", 400, "WebAuthn client data is invalid");
  }
}

function clientDataJSONFromCredentialResponse(response: unknown) {
  if (!response || typeof response !== "object" || !("response" in response)) {
    throw new BffError("VALIDATION_ERROR", 400, "WebAuthn response is required");
  }

  const credentialResponse = (response as { response?: unknown }).response;

  if (!credentialResponse || typeof credentialResponse !== "object" || !("clientDataJSON" in credentialResponse)) {
    throw new BffError("VALIDATION_ERROR", 400, "WebAuthn client data is required");
  }

  return (credentialResponse as { clientDataJSON?: unknown }).clientDataJSON;
}

function toSimpleCredential(credential: {
  credentialId: string;
  publicKey: Uint8Array;
  counter: bigint;
  transports: string[];
}): SimpleWebAuthnCredential {
  return {
    id: credential.credentialId,
    publicKey: new Uint8Array(credential.publicKey),
    counter: Number(credential.counter),
    transports: credential.transports as SimpleWebAuthnCredential["transports"],
  };
}

export async function beginPasskeyRegistration() {
  const session = await getCurrentSession();

  if (!session) {
    throw new BffError("UNAUTHORIZED", 401, "Session is required");
  }

  const { rpID, rpName } = webAuthnRelyingParty();
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId: session.userId },
    select: { credentialId: true, transports: true },
  });
  const userName = session.user.email ?? session.user.telegramUsername ?? session.user.telegramId ?? session.userId;
  const options = await generateRegistrationOptions({
    rpID,
    rpName,
    userID: userHandle(session.userId),
    userName,
    userDisplayName: session.user.displayName ?? session.user.fullName ?? userName,
    timeout: 60_000,
    attestationType: "none",
    excludeCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as SimpleWebAuthnCredential["transports"],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  await prisma.webAuthnChallenge.create({
    data: {
      challenge: options.challenge,
      type: WebAuthnChallengeType.REGISTRATION,
      userId: session.userId,
      expiresAt: addMs(new Date(), challengeTtlMs),
    },
  });

  return options;
}

export async function finishPasskeyRegistration(response: RegistrationResponseJSON) {
  const session = await getCurrentSession();

  if (!session) {
    throw new BffError("UNAUTHORIZED", 401, "Session is required");
  }

  const challenge = await consumeChallenge(
    challengeFromClientDataJSON(clientDataJSONFromCredentialResponse(response)),
    WebAuthnChallengeType.REGISTRATION,
  );

  if (challenge.userId !== session.userId) {
    throw new BffError("FORBIDDEN", 403, "WebAuthn challenge belongs to another user");
  }

  const { rpID, origin } = webAuthnRelyingParty();
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  }).catch(() => {
    throw new BffError("VALIDATION_ERROR", 400, "Passkey registration failed");
  });

  if (!result.verified) {
    throw new BffError("VALIDATION_ERROR", 400, "Passkey registration failed");
  }

  const { credential, aaguid, credentialBackedUp, credentialDeviceType } = result.registrationInfo;

  await prisma.webAuthnCredential.upsert({
    where: { credentialId: credential.id },
    create: {
      userId: session.userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: response.response.transports ?? [],
      aaguid,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: "Ключ доступа",
      lastUsedAt: new Date(),
    },
    update: {
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: response.response.transports ?? [],
      aaguid,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      lastUsedAt: new Date(),
    },
  });
  await prisma.webUser.update({
    where: { id: session.userId },
    data: {
      authPending: false,
      lastLoginAt: new Date(),
    },
  });

  const upgradedSession = session.assuranceLevel === WebSessionAssuranceLevel.FULL
    ? session
    : await upgradeCurrentSessionToFull();

  await auditLog({
    action: "passkey_registered",
    userId: session.userId,
    metadata: { credentialId: credential.id, upgraded: Boolean(upgradedSession) },
  });

  return { success: true };
}

export async function beginPasskeyLogin() {
  const { rpID } = webAuthnRelyingParty();
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 60_000,
    userVerification: "required",
  });

  await prisma.webAuthnChallenge.create({
    data: {
      challenge: options.challenge,
      type: WebAuthnChallengeType.AUTHENTICATION,
      expiresAt: addMs(new Date(), challengeTtlMs),
    },
  });

  return options;
}

export async function finishPasskeyLogin(response: AuthenticationResponseJSON) {
  const challenge = await consumeChallenge(
    challengeFromClientDataJSON(clientDataJSONFromCredentialResponse(response)),
    WebAuthnChallengeType.AUTHENTICATION,
  );
  const credential = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: response.id },
    include: { user: true },
  });

  if (!credential) {
    throw new BffError("UNAUTHORIZED", 401, "Passkey was not found");
  }

  const { rpID, origin } = webAuthnRelyingParty();
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: toSimpleCredential(credential),
    requireUserVerification: true,
  }).catch(() => {
    throw new BffError("UNAUTHORIZED", 401, "Passkey verification failed");
  });

  if (!result.verified) {
    throw new BffError("UNAUTHORIZED", 401, "Passkey verification failed");
  }

  await prisma.webAuthnCredential.update({
    where: { id: credential.id },
    data: {
      counter: BigInt(result.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });
  const session = await createWebSession(credential.userId, {
    authMethod: WebSessionAuthMethod.PASSKEY,
    assuranceLevel: WebSessionAssuranceLevel.FULL,
  });

  await auditLog({
    action: "passkey_login",
    userId: credential.userId,
    metadata: { credentialId: credential.credentialId, sessionId: session.id },
  });

  return { success: true };
}

export async function listPasskeys() {
  const session = await getCurrentSession();

  if (!session || session.assuranceLevel !== WebSessionAssuranceLevel.FULL) {
    throw new BffError("UNAUTHORIZED", 401, "Full session is required");
  }

  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      credentialId: true,
      name: true,
      transports: true,
      deviceType: true,
      backedUp: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return { credentials };
}

export async function deletePasskey(credentialId: string) {
  const session = await getCurrentSession();

  if (!session || session.assuranceLevel !== WebSessionAssuranceLevel.FULL) {
    throw new BffError("UNAUTHORIZED", 401, "Full session is required");
  }

  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId: session.userId },
    select: { id: true },
  });

  if (credentials.length <= 1) {
    throw new BffError("FORBIDDEN", 403, "Last passkey cannot be deleted");
  }

  const credential = await prisma.webAuthnCredential.findFirst({
    where: {
      id: credentialId,
      userId: session.userId,
    },
  });

  if (!credential) {
    throw new BffError("NOT_FOUND", 404, "Passkey was not found");
  }

  await prisma.webAuthnCredential.delete({
    where: { id: credential.id },
  });
  await auditLog({
    action: "passkey_deleted",
    userId: session.userId,
    metadata: { credentialId: credential.credentialId },
  });

  return { success: true };
}
