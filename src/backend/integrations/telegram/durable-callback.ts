import {
  AccountMergeConfirmationStatus,
  Prisma,
  TelegramCallbackStatus,
} from "@prisma/client";

import type {
  ConsumedTelegramCallback,
  TelegramCallbackOutcome,
  VerifiedTelegramCallback,
} from "@/application/auth/ports/telegram-callback";
import { getEnv } from "@/backend/config/env";
import { prisma } from "@/backend/database/prisma";
import { createDurableCallbackWebSession } from "@/backend/integrations/sessions/web-session-service";
import { telegramAccountMergeCookieMaxAgeSeconds } from "@/backend/integrations/auth/telegram-account-merge-store";
import { revokedWebSessionData } from "@/backend/integrations/sessions/web-session-revocation";
import { recordOperationalEvent } from "@/backend/observability/metrics";
import { securityPolicy } from "@/backend/security/policy";
import {
  decryptKeyringSecret,
  encryptKeyringSecret,
  randomToken,
  safeEqual,
  sha256,
} from "@/backend/security/crypto";

const CALLBACK_RESULT_PURPOSE = "telegram-oidc-callback-result";
export const DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS = 10 * 60 * 1000;
// A claimed callback may keep a resumable lease for at most this long after
// the original READY state expires. This absolute deadline makes the browser
// proof lifetime finite while still leaving a full lost-response replay
// window after the latest possible successful commit.
export const DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS = 10 * 60 * 1000;
const CALLBACK_LEASE_MS = 2 * 60 * 1000;
const CALLBACK_RESULT_MAX_BYTES = 256 * 1024;

const resumableStatuses = new Set<TelegramCallbackStatus>([
  TelegramCallbackStatus.PROVIDER_READY,
  TelegramCallbackStatus.IDENTITY_VERIFIED,
  TelegramCallbackStatus.PROVIDER_AUTHENTICATED,
  TelegramCallbackStatus.IDENTITY_RESOLVED,
  TelegramCallbackStatus.OUTCOME_READY,
  TelegramCallbackStatus.SESSION_CREATED,
]);

export class DurableTelegramCallbackClaimConflictError extends Error {
  constructor() {
    super("Telegram callback identity claim ownership changed");
    this.name = "DurableTelegramCallbackClaimConflictError";
  }
}

export type TelegramCallbackCookieProof = {
  stateHash: string;
  nonceHash: string;
  codeVerifierHash: string;
};

export type DurableTelegramCallbackOwnership = {
  authStateId: string;
  stateHash: string;
  codeHash: string;
  claimToken: string;
};

export type DurableTelegramCallbackReplay = {
  redirectTo: string;
  session?: {
    webSessionId: string;
    userId: string;
    bootstrapRefreshToken: string;
    requiresTelegramRecovery: boolean;
  };
  mergeConfirmation?: { token: string };
  audit: { userId: string; remnashopLinked: boolean };
};

export type DurableTelegramCallbackCheckpoint =
  | {
      phase: "PROVIDER_READY";
      authState: {
        id: string;
        targetUserId: string | null;
        redirectTo: string | null;
      };
    }
  | { phase: "IDENTITY_VERIFIED"; verified: VerifiedTelegramCallback }
  | { phase: "PROVIDER_AUTHENTICATED"; verified: VerifiedTelegramCallback }
  | { phase: "IDENTITY_RESOLVED"; consumed: ConsumedTelegramCallback }
  | { phase: "OUTCOME_READY"; outcome: TelegramCallbackOutcome }
  | { phase: "SESSION_CREATED"; replay: DurableTelegramCallbackReplay };

type StoredCheckpoint = {
  version: 2;
  phase: TelegramCallbackStatus;
  value: unknown;
};

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown, maximum = 4_096) {
  return value === null || value === undefined || boundedString(value, maximum);
}

function assertProviderSession(value: unknown) {
  if (value === null) return;
  if (!isRecord(value) || !isRecord(value.context)) {
    throw new Error("Invalid durable Telegram provider session");
  }
  const context = value.context;
  if (!isRecord(context.cookies) || !isRecord(context.data)) {
    throw new Error("Invalid durable Telegram provider session context");
  }
  if (
    !boundedString(context.cookies.accessToken, 32_768)
    || !boundedString(context.cookies.refreshToken, 32_768)
    || !boundedString(context.data.expires_at, 256)
    || !boundedString(context.data.refresh_expires_at, 256)
  ) {
    throw new Error("Invalid durable Telegram provider credentials");
  }
}

function parseVerified(value: unknown): VerifiedTelegramCallback {
  if (!isRecord(value) || !isRecord(value.authState) || !isRecord(value.identity)) {
    throw new Error("Invalid durable verified Telegram callback");
  }
  const { authState, identity } = value;
  if (
    !boundedString(authState.id, 256)
    || !nullableString(authState.targetUserId, 256)
    || !nullableString(authState.redirectTo, 512)
    || !boundedString(identity.telegramId, 64)
    || !nullableString(identity.telegramUsername, 256)
    || !nullableString(identity.fullName, 512)
    || !nullableString(identity.photoUrl, 2_048)
  ) {
    throw new Error("Invalid durable verified Telegram identity");
  }
  assertProviderSession(identity.providerSession);
  return value as VerifiedTelegramCallback;
}

