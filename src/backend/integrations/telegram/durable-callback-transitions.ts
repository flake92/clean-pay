import type { TelegramCallbackOutcome } from "@/application/auth/ports/telegram-callback";
import {
  type DurableTelegramCallbackStatus,
  type DurableTelegramCallbackOwnership,
  type DurableTelegramCallbackReplay,
  DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS,
  DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
  durableTelegramCallbackStatus,
  type TelegramCallbackCookieProof,
} from "@/backend/integrations/telegram/durable-callback-contract";
import { safeEqual, sha256 } from "@/backend/security/crypto";

export const durableTelegramCallbackTransitions = Object.freeze({
  providerDispatching: Object.freeze({
    from: durableTelegramCallbackStatus.PROVIDER_READY,
    to: durableTelegramCallbackStatus.PROVIDER_DISPATCHING,
  }),
  identityVerified: Object.freeze({
    from: durableTelegramCallbackStatus.PROVIDER_DISPATCHING,
    to: durableTelegramCallbackStatus.IDENTITY_VERIFIED,
  }),
  remnashopDispatching: Object.freeze({
    from: durableTelegramCallbackStatus.IDENTITY_VERIFIED,
    to: durableTelegramCallbackStatus.REMNASHOP_DISPATCHING,
  }),
  providerAuthenticated: Object.freeze({
    from: durableTelegramCallbackStatus.REMNASHOP_DISPATCHING,
    to: durableTelegramCallbackStatus.PROVIDER_AUTHENTICATED,
  }),
  identityResolved: Object.freeze({
    from: durableTelegramCallbackStatus.PROVIDER_AUTHENTICATED,
    to: durableTelegramCallbackStatus.IDENTITY_RESOLVED,
  }),
  outcomeReady: Object.freeze({
    from: durableTelegramCallbackStatus.IDENTITY_RESOLVED,
    to: durableTelegramCallbackStatus.OUTCOME_READY,
  }),
  recoveryDispatching: Object.freeze({
    from: durableTelegramCallbackStatus.SESSION_CREATED,
    to: durableTelegramCallbackStatus.RECOVERY_DISPATCHING,
  }),
  recoveryCommitted: Object.freeze({
    from: durableTelegramCallbackStatus.RECOVERY_DISPATCHING,
    to: durableTelegramCallbackStatus.SESSION_CREATED,
  }),
});

const resumableStatuses = new Set<DurableTelegramCallbackStatus>([
  durableTelegramCallbackStatus.PROVIDER_READY,
  durableTelegramCallbackStatus.IDENTITY_VERIFIED,
  durableTelegramCallbackStatus.PROVIDER_AUTHENTICATED,
  durableTelegramCallbackStatus.IDENTITY_RESOLVED,
  durableTelegramCallbackStatus.OUTCOME_READY,
  durableTelegramCallbackStatus.SESSION_CREATED,
]);

export function isDurableTelegramCallbackResumable(
  status: DurableTelegramCallbackStatus,
) {
  return resumableStatuses.has(status);
}

export function replayFromDurableTelegramOutcome(
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

export function committedDurableTelegramRecoveryReplay(
  replay: DurableTelegramCallbackReplay,
) {
  if (!replay.session) {
    throw new Error("Durable Telegram recovery commit has no exact session");
  }
  return {
    ...replay,
    session: {
      ...replay.session,
      requiresTelegramRecovery: false,
    },
  } satisfies DurableTelegramCallbackReplay;
}

export function durableTelegramCallbackWorkWindowWhere(now: Date) {
  return {
    expiresAt: {
      gt: new Date(now.getTime() - DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS),
    },
  };
}

export function durableTelegramCallbackOwnershipWhere(
  ownership: DurableTelegramCallbackOwnership,
  status: DurableTelegramCallbackStatus,
  now?: Date,
) {
  return {
    id: ownership.authStateId,
    stateHash: ownership.stateHash,
    callbackCodeHash: ownership.codeHash,
    callbackClaimTokenHash: sha256(ownership.claimToken),
    callbackStatus: status,
    ...(now ? durableTelegramCallbackWorkWindowWhere(now) : {}),
  };
}

export function durableTelegramCallbackWorkDeadline(authStateExpiresAt: Date) {
  return new Date(
    authStateExpiresAt.getTime() + DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS,
  );
}

export function durableTelegramCallbackReplayDeadline(authStateExpiresAt: Date) {
  return new Date(
    durableTelegramCallbackWorkDeadline(authStateExpiresAt).getTime()
      + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
  );
}

export function durableTelegramCallbackResultExpiry(
  authStateExpiresAt: Date,
  now: Date,
) {
  const relativeExpiry = new Date(
    now.getTime() + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
  );
  const absoluteExpiry = durableTelegramCallbackReplayDeadline(authStateExpiresAt);
  return relativeExpiry < absoluteExpiry ? relativeExpiry : absoluteExpiry;
}

export function durableTelegramCallbackProofMatches(
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
