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
import { prisma } from "@/backend/database/prisma";
import { telegramAccountMergeCookieMaxAgeSeconds } from "@/backend/integrations/auth/telegram-account-merge-store";
import {
  type DurableTelegramCallbackCheckpoint,
  DurableTelegramCallbackClaimConflictError,
  DURABLE_TELEGRAM_CALLBACK_LEASE_MS,
  DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS,
  type DurableTelegramCallbackOwnership,
  type DurableTelegramCallbackReplay,
  DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
  type LoadedDurableTelegramCallbackRecord,
  type TelegramCallbackCookieProof,
} from "@/backend/integrations/telegram/durable-callback-contract";
import {
  protectDurableTelegramCheckpoint,
  protectDurableTelegramStored,
  rewrapDurableTelegramStored,
} from "@/backend/integrations/telegram/durable-callback-transport";
import {
  committedDurableTelegramRecoveryReplay,
  durableTelegramCallbackOwnershipWhere,
  durableTelegramCallbackResultExpiry,
  durableTelegramCallbackTransitions,
  durableTelegramCallbackWorkWindowWhere,
  replayFromDurableTelegramOutcome,
} from "@/backend/integrations/telegram/durable-callback-transitions";
import { createDurableCallbackWebSession } from "@/backend/integrations/sessions/web-session-service";
import { revokedWebSessionData } from "@/backend/integrations/sessions/web-session-revocation";
import { securityPolicy } from "@/backend/security/policy";
import { randomToken, sha256 } from "@/backend/security/crypto";

export type DurableTelegramCallbackDatabaseRecord = {
  id: string;
  stateHash: string;
  nonceHash: string;
  codeVerifierHash: string;
  callbackStatus: TelegramCallbackStatus;
  callbackCodeHash: string | null;
  callbackLeaseExpiresAt: Date | null;
  callbackResultEncrypted: string | null;
  callbackResultExpiresAt: Date | null;
  callbackWebSessionId: string | null;
  expiresAt: Date;
};

export async function renewDurableTelegramCallbackLease(
  ownership: DurableTelegramCallbackOwnership,
  status:
    | DurableTelegramCallbackCheckpoint["phase"]
    | "RECOVERY_DISPATCHING",
  now: Date,
) {
  const renewed = await prisma.telegramAuthState.updateMany({
    where: durableTelegramCallbackOwnershipWhere(ownership, status, now),
    data: {
      callbackLeaseExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_LEASE_MS,
      ),
      callbackResultExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
      ),
    },
  });
  return renewed.count;
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
      callbackLeaseExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_LEASE_MS,
      ),
      callbackAttemptCount: { increment: 1 },
      callbackResultEncrypted: protectDurableTelegramCheckpoint(
        TelegramCallbackStatus.PROVIDER_READY,
        {
          authState: {
            id: authState.id,
            targetUserId: authState.userId,
            redirectTo: authState.redirectTo,
          },
        },
      ),
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
    where: durableTelegramCallbackOwnershipWhere(ownership, from, now),
    data: {
      callbackStatus: to,
      callbackLeaseExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_LEASE_MS,
      ),
      callbackResultEncrypted: protectDurableTelegramCheckpoint(to, value),
      callbackResultExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
      ),
    },
  });
  if (transitioned.count !== 1) {
    throw new Error(`Telegram callback ${from} to ${to} ownership changed`);
  }
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
  const transition = durableTelegramCallbackTransitions.providerDispatching;
  return transitionCheckpoint(
    ownership,
    transition.from,
    transition.to,
    { authState },
    now,
  );
}

export function checkpointDurableTelegramIdentity(
  ownership: DurableTelegramCallbackOwnership,
  verified: VerifiedTelegramCallback,
  now = new Date(),
) {
  const transition = durableTelegramCallbackTransitions.identityVerified;
  return transitionCheckpoint(
    ownership,
    transition.from,
    transition.to,
    verified,
    now,
  );
}

export function checkpointDurableTelegramProvider(
  ownership: DurableTelegramCallbackOwnership,
  verified: VerifiedTelegramCallback,
  now = new Date(),
) {
  const transition = durableTelegramCallbackTransitions.providerAuthenticated;
  return transitionCheckpoint(
    ownership,
    transition.from,
    transition.to,
    verified,
    now,
  );
}