function parseProviderReady(value: unknown) {
  if (!isRecord(value) || !isRecord(value.authState)) {
    throw new Error("Invalid durable Telegram provider-ready checkpoint");
  }
  const authState = value.authState;
  if (
    !boundedString(authState.id, 256)
    || !nullableString(authState.targetUserId, 256)
    || !nullableString(authState.redirectTo, 512)
  ) {
    throw new Error("Invalid durable Telegram provider-ready auth state");
  }
  return {
    id: authState.id as string,
    targetUserId:
      (authState.targetUserId as string | null | undefined) ?? null,
    redirectTo:
      (authState.redirectTo as string | null | undefined) ?? null,
  };
}

function parseConsumed(value: unknown): ConsumedTelegramCallback {
  if (!isRecord(value) || !isRecord(value.user)) {
    throw new Error("Invalid durable consumed Telegram callback");
  }
  if (
    !boundedString(value.user.id, 256)
    || !nullableString(value.user.upstreamAccountId, 256)
    || !nullableString(value.user.email, 512)
    || typeof value.user.emailVerified !== "boolean"
    || !nullableString(value.user.telegramId, 64)
    || !nullableString(value.redirectTo, 512)
    || typeof value.linked !== "boolean"
    || !boundedString(value.telegramId, 64)
    || !nullableString(value.telegramUsername, 256)
  ) {
    throw new Error("Invalid durable consumed Telegram identity");
  }
  assertProviderSession(value.providerSession);
  if (value.mergeConfirmation !== null) {
    if (
      !isRecord(value.mergeConfirmation)
      || typeof value.mergeConfirmation.required !== "boolean"
      || !boundedString(value.mergeConfirmation.token, 4_096)
    ) {
      throw new Error("Invalid durable Telegram merge checkpoint");
    }
  }
  return value as ConsumedTelegramCallback;
}

function parseOutcome(value: unknown): TelegramCallbackOutcome {
  if (!isRecord(value) || !isRecord(value.audit)) {
    throw new Error("Invalid durable Telegram callback outcome");
  }
  if (
    !boundedString(value.redirectTo, 512)
    || !boundedString(value.audit.userId, 256)
    || typeof value.audit.remnashopLinked !== "boolean"
  ) {
    throw new Error("Invalid durable Telegram callback audit outcome");
  }
  if (value.mergeConfirmation !== undefined) {
    if (
      !isRecord(value.mergeConfirmation)
      || !boundedString(value.mergeConfirmation.token, 4_096)
    ) {
      throw new Error("Invalid durable Telegram merge outcome");
    }
  }
  if (value.session !== undefined) {
    if (
      !isRecord(value.session)
      || !boundedString(value.session.userId, 256)
      || typeof value.session.requiresTelegramRecovery !== "boolean"
    ) {
      throw new Error("Invalid durable Telegram session outcome");
    }
    if (value.session.remnashopSession !== undefined) {
      const provider = value.session.remnashopSession;
      if (
        !isRecord(provider)
        || !boundedString(provider.accessTokenEncrypted, 64 * 1024)
        || !boundedString(provider.refreshTokenEncrypted, 64 * 1024)
        || !boundedString(provider.accessExpiresAt, 256)
        || !boundedString(provider.refreshExpiresAt, 256)
      ) {
        throw new Error("Invalid durable Telegram stored provider outcome");
      }
      const accessExpiresAt = new Date(provider.accessExpiresAt);
      const refreshExpiresAt = new Date(provider.refreshExpiresAt);
      if (
        Number.isNaN(accessExpiresAt.getTime())
        || Number.isNaN(refreshExpiresAt.getTime())
      ) {
        throw new Error("Invalid durable Telegram provider expiry");
      }
      provider.accessExpiresAt = accessExpiresAt;
      provider.refreshExpiresAt = refreshExpiresAt;
    }
  }
  if (Boolean(value.session) === Boolean(value.mergeConfirmation)) {
    throw new Error("Durable Telegram outcome must have one bootstrap result");
  }
  return value as unknown as TelegramCallbackOutcome;
}

function parseReplay(value: unknown): DurableTelegramCallbackReplay {
  if (!isRecord(value) || !isRecord(value.audit)) {
    throw new Error("Invalid durable Telegram replay");
  }
  if (
    !boundedString(value.redirectTo, 512)
    || !boundedString(value.audit.userId, 256)
    || typeof value.audit.remnashopLinked !== "boolean"
  ) {
    throw new Error("Invalid durable Telegram replay audit");
  }
  if (value.session !== undefined) {
    if (
      !isRecord(value.session)
      || !boundedString(value.session.webSessionId, 256)
      || !boundedString(value.session.userId, 256)
      || !boundedString(value.session.bootstrapRefreshToken, 4_096)
      || typeof value.session.requiresTelegramRecovery !== "boolean"
    ) {
      throw new Error("Invalid durable Telegram replay session");
    }
  }
  if (value.mergeConfirmation !== undefined) {
    if (
      !isRecord(value.mergeConfirmation)
      || !boundedString(value.mergeConfirmation.token, 4_096)
    ) {
      throw new Error("Invalid durable Telegram replay merge confirmation");
    }
  }
  if (Boolean(value.session) === Boolean(value.mergeConfirmation)) {
    throw new Error("Durable Telegram replay must have one bootstrap result");
  }
  return value as DurableTelegramCallbackReplay;
}

function protectStored(value: StoredCheckpoint) {
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload, "utf8") > CALLBACK_RESULT_MAX_BYTES) {
    throw new Error("Durable Telegram callback checkpoint is too large");
  }
  return encryptKeyringSecret(
    payload,
    getEnv().webRefreshKeyring,
    CALLBACK_RESULT_PURPOSE,
  );
}

function protectCheckpoint(
  phase: TelegramCallbackStatus,
  value: unknown,
) {
  return protectStored({ version: 2, phase, value });
}

