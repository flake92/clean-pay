import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential as SimpleWebAuthnCredential,
} from "@simplewebauthn/server";
import { WebAuthnChallengeType, WebSessionAssuranceLevel, WebSessionAuthMethod } from "@prisma/client";
import { headers } from "next/headers";

import {
  PasskeyGatewayError,
  type PasskeyChallenge,
  type PasskeyCommands,
  type PasskeyCredential,
} from "@/application/auth/ports/passkey-commands";
import { claimWebAuthnChallenge } from "@/backend/auth/one-time-state";
import { getEnv } from "@/backend/config/env";
import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import { withAuthConcurrency, assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { verifyTurnstileToken } from "@/backend/security/turnstile";
import {
  createWebSession,
  getCurrentSession,
  upgradeCurrentSessionToFull,
} from "@/backend/integrations/sessions/web-session-service";
import { recordPasskeyUse } from "@/backend/integrations/auth/passkey-service";
import { getAuthorizedRemnashopTokens } from "@/backend/integrations/remnashop/client";
import { authDebugLog } from "@/backend/observability/auth-debug-log";

const challengeTtlMs = 5 * 60 * 1000;
const maxPasskeyNameLength = 80;

type RegistrationResponse = RegistrationResponseJSON & { name?: string };
type StoredCredential = NonNullable<Awaited<ReturnType<typeof prisma.webAuthnCredential.findUnique>>>;

function translate(error: unknown): never {
  if (error instanceof PasskeyGatewayError) throw error;
  if (error instanceof ServiceError) throw new PasskeyGatewayError(error.code);
  throw error;
}

async function adapt<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { translate(error); }
}

function clientChallenge(response: unknown) {
  try {
    const credentialResponse = (response as { response?: { clientDataJSON?: unknown } })?.response;
    if (typeof credentialResponse?.clientDataJSON !== "string") throw new Error();
    const data = JSON.parse(Buffer.from(credentialResponse.clientDataJSON, "base64url").toString("utf8")) as { challenge?: unknown };
    if (typeof data.challenge !== "string" || !data.challenge) throw new Error();
    return data.challenge;
  } catch {
    throw new PasskeyGatewayError("VALIDATION_ERROR");
  }
}

async function consumeChallenge(response: unknown, type: WebAuthnChallengeType): Promise<PasskeyChallenge> {
  const now = new Date();
  const record = await prisma.webAuthnChallenge.findFirst({
    where: { challenge: clientChallenge(response), type, consumedAt: null, expiresAt: { gt: now } },
  });
  if (!record || !await claimWebAuthnChallenge(record.id, now)) throw new PasskeyGatewayError("VALIDATION_ERROR");
  return { context: record, challenge: record.challenge, userId: record.userId };
}

function relyingParty() {
  const env = getEnv();
  return { rpID: new URL(env.publicAppUrl).hostname, rpName: env.branding.name, origin: env.publicAppUrl };
}

function credentialContext(credential: PasskeyCredential) {
  return credential.context as StoredCredential;
}

function normalizeName(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, maxPasskeyNameLength);
  return normalized || null;
}

function inferredName(userAgent: string | null) {
  const value = userAgent ?? "";
  const platform = /iphone/i.test(value) ? "iPhone" : /ipad/i.test(value) ? "iPad" : /android/i.test(value) ? "Android"
    : /windows/i.test(value) ? "Windows" : /mac os|macintosh/i.test(value) ? "macOS" : /linux/i.test(value) ? "Linux" : "Устройство";
  const browser = /edg\//i.test(value) ? "Edge" : /firefox\//i.test(value) ? "Firefox"
    : /chrome\//i.test(value) || /crios\//i.test(value) ? "Chrome" : /safari\//i.test(value) ? "Safari" : "браузер";
  return `${platform} ${browser}`;
}

function simpleCredential(credential: StoredCredential): SimpleWebAuthnCredential {
  return {
    id: credential.credentialId,
    publicKey: new Uint8Array(credential.publicKey),
    counter: Number(credential.counter),
    transports: credential.transports as SimpleWebAuthnCredential["transports"],
  };
}