export function markDurableTelegramRemnashopDispatching(
  ownership: DurableTelegramCallbackOwnership,
  verified: VerifiedTelegramCallback,
  now = new Date(),
) {
  const transition = durableTelegramCallbackTransitions.remnashopDispatching;
  return transitionCheckpoint(
    ownership,
    transition.from,
    transition.to,
    verified,
    now,
  );
}

export function checkpointDurableTelegramIdentityResolved(
  ownership: DurableTelegramCallbackOwnership,
  consumed: ConsumedTelegramCallback,
  now = new Date(),
) {
  const transition = durableTelegramCallbackTransitions.identityResolved;
  return transitionCheckpoint(
    ownership,
    transition.from,
    transition.to,
    consumed,
    now,
  );
}

export function checkpointDurableTelegramOutcome(
  ownership: DurableTelegramCallbackOwnership,
  outcome: TelegramCallbackOutcome,
  now = new Date(),
) {
  const transition = durableTelegramCallbackTransitions.outcomeReady;
  return transitionCheckpoint(
    ownership,
    transition.from,
    transition.to,
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
  const transition = durableTelegramCallbackTransitions.recoveryDispatching;
  return transitionCheckpoint(
    ownership,
    transition.from,
    transition.to,
    replay,
    now,
  );
}

export function checkpointDurableTelegramRecoveryCommitted(
  ownership: DurableTelegramCallbackOwnership,
  replay: DurableTelegramCallbackReplay,
  now = new Date(),
) {
  const committedReplay = committedDurableTelegramRecoveryReplay(replay);
  const transition = durableTelegramCallbackTransitions.recoveryCommitted;
  return transitionCheckpoint(
    ownership,
    transition.from,
    transition.to,
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
    const replay = replayFromDurableTelegramOutcome(
      outcome,
      credentials.session.id,
      credentials.refreshToken,
    );
    const transitioned = await tx.telegramAuthState.updateMany({
      where: durableTelegramCallbackOwnershipWhere(
        ownership,
        TelegramCallbackStatus.OUTCOME_READY,
        now,
      ),
      data: {
        callbackStatus: TelegramCallbackStatus.SESSION_CREATED,
        callbackLeaseExpiresAt: new Date(
          now.getTime() + DURABLE_TELEGRAM_CALLBACK_LEASE_MS,
        ),
        callbackResultEncrypted: protectDurableTelegramCheckpoint(
          TelegramCallbackStatus.SESSION_CREATED,
          replay,
        ),
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
      where: durableTelegramCallbackOwnershipWhere(
        ownership,
        TelegramCallbackStatus.SESSION_CREATED,
        now,
      ),
      data: {
        callbackStatus: TelegramCallbackStatus.COMPLETED,
        callbackClaimTokenHash: null,
        callbackLeaseExpiresAt: null,
        callbackResultEncrypted: protectDurableTelegramStored({
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
  const replay = replayFromDurableTelegramOutcome(outcome);
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
      where: durableTelegramCallbackOwnershipWhere(
        ownership,
        TelegramCallbackStatus.OUTCOME_READY,
        now,
      ),
      data: {
        callbackStatus: TelegramCallbackStatus.COMPLETED,
        callbackClaimTokenHash: null,
        callbackLeaseExpiresAt: null,
        callbackResultEncrypted: protectDurableTelegramStored({
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
    where: durableTelegramCallbackOwnershipWhere(ownership, status),
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
    const resultExpiresAt = durableTelegramCallbackResultExpiry(
      locked[0]!.expiresAt,
      now,
    );
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
      where: durableTelegramCallbackOwnershipWhere(ownership, status),
      data: {
        callbackStatus: TelegramCallbackStatus.FAILED,
        callbackClaimTokenHash: null,
        callbackLeaseExpiresAt: null,
        callbackResultEncrypted: resultExpiresAt > now
          ? protectDurableTelegramStored({
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

export async function loadDurableTelegramCallbackRecord(stateHash: string) {
  return prisma.telegramAuthState.findUnique({
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
}

export async function terminalizeDurableTelegramCallback(
  record: LoadedDurableTelegramCallbackRecord,
  failureCode: string,
  now: Date,
  requireExpiredWorkWindow = false,
) {
  const redirectTo = "/login?auth=telegram_recovery_required";
  const resultExpiresAt = durableTelegramCallbackResultExpiry(record.expiresAt, now);
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
                  now.getTime() - DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS,
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
          ? protectDurableTelegramStored({
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

export async function scrubExpiredDurableTelegramCallbackResult(
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
    return 0;
  }
  return prisma.$transaction(async (tx) => {
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
}

export async function rewrapDurableTelegramCallbackResult(
  record: {
    id: string;
    callbackStatus: TelegramCallbackStatus;
    callbackResultEncrypted: string;
  },
  plaintext: string,
) {
  return prisma.telegramAuthState.updateMany({
    where: {
      id: record.id,
      callbackStatus: record.callbackStatus,
      callbackResultEncrypted: record.callbackResultEncrypted,
    },
    data: {
      callbackResultEncrypted: rewrapDurableTelegramStored(plaintext),
    },
  });
}

export async function findCommittedDurableTelegramRecoverySession(
  replaySession: NonNullable<DurableTelegramCallbackReplay["session"]>,
  now: Date,
) {
  return prisma.webSession.findFirst({
    where: {
      id: replaySession.webSessionId,
      userId: replaySession.userId,
      revokedAt: null,
      remnashopAccessTokenEncrypted: { not: null },
      remnashopRefreshTokenEncrypted: { not: null },
      remnashopRefreshExpiresAt: { gt: now },
    },
    select: { id: true },
  });
}

export async function resumeCommittedDurableTelegramRecovery({
  record,
  claimToken,
  replaySession,
  committedReplay,
  now,
}: {
  record: LoadedDurableTelegramCallbackRecord;
  claimToken: string;
  replaySession: NonNullable<DurableTelegramCallbackReplay["session"]>;
  committedReplay: DurableTelegramCallbackReplay;
  now: Date;
}) {
  const resumed = await prisma.telegramAuthState.updateMany({
    where: {
      id: record.id,
      callbackStatus: TelegramCallbackStatus.RECOVERY_DISPATCHING,
      callbackLeaseExpiresAt: record.callbackLeaseExpiresAt,
      callbackResultEncrypted: record.callbackResultEncrypted,
      callbackWebSessionId: replaySession.webSessionId,
      ...durableTelegramCallbackWorkWindowWhere(now),
    },
    data: {
      callbackStatus: TelegramCallbackStatus.SESSION_CREATED,
      callbackClaimTokenHash: sha256(claimToken),
      callbackLeaseExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_LEASE_MS,
      ),
      callbackAttemptCount: { increment: 1 },
      callbackResultEncrypted: protectDurableTelegramCheckpoint(
        TelegramCallbackStatus.SESSION_CREATED,
        committedReplay,
      ),
      callbackResultExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
      ),
    },
  });
  return resumed.count;
}

export async function claimResumableDurableTelegramCallback({
  record,
  stateHash,
  proof,
  codeHash,
  claimToken,
  now,
  rewrappedPlaintext,
}: {
  record: LoadedDurableTelegramCallbackRecord;
  stateHash: string;
  proof: TelegramCallbackCookieProof;
  codeHash: string;
  claimToken: string;
  now: Date;
  rewrappedPlaintext?: string;
}) {
  const claimed = await prisma.telegramAuthState.updateMany({
    where: {
      id: record.id,
      stateHash,
      nonceHash: proof.nonceHash,
      codeVerifierHash: proof.codeVerifierHash,
      callbackCodeHash: codeHash,
      callbackStatus: record.callbackStatus,
      callbackResultEncrypted: record.callbackResultEncrypted,
      ...durableTelegramCallbackWorkWindowWhere(now),
      OR: [
        { callbackLeaseExpiresAt: null },
        { callbackLeaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      callbackClaimTokenHash: sha256(claimToken),
      callbackLeaseExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_LEASE_MS,
      ),
      callbackAttemptCount: { increment: 1 },
      callbackResultExpiresAt: new Date(
        now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
      ),
      ...(rewrappedPlaintext !== undefined
        ? {
            callbackResultEncrypted: rewrapDurableTelegramStored(
              rewrappedPlaintext,
            ),
          }
        : {}),
    },
  });
  return claimed.count;
}