function revealStored(encrypted: string) {
  const revealed = decryptKeyringSecret(
    encrypted,
    getEnv().webRefreshKeyring,
    CALLBACK_RESULT_PURPOSE,
  );
  const stored = JSON.parse(revealed.value) as Partial<StoredCheckpoint>;
  if (stored.version !== 2 || typeof stored.phase !== "string") {
    throw new Error("Invalid durable Telegram callback checkpoint envelope");
  }
  return { stored, revealed };
}

function parseCheckpoint(
  status: TelegramCallbackStatus,
  encrypted: string,
) {
  const { stored, revealed } = revealStored(encrypted);
  if (stored.phase !== status) {
    throw new Error("Durable Telegram callback phase mismatch");
  }
  let checkpoint: DurableTelegramCallbackCheckpoint;
  switch (status) {
    case TelegramCallbackStatus.PROVIDER_READY:
      checkpoint = {
        phase: "PROVIDER_READY",
        authState: parseProviderReady(stored.value),
      };
      break;
    case TelegramCallbackStatus.IDENTITY_VERIFIED:
      checkpoint = { phase: "IDENTITY_VERIFIED", verified: parseVerified(stored.value) };
      break;
    case TelegramCallbackStatus.PROVIDER_AUTHENTICATED:
      checkpoint = { phase: "PROVIDER_AUTHENTICATED", verified: parseVerified(stored.value) };
      break;
    case TelegramCallbackStatus.IDENTITY_RESOLVED:
      checkpoint = { phase: "IDENTITY_RESOLVED", consumed: parseConsumed(stored.value) };
      break;
    case TelegramCallbackStatus.OUTCOME_READY:
      checkpoint = { phase: "OUTCOME_READY", outcome: parseOutcome(stored.value) };
      break;
    case TelegramCallbackStatus.SESSION_CREATED:
      checkpoint = { phase: "SESSION_CREATED", replay: parseReplay(stored.value) };
      break;
    default:
      throw new Error("Telegram callback phase is not resumable");
  }
  return {
    checkpoint,
    plaintext: revealed.value,
    needsRewrap: revealed.needsRewrap,
  };
}

function replayFromOutcome(
  outcome: TelegramCallbackOutcome,
  webSessionId?: string,
  bootstrapRefreshToken?: string,
): DurableTelegramCallbackReplay {
  if (outcome.session && (!webSessionId || !bootstrapRefreshToken)) {
    throw new Error("Durable Telegram callback is missing session bootstrap credentials");
  }
  return {
    redirectTo: outcome.redirectTo,
    ...(outcome.session
      ? {
          session: {
            webSessionId: webSessionId!,
            userId: outcome.session.userId,
            bootstrapRefreshToken: bootstrapRefreshToken!,
            requiresTelegramRecovery: outcome.session.requiresTelegramRecovery,
          },
        }
      : {}),
    ...(outcome.mergeConfirmation
      ? { mergeConfirmation: { token: outcome.mergeConfirmation.token } }
      : {}),
    audit: outcome.audit,
  };
}

function callbackWorkWindowWhere(now: Date) {
  return {
    expiresAt: {
      gt: new Date(
        now.getTime() - DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS,
      ),
    },
  };
}

function ownershipWhere(
  ownership: DurableTelegramCallbackOwnership,
  status: TelegramCallbackStatus,
  now?: Date,
) {
  return {
    id: ownership.authStateId,
    stateHash: ownership.stateHash,
    callbackCodeHash: ownership.codeHash,
    callbackClaimTokenHash: sha256(ownership.claimToken),
    callbackStatus: status,
    ...(now ? callbackWorkWindowWhere(now) : {}),
  };
}

export async function runWithDurableTelegramCallbackLease<T>(
  ownership: DurableTelegramCallbackOwnership,
  status:
    | DurableTelegramCallbackCheckpoint["phase"]
    | "RECOVERY_DISPATCHING",
  work: () => Promise<T>,
  options: {
    heartbeatMs?: number;
    now?: () => Date;
  } = {},
) {
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const clock = options.now ?? (() => new Date());
  let ownershipLost = false;
  let pendingRenewal = Promise.resolve();
  const renew = async () => {
    const now = clock();
    const renewed = await prisma.telegramAuthState.updateMany({
      where: ownershipWhere(ownership, status, now),
      data: {
        callbackLeaseExpiresAt: new Date(
          now.getTime() + CALLBACK_LEASE_MS,
        ),
        callbackResultExpiresAt: new Date(
          now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
        ),
      },
    });
    if (renewed.count !== 1) ownershipLost = true;
  };

  await renew();
  if (ownershipLost) {
    recordOperationalEvent("telegram_callback_lease_ownership_lost");
    throw new DurableTelegramCallbackClaimConflictError();
  }
  const timer = setInterval(() => {
    pendingRenewal = pendingRenewal
      .then(renew)
      .catch(() => {
        ownershipLost = true;
      });
  }, heartbeatMs);
  timer.unref?.();
  let result: T | undefined;
  let workError: unknown;
  let didThrow = false;
  try {
    result = await work();
  } catch (error) {
    didThrow = true;
    workError = error;
  } finally {
    clearInterval(timer);
    await pendingRenewal;
  }
  if (didThrow) throw workError;
  if (ownershipLost) {
    recordOperationalEvent("telegram_callback_lease_ownership_lost");
    throw new DurableTelegramCallbackClaimConflictError();
  }
  return result as T;
}