export const productionPasskeyCommands: PasskeyCommands = {
  verifyHuman: (token) => verifyTurnstileToken(token, "auth_login"),

  async loadRegistrationActor() {
    const session = await adapt(() => getCurrentSession());
    if (!session) return null;
    return {
      context: session,
      userId: session.userId,
      assuranceLevel: session.assuranceLevel === WebSessionAssuranceLevel.FULL ? "FULL" : "BOOTSTRAP",
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      telegramId: session.user.telegramId,
      telegramUsername: session.user.telegramUsername,
      displayName: session.user.displayName,
      fullName: session.user.fullName,
      hasPendingAccountMerge: Boolean(session.user.pendingRemnashopUserId && session.user.pendingRemnashopEmail),
    };
  },

  async generateRegistrationOptions(actor) {
    const { rpID, rpName } = relyingParty();
    const userName = actor.email ?? actor.telegramUsername ?? actor.telegramId ?? actor.userId;
    return generateRegistrationOptions({
      rpID,
      rpName,
      userID: Buffer.from(actor.userId, "utf8"),
      userName,
      userDisplayName: actor.displayName ?? actor.fullName ?? userName,
      timeout: 120_000,
      attestationType: "none",
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
    });
  },

  registrationChallenge(options) {
    const challenge = (options as { challenge?: unknown }).challenge;
    if (typeof challenge !== "string") throw new PasskeyGatewayError("INTERNAL_ERROR");
    return challenge;
  },

  async storeRegistrationChallenge(actor, challenge) {
    await prisma.webAuthnChallenge.create({
      data: { challenge, type: WebAuthnChallengeType.REGISTRATION, userId: actor.userId, expiresAt: new Date(Date.now() + challengeTtlMs) },
    });
  },

  consumeRegistrationChallenge: (response) => consumeChallenge(response, WebAuthnChallengeType.REGISTRATION),

  async verifyRegistration(response, challenge) {
    const { rpID, origin } = relyingParty();
    const result = await verifyRegistrationResponse({
      response: response as RegistrationResponse,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    }).catch(() => { throw new PasskeyGatewayError("VALIDATION_ERROR"); });
    if (!result.verified) throw new PasskeyGatewayError("VALIDATION_ERROR");
    return { context: result.registrationInfo, credentialId: result.registrationInfo.credential.id };
  },

  async persistRegistration(actor, rawResponse, verified) {
    const response = rawResponse as RegistrationResponse;
    const info = verified.context as NonNullable<Awaited<ReturnType<typeof verifyRegistrationResponse>>["registrationInfo"]>;
    const { credential, aaguid, credentialBackedUp, credentialDeviceType } = info;
    const requestHeaders = await headers();
    const publicKey = Buffer.from(credential.publicKey);
    const data = {
      transports: response.response.transports ?? [], aaguid, deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: normalizeName(response.name) ?? inferredName(requestHeaders.get("user-agent")),
      lastUsedAt: new Date(),
    };
    const updateOwned = () => prisma.webAuthnCredential.updateMany({
      where: { credentialId: credential.id, userId: actor.userId, publicKey: { equals: publicKey } }, data,
    });
    if ((await updateOwned()).count !== 0) return;
    try {
      await prisma.webAuthnCredential.create({
        data: { userId: actor.userId, credentialId: credential.id, publicKey, counter: BigInt(credential.counter), ...data },
      });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
      if ((await updateOwned()).count === 0) throw new PasskeyGatewayError("CONFLICT");
    }
  },

  async markRegistrationComplete(actor) {
    await prisma.webUser.update({
      where: { id: actor.userId },
      data: { ...(actor.hasPendingAccountMerge ? {} : { authPending: false }), lastLoginAt: new Date() },
    });
  },

  async upgradeRegistrationSession() { await adapt(() => upgradeCurrentSessionToFull()).then(() => undefined); },
  async auditRegistration(actor, registration, upgraded) {
    await adapt(() => auditLog({ action: "passkey_registered", userId: actor.userId, metadata: { credentialId: registration.credentialId, upgraded } }));
  },

  async assertLoginOptionsRateLimit(email) {
    await adapt(() => assertRateLimit({ action: "passkey_login_options", email, limit: 20, windowSeconds: 15 * 60 }));
  },
  withLoginOptionsConcurrency: (work) => adapt(() => withAuthConcurrency("passkey_login_options", work)),

  async findLoginAccount(email) {
    const user = await prisma.webUser.findUnique({
      where: { email }, select: { id: true, webAuthnCredentials: { select: { credentialId: true, transports: true } } },
    });
    return user ? {
      context: user,
      userId: user.id,
      credentials: user.webAuthnCredentials.map((item) => ({ id: item.credentialId, transports: item.transports })),
    } : null;
  },

  async generateLoginOptions(account) {
    const { rpID } = relyingParty();
    return generateAuthenticationOptions({
      rpID, timeout: 60_000, userVerification: "required",
      allowCredentials: account.credentials.map((item) => ({ id: item.id, transports: item.transports as AuthenticatorTransportFuture[] })),
    });
  },
  loginChallenge(options) {
    const challenge = (options as { challenge?: unknown }).challenge;
    if (typeof challenge !== "string") throw new PasskeyGatewayError("INTERNAL_ERROR");
    return challenge;
  },
  async storeLoginChallenge(account, challenge) {
    await prisma.webAuthnChallenge.create({
      data: { challenge, type: WebAuthnChallengeType.AUTHENTICATION, userId: account.userId, expiresAt: new Date(Date.now() + challengeTtlMs) },
    });
  },
  async assertLoginVerificationRateLimit() {
    await adapt(() => assertRateLimit({ action: "passkey_login_verify", limit: 50, windowSeconds: 15 * 60 }));
  },
  consumeLoginChallenge: (response) => consumeChallenge(response, WebAuthnChallengeType.AUTHENTICATION),

  async findCredential(response) {
    const credentialId = (response as { id?: unknown })?.id;
    if (typeof credentialId !== "string") throw new PasskeyGatewayError("VALIDATION_ERROR");
    const credential = await prisma.webAuthnCredential.findUnique({ where: { credentialId }, include: { user: true } });
    return credential ? {
      context: credential, id: credential.id, userId: credential.userId,
      credentialId: credential.credentialId, oldCounter: credential.counter,
    } : null;
  },

  async verifyAuthentication(response, challenge, credential) {
    const { rpID, origin } = relyingParty();
    const result = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: simpleCredential(credentialContext(credential)),
      requireUserVerification: true,
    }).catch(() => { throw new PasskeyGatewayError("UNAUTHORIZED"); });
    if (!result.verified) throw new PasskeyGatewayError("UNAUTHORIZED");
    return { newCounter: BigInt(result.authenticationInfo.newCounter) };
  },

  async recordAuthentication(credential, verification) {
    await adapt(() => recordPasskeyUse({
      id: credential.id, userId: credential.userId, credentialId: credential.credentialId,
      oldCounter: credential.oldCounter, newCounter: verification.newCounter,
    }));
  },
  async createAuthenticatedSession(userId) {
    const session = await adapt(() => createWebSession(userId, {
      authMethod: WebSessionAuthMethod.PASSKEY,
      assuranceLevel: WebSessionAssuranceLevel.FULL,
    }));

    // A passkey proves the local account but does not itself carry the
    // Remnashop token pair. Restore that pair while this Server Action is
    // still allowed to persist tokens, so the first cabinet render is fully
    // authorized instead of showing a contradictory re-login prompt.
    try {
      await getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true });
    } catch (error) {
      // The local passkey login remains valid when the provider is temporarily
      // unavailable. Request-scoped readers will fall back to the local
      // profile and a later command can retry upstream recovery.
      authDebugLog("passkey_upstream_session_restore_deferred", {
        sessionId: session.id,
        userId,
        code: error instanceof ServiceError ? error.code : "INTERNAL_ERROR",
      });
    }

    return session;
  },
  async auditLogin(credential, sessionId) {
    await adapt(() => auditLog({ action: "passkey_login", userId: credential.userId, metadata: { credentialId: credential.credentialId, sessionId } }));
  },
};