export async function claimDurableTelegramProviderReady({
  authState,
  proof,
  codeHash,
  now = new Date(),
}: {
  authState: {
    id: string;
    userId: string | null;
    redirectTo: string | null;
    expiresAt: Date;
  };
  proof: TelegramCallbackCookieProof;
  codeHash: string;
  now?: Date;
}) {
  const claimToken = randomToken(32);
  const claimed = await prisma.telegramAuthState.updateMany({
    where: {
      id: authState.id,
      stateHash: proof.stateHash,
      nonceHash: proof.nonceHash,
      codeVerifierHash: proof.codeVerifierHash,
      callbackStatus: TelegramCallbackStatus.READY,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      consumedAt: now,
      callbackStatus: TelegramCallbackStatus.PROVIDER_READY,
      callbackCodeHash: codeHash,
      callbackClaimTokenHash: sha256(claimToken),
      callbackLeaseExpiresAt: new Date(now.getTime() + CALLBACK_LEASE_MS),
      callbackAttemptCount: { increment: 1 },
      callbackResultEncrypted: protectCheckpoint("PROVIDER_READY", {
        authState: {
          id: authState.id,
          targetUserId: authState.userId,
          redirectTo: authState.redirectTo,
        },
      }),
      callbackResultExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
      ),
      callbackFailureCode: null,
    },
  });
  if (claimed.count !== 1) {
    throw new DurableTelegramCallbackClaimConflictError();
  }
  return {
    authStateId: authState.id,
    stateHash: proof.stateHash,
    codeHash,
    claimToken,
  } satisfies DurableTelegramCallbackOwnership;
}

export function markDurableTelegramProviderDispatching(
  ownership: DurableTelegramCallbackOwnership,
  authState: {
    id: string;
    targetUserId: string | null;
    redirectTo: string | null;
  },
  now = new Date(),
) {
  return transitionCheckpoint(
    ownership,
    TelegramCallbackStatus.PROVIDER_READY,
    "PROVIDER_DISPATCHING",
    { authState },
    now,
  );
}

export function checkpointDurableTelegramIdentity(
  ownership: DurableTelegramCallbackOwnership,
  verified: VerifiedTelegramCallback,
  now = new Date(),
) {
  return transitionCheckpoint(
    ownership,
    TelegramCallbackStatus.PROVIDER_DISPATCHING,
    "IDENTITY_VERIFIED",
    verified,
    now,
  );
}

async function transitionCheckpoint(
  ownership: DurableTelegramCallbackOwnership,
  from: TelegramCallbackStatus,
  to:
    | DurableTelegramCallbackCheckpoint["phase"]
    | "PROVIDER_DISPATCHING"
    | "REMNASHOP_DISPATCHING"
    | "RECOVERY_DISPATCHING",
  value: unknown,
  now = new Date(),
) {
  const transitioned = await prisma.telegramAuthState.updateMany({
    where: ownershipWhere(ownership, from, now),
    data: {
      callbackStatus: to,
      callbackLeaseExpiresAt: new Date(now.getTime() + CALLBACK_LEASE_MS),
      callbackResultEncrypted: protectCheckpoint(to, value),
      callbackResultExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
      ),
    },
  });
  if (transitioned.count !== 1) {
    throw new Error(`Telegram callback ${from} to ${to} ownership changed`);
  }
}

export function checkpointDurableTelegramProvider(
  ownership: DurableTelegramCallbackOwnership,
  verified: VerifiedTelegramCallback,
  now = new Date(),
) {
  return transitionCheckpoint(
    ownership,
    TelegramCallbackStatus.REMNASHOP_DISPATCHING,
    "PROVIDER_AUTHENTICATED",
    verified,
    now,
  );
}

export function markDurableTelegramRemnashopDispatching(
  ownership: DurableTelegramCallbackOwnership,
  verified: VerifiedTelegramCallback,
  now = new Date(),
) {
  return transitionCheckpoint(
    ownership,
    TelegramCallbackStatus.IDENTITY_VERIFIED,
    "REMNASHOP_DISPATCHING",
    verified,
    now,
  );
}

export function checkpointDurableTelegramIdentityResolved(
  ownership: DurableTelegramCallbackOwnership,
  consumed: ConsumedTelegramCallback,
  now = new Date(),
) {
  return transitionCheckpoint(
    ownership,
    TelegramCallbackStatus.PROVIDER_AUTHENTICATED,
    "IDENTITY_RESOLVED",
    consumed,
    now,
  );
}

export function checkpointDurableTelegramOutcome(
  ownership: DurableTelegramCallbackOwnership,
  outcome: TelegramCallbackOutcome,
  now = new Date(),
) {
  return transitionCheckpoint(
    ownership,
    TelegramCallbackStatus.IDENTITY_RESOLVED,
    "OUTCOME_READY",
    outcome,
    now,
  );
}

export function markDurableTelegramRecoveryDispatching(
  ownership: DurableTelegramCallbackOwnership,
  replay: DurableTelegramCallbackReplay,
  now = new Date(),
) {
  if (!replay.session) {
    throw new Error("Durable Telegram recovery dispatch has no exact session");
  }
  return transitionCheckpoint(
    ownership,
    TelegramCallbackStatus.SESSION_CREATED,
    "RECOVERY_DISPATCHING",
    replay,
    now,
  );
}

export function checkpointDurableTelegramRecoveryCommitted(
  ownership: DurableTelegramCallbackOwnership,
  replay: DurableTelegramCallbackReplay,
  now = new Date(),
) {
  if (!replay.session) {
    throw new Error("Durable Telegram recovery commit has no exact session");
  }
  const committedReplay: DurableTelegramCallbackReplay = {
    ...replay,
    session: {
      ...replay.session,
      requiresTelegramRecovery: false,
    },
  };
  return transitionCheckpoint(
    ownership,
    TelegramCallbackStatus.RECOVERY_DISPATCHING,
    "SESSION_CREATED",
    committedReplay,
    now,
  ).then(() => committedReplay);
}

export async function createDurableTelegramCallbackSession(
  ownership: DurableTelegramCallbackOwnership,
  outcome: TelegramCallbackOutcome,
  now = new Date(),
) {
  if (!outcome.session || outcome.mergeConfirmation) {
    throw new Error("Durable Telegram session phase requires a session outcome");
  }
  const sessionOutcome = outcome.session;
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id" FROM "TelegramAuthState"
        WHERE "id" = ${ownership.authStateId}
          AND "stateHash" = ${ownership.stateHash}
          AND "callbackCodeHash" = ${ownership.codeHash}
          AND "expiresAt" > ${new Date(
            now.getTime() - DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS,
          )}
        FOR UPDATE
      `,
    );
    if (locked.length !== 1) {
      throw new Error("Telegram callback state disappeared before session commit");
    }
    const credentials = await createDurableCallbackWebSession(
      tx,
      sessionOutcome.userId,
      {
        ...(sessionOutcome.remnashopSession
          ? { remnashopSession: sessionOutcome.remnashopSession }
          : {}),
        now,
      },
    );
    const replay = replayFromOutcome(
      outcome,
      credentials.session.id,
      credentials.refreshToken,
    );
    const transitioned = await tx.telegramAuthState.updateMany({
      where: ownershipWhere(
        ownership,
        TelegramCallbackStatus.OUTCOME_READY,
        now,
      ),
      data: {
        callbackStatus: TelegramCallbackStatus.SESSION_CREATED,
        callbackLeaseExpiresAt: new Date(now.getTime() + CALLBACK_LEASE_MS),
        callbackResultEncrypted: protectCheckpoint("SESSION_CREATED", replay),
        callbackResultExpiresAt: new Date(
          now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
        ),
        callbackWebSessionId: credentials.session.id,
      },
    });
    if (transitioned.count !== 1) {
      throw new Error("Telegram callback session commit ownership changed");
    }
    // The bearer is retained only inside the encrypted checkpoint. Returning
    // the pre-recovery session snapshot would make it too easy for a caller to
    // sign an initial response with stale identity claims.
    return { replay };
  }, { maxWait: 5_000, timeout: 15_000 });
}

export async function completeDurableTelegramSession(
  ownership: DurableTelegramCallbackOwnership,
  replay: DurableTelegramCallbackReplay,
  now = new Date(),
) {
  if (!replay.session) {
    throw new Error("Durable Telegram session completion has no session");
  }
  const replaySession = replay.session;
  await prisma.$transaction(async (tx) => {
    const completed = await tx.telegramAuthState.updateMany({
      where: ownershipWhere(
        ownership,
        TelegramCallbackStatus.SESSION_CREATED,
        now,
      ),
      data: {
        callbackStatus: TelegramCallbackStatus.COMPLETED,
        callbackClaimTokenHash: null,
        callbackLeaseExpiresAt: null,
        callbackResultEncrypted: protectStored({
          version: 2,
          phase: TelegramCallbackStatus.COMPLETED,
          value: replay,
        }),
        callbackResultExpiresAt: new Date(
          now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
        ),
        callbackCompletedAt: now,
        callbackWebSessionId: null,
      },
    });
    if (completed.count !== 1) {
      throw new Error("Telegram callback session completion ownership changed");
    }
    const sessionRenewed = await tx.webSession.updateMany({
      where: {
        id: replaySession.webSessionId,
        userId: replaySession.userId,
        refreshTokenHash: sha256(replaySession.bootstrapRefreshToken),
        revokedAt: null,
        refreshExpiresAt: { gt: now },
      },
      data: {
        accessTokenExpiresAt: new Date(
          now.getTime() + securityPolicy.accessSessionTtlMinutes * 60_000,
        ),
      },
    });
    if (sessionRenewed.count !== 1) {
      throw new Error("Telegram callback exact session is not replayable");
    }
  }, { maxWait: 5_000, timeout: 15_000 });
}

export async function completeDurableTelegramMerge(
  ownership: DurableTelegramCallbackOwnership,
  outcome: TelegramCallbackOutcome,
  now = new Date(),
) {
  if (!outcome.mergeConfirmation || outcome.session) {
    throw new Error("Durable Telegram merge completion has no merge outcome");
  }
  const mergeConfirmation = outcome.mergeConfirmation;
  const replay = replayFromOutcome(outcome);
  await prisma.$transaction(async (tx) => {
    const confirmationExtended = await tx.accountMergeConfirmation.updateMany({
      where: {
        userId: outcome.audit.userId,
        tokenHash: sha256(mergeConfirmation.token),
        status: {
          in: [
            AccountMergeConfirmationStatus.PENDING,
            AccountMergeConfirmationStatus.PROCESSING,
          ],
        },
      },
      data: {
        expiresAt: new Date(
          now.getTime()
            + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS
            + telegramAccountMergeCookieMaxAgeSeconds * 1_000,
        ),
      },
    });
    if (confirmationExtended.count !== 1) {
      throw new Error("Telegram callback merge confirmation is not replayable");
    }
    const completed = await tx.telegramAuthState.updateMany({
      where: ownershipWhere(
        ownership,
        TelegramCallbackStatus.OUTCOME_READY,
        now,
      ),
      data: {
        callbackStatus: TelegramCallbackStatus.COMPLETED,
        callbackClaimTokenHash: null,
        callbackLeaseExpiresAt: null,
        callbackResultEncrypted: protectStored({
          version: 2,
          phase: TelegramCallbackStatus.COMPLETED,
          value: replay,
        }),
        callbackResultExpiresAt: new Date(
          now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
        ),
        callbackCompletedAt: now,
        callbackWebSessionId: null,
      },
    });
    if (completed.count !== 1) {
      throw new Error("Telegram callback merge completion ownership changed");
    }
  }, { maxWait: 5_000, timeout: 15_000 });
  return replay;
}

export async function releaseDurableTelegramCallback(
  ownership: DurableTelegramCallbackOwnership,
  status:
    | DurableTelegramCallbackCheckpoint["phase"]
    | "RECOVERY_DISPATCHING",
  now = new Date(),
) {
  await prisma.telegramAuthState.updateMany({
    where: ownershipWhere(ownership, status),
    data: { callbackClaimTokenHash: null, callbackLeaseExpiresAt: now },
  });
}

export async function failDurableTelegramCallback(
  ownership: DurableTelegramCallbackOwnership,
  status:
    | DurableTelegramCallbackCheckpoint["phase"]
    | "PROVIDER_DISPATCHING"
    | "REMNASHOP_DISPATCHING"
    | "RECOVERY_DISPATCHING",
  failureCode: string,
  redirectTo: string,
  replay?: DurableTelegramCallbackReplay,
  now = new Date(),
) {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; expiresAt: Date }>>(
      Prisma.sql`
        SELECT "id", "expiresAt" FROM "TelegramAuthState"
        WHERE "id" = ${ownership.authStateId}
          AND "stateHash" = ${ownership.stateHash}
          AND "callbackCodeHash" = ${ownership.codeHash}
        FOR UPDATE
      `,
    );
    if (locked.length !== 1) {
      throw new Error("Telegram callback state disappeared before failure commit");
    }
    const resultExpiresAt = callbackResultExpiry(locked[0]!.expiresAt, now);
    if (replay?.session) {
      await tx.webSession.updateMany({
        where: {
          id: replay.session.webSessionId,
          userId: replay.session.userId,
          revokedAt: null,
        },
        data: revokedWebSessionData(now),
      });
    }
    const failed = await tx.telegramAuthState.updateMany({
      where: ownershipWhere(ownership, status),
      data: {
        callbackStatus: TelegramCallbackStatus.FAILED,
        callbackClaimTokenHash: null,
        callbackLeaseExpiresAt: null,
        callbackResultEncrypted: resultExpiresAt > now
          ? protectStored({
              version: 2,
              phase: TelegramCallbackStatus.FAILED,
              value: { redirectTo },
            })
          : null,
        callbackResultExpiresAt: resultExpiresAt,
        callbackCompletedAt: now,
        callbackFailureCode: failureCode.slice(0, 128),
        callbackWebSessionId: null,
      },
    });
    if (failed.count !== 1) {
      throw new Error("Telegram callback failure ownership changed");
    }
  });
}

function callbackWorkDeadline(authStateExpiresAt: Date) {
  return new Date(
    authStateExpiresAt.getTime()
      + DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS,
  );
}

function callbackReplayDeadline(authStateExpiresAt: Date) {
  return new Date(
    callbackWorkDeadline(authStateExpiresAt).getTime()
      + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
  );
}

function callbackResultExpiry(authStateExpiresAt: Date, now: Date) {
  const relativeExpiry = new Date(
    now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
  );
  const absoluteExpiry = callbackReplayDeadline(authStateExpiresAt);
  return relativeExpiry < absoluteExpiry ? relativeExpiry : absoluteExpiry;
}

type LoadedCallbackRecord = {
  id: string;
  callbackStatus: TelegramCallbackStatus;
  callbackLeaseExpiresAt: Date | null;
  callbackResultEncrypted: string;
  callbackWebSessionId: string | null;
  expiresAt: Date;
};

async function terminalizeLoadedCallback(
  record: LoadedCallbackRecord,
  failureCode: string,
  now: Date,
  requireExpiredWorkWindow = false,
) {
  const redirectTo = "/login?auth=telegram_recovery_required";
  const resultExpiresAt = callbackResultExpiry(record.expiresAt, now);
  const failed = await prisma.$transaction(async (tx) => {
    const changed = await tx.telegramAuthState.updateMany({
      where: {
        id: record.id,
        callbackStatus: record.callbackStatus,
        callbackLeaseExpiresAt: record.callbackLeaseExpiresAt,
        callbackResultEncrypted: record.callbackResultEncrypted,
        callbackWebSessionId: record.callbackWebSessionId,
        ...(requireExpiredWorkWindow
          ? {
              expiresAt: {
                lte: new Date(
                  now.getTime()
                    - DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS,
                ),
              },
            }
          : {}),
      },
      data: {
        callbackStatus: TelegramCallbackStatus.FAILED,
        callbackClaimTokenHash: null,
        callbackLeaseExpiresAt: null,
        callbackResultEncrypted: resultExpiresAt > now
          ? protectStored({
              version: 2,
              phase: TelegramCallbackStatus.FAILED,
              value: { redirectTo },
            })
          : null,
        callbackResultExpiresAt: resultExpiresAt,
        callbackCompletedAt: now,
        callbackFailureCode: failureCode,
        callbackWebSessionId: null,
      },
    });
    if (changed.count === 1 && record.callbackWebSessionId) {
      await tx.webSession.updateMany({
        where: { id: record.callbackWebSessionId, revokedAt: null },
        data: revokedWebSessionData(now),
      });
    }
    return changed.count === 1;
  });
  return { failed, redirectTo };
}

function proofMatches(
  record: {
    stateHash: string;
    nonceHash: string;
    codeVerifierHash: string;
  },
  proof: TelegramCallbackCookieProof,
) {
  return safeEqual(record.stateHash, proof.stateHash)
    && safeEqual(record.nonceHash, proof.nonceHash)
    && safeEqual(record.codeVerifierHash, proof.codeVerifierHash);
}

async function scrubExpiredCallbackResult(
  record: {
    id: string;
    callbackResultEncrypted: string | null;
    callbackResultExpiresAt: Date | null;
    callbackWebSessionId: string | null;
  },
  now: Date,
) {
  if (
    !record.callbackResultEncrypted
    || (record.callbackResultExpiresAt && record.callbackResultExpiresAt > now)
  ) {
    return;
  }
  const scrubbed = await prisma.$transaction(async (tx) => {
    const changed = await tx.telegramAuthState.updateMany({
      where: {
        id: record.id,
        callbackResultEncrypted: record.callbackResultEncrypted,
        callbackWebSessionId: record.callbackWebSessionId,
        OR: [
          { callbackResultExpiresAt: null },
          { callbackResultExpiresAt: { lte: now } },
        ],
      },
      data: {
        callbackResultEncrypted: null,
        callbackClaimTokenHash: null,
        callbackLeaseExpiresAt: null,
        callbackFailureCode: null,
        callbackWebSessionId: null,
      },
    });
    if (changed.count === 1 && record.callbackWebSessionId) {
      await tx.webSession.updateMany({
        where: { id: record.callbackWebSessionId, revokedAt: null },
        data: revokedWebSessionData(now),
      });
    }
    return changed.count;
  });
  if (scrubbed === 1) {
    recordOperationalEvent("telegram_callback_expired_result_scrubbed");
  }
}

export async function loadDurableTelegramCallback(
  state: string,
  code: string,
  proof: TelegramCallbackCookieProof,
  now = new Date(),
): Promise<
  | { status: "none" }
  | { status: "processing" }
  | {
      status: "resume";
      ownership: DurableTelegramCallbackOwnership;
      checkpoint: DurableTelegramCallbackCheckpoint;
    }
  | { status: "completed"; outcome: DurableTelegramCallbackReplay }
  | { status: "failed"; redirectTo: string }
> {
  const stateHash = sha256(state);
  if (!safeEqual(stateHash, proof.stateHash)) return { status: "none" };
  const record = await prisma.telegramAuthState.findUnique({
    where: { stateHash },
    select: {
      id: true,
      stateHash: true,
      nonceHash: true,
      codeVerifierHash: true,
      callbackStatus: true,
      callbackCodeHash: true,
      callbackLeaseExpiresAt: true,
      callbackResultEncrypted: true,
      callbackResultExpiresAt: true,
      callbackWebSessionId: true,
      expiresAt: true,
    },
  });
  const codeHash = sha256(code);
  if (
    !record
    || !proofMatches(record, proof)
    || !record.callbackCodeHash
    || !safeEqual(record.callbackCodeHash, codeHash)
  ) {
    return { status: "none" };
  }
  if (
    !record.callbackResultEncrypted
    || !record.callbackResultExpiresAt
    || record.callbackResultExpiresAt <= now
  ) {
    await scrubExpiredCallbackResult(record, now);
    return { status: "failed", redirectTo: "/login?auth=telegram_recovery_required" };
  }
  const loadedRecord: LoadedCallbackRecord = {
    id: record.id,
    callbackStatus: record.callbackStatus,
    callbackLeaseExpiresAt: record.callbackLeaseExpiresAt,
    callbackResultEncrypted: record.callbackResultEncrypted,
    callbackWebSessionId: record.callbackWebSessionId,
    expiresAt: record.expiresAt,
  };
  if (record.callbackStatus === TelegramCallbackStatus.COMPLETED) {
    const { stored, revealed } = revealStored(record.callbackResultEncrypted);
    if (stored.phase !== TelegramCallbackStatus.COMPLETED) {
      throw new Error("Durable Telegram completion phase mismatch");
    }
    if (revealed.needsRewrap) {
      await prisma.telegramAuthState.updateMany({
        where: {
          id: record.id,
          callbackStatus: TelegramCallbackStatus.COMPLETED,
          callbackResultEncrypted: record.callbackResultEncrypted,
        },
        data: {
          callbackResultEncrypted: encryptKeyringSecret(
            revealed.value,
            getEnv().webRefreshKeyring,
            CALLBACK_RESULT_PURPOSE,
          ),
        },
      });
      recordOperationalEvent("encrypted_telegram_callback_result_rewrapped");
    }
    return { status: "completed", outcome: parseReplay(stored.value) };
  }
  if (record.callbackStatus === TelegramCallbackStatus.FAILED) {
    const { stored } = revealStored(record.callbackResultEncrypted);
    if (
      stored.phase !== TelegramCallbackStatus.FAILED
      || !isRecord(stored.value)
      || !boundedString(stored.value.redirectTo, 512)
    ) {
      throw new Error("Invalid durable Telegram failure checkpoint");
    }
    return { status: "failed", redirectTo: stored.value.redirectTo };
  }
  if (callbackWorkDeadline(record.expiresAt) <= now) {
    const terminal = await terminalizeLoadedCallback(
      loadedRecord,
      "CALLBACK_DEADLINE_EXCEEDED",
      now,
      true,
    );
    if (!terminal.failed) return { status: "processing" };
    recordOperationalEvent("telegram_callback_work_deadline_exceeded");
    return { status: "failed", redirectTo: terminal.redirectTo };
  }
  if (record.callbackStatus === TelegramCallbackStatus.RECOVERY_DISPATCHING) {
    if (record.callbackLeaseExpiresAt && record.callbackLeaseExpiresAt > now) {
      return { status: "processing" };
    }
    const { stored } = revealStored(record.callbackResultEncrypted);
    const replay = stored.phase === TelegramCallbackStatus.RECOVERY_DISPATCHING
      ? parseReplay(stored.value)
      : null;
    const replaySession = replay?.session;
    const recoveryCommitted = replaySession
      && record.callbackWebSessionId === replaySession.webSessionId
      ? await prisma.webSession.findFirst({
          where: {
            id: replaySession.webSessionId,
            userId: replaySession.userId,
            revokedAt: null,
            remnashopAccessTokenEncrypted: { not: null },
            remnashopRefreshTokenEncrypted: { not: null },
            remnashopRefreshExpiresAt: { gt: now },
          },
          select: { id: true },
        })
      : null;
    if (replay && replaySession && recoveryCommitted) {
      const committedReplay: DurableTelegramCallbackReplay = {
        ...replay,
        session: {
          ...replaySession,
          requiresTelegramRecovery: false,
        },
      };
      const claimToken = randomToken(32);
      const resumed = await prisma.telegramAuthState.updateMany({
        where: {
          id: record.id,
          callbackStatus: TelegramCallbackStatus.RECOVERY_DISPATCHING,
          callbackLeaseExpiresAt: record.callbackLeaseExpiresAt,
          callbackResultEncrypted: record.callbackResultEncrypted,
          callbackWebSessionId: replaySession.webSessionId,
          ...callbackWorkWindowWhere(now),
        },
        data: {
          callbackStatus: TelegramCallbackStatus.SESSION_CREATED,
          callbackClaimTokenHash: sha256(claimToken),
          callbackLeaseExpiresAt: new Date(now.getTime() + CALLBACK_LEASE_MS),
          callbackAttemptCount: { increment: 1 },
          callbackResultEncrypted: protectCheckpoint(
            "SESSION_CREATED",
            committedReplay,
          ),
          callbackResultExpiresAt: new Date(
            now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
          ),
        },
      });
      if (resumed.count !== 1) return { status: "processing" };
      recordOperationalEvent("telegram_callback_recovery_commit_resumed");
      return {
        status: "resume",
        ownership: {
          authStateId: record.id,
          stateHash,
          codeHash,
          claimToken,
        },
        checkpoint: { phase: "SESSION_CREATED", replay: committedReplay },
      };
    }
    const terminal = await terminalizeLoadedCallback(
      loadedRecord,
      replay ? "REMNASHOP_RECOVERY_AMBIGUOUS" : "RECOVERY_CHECKPOINT_INVALID",
      now,
    );
    if (!terminal.failed) return { status: "processing" };
    recordOperationalEvent("telegram_callback_recovery_dispatch_ambiguous");
    return { status: "failed", redirectTo: terminal.redirectTo };
  }
  if (
    record.callbackStatus === TelegramCallbackStatus.PROVIDER_DISPATCHING
    || record.callbackStatus === TelegramCallbackStatus.REMNASHOP_DISPATCHING
  ) {
    if (record.callbackLeaseExpiresAt && record.callbackLeaseExpiresAt > now) {
      return { status: "processing" };
    }
    const terminal = await terminalizeLoadedCallback(
      loadedRecord,
      record.callbackStatus === TelegramCallbackStatus.PROVIDER_DISPATCHING
        ? "OIDC_CODE_EXCHANGE_AMBIGUOUS"
        : "REMNASHOP_AUTH_AMBIGUOUS",
      now,
    );
    if (!terminal.failed) return { status: "processing" };
    recordOperationalEvent(
      record.callbackStatus === TelegramCallbackStatus.PROVIDER_DISPATCHING
        ? "telegram_callback_oidc_dispatch_ambiguous"
        : "telegram_callback_remnashop_dispatch_ambiguous",
    );
    return { status: "failed", redirectTo: terminal.redirectTo };
  }
  if (!resumableStatuses.has(record.callbackStatus)) {
    return { status: "none" };
  }
  if (record.callbackLeaseExpiresAt && record.callbackLeaseExpiresAt > now) {
    return { status: "processing" };
  }
  const parsed = parseCheckpoint(record.callbackStatus, record.callbackResultEncrypted);
  const claimToken = randomToken(32);
  const claimed = await prisma.telegramAuthState.updateMany({
    where: {
      id: record.id,
      stateHash,
      nonceHash: proof.nonceHash,
      codeVerifierHash: proof.codeVerifierHash,
      callbackCodeHash: codeHash,
      callbackStatus: record.callbackStatus,
      callbackResultEncrypted: record.callbackResultEncrypted,
      ...callbackWorkWindowWhere(now),
      OR: [
        { callbackLeaseExpiresAt: null },
        { callbackLeaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      callbackClaimTokenHash: sha256(claimToken),
      callbackLeaseExpiresAt: new Date(now.getTime() + CALLBACK_LEASE_MS),
      callbackAttemptCount: { increment: 1 },
      callbackResultExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
      ),
      ...(parsed.needsRewrap
        ? {
            callbackResultEncrypted: encryptKeyringSecret(
              parsed.plaintext,
              getEnv().webRefreshKeyring,
              CALLBACK_RESULT_PURPOSE,
            ),
          }
        : {}),
    },
  });
  if (claimed.count !== 1) return { status: "processing" };
  if (parsed.needsRewrap) {
    recordOperationalEvent("encrypted_telegram_callback_result_rewrapped");
  }
  return {
    status: "resume",
    ownership: {
      authStateId: record.id,
      stateHash,
      codeHash,
      claimToken,
    },
    checkpoint: parsed.checkpoint,
  };
}
