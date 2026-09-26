import type {
  ConsumedTelegramCallback,
  TelegramCallbackOutcome,
  VerifiedTelegramCallback,
} from "@/application/auth/ports/telegram-callback";

export const DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS = 10 * 60 * 1000;

// A claimed callback may keep a resumable lease for at most this long after
// the original READY state expires. This absolute deadline makes the browser
// proof lifetime finite while still leaving a full lost-response replay
// window after the latest possible successful commit.
export const DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS = 10 * 60 * 1000;

export const DURABLE_TELEGRAM_CALLBACK_LEASE_MS = 2 * 60 * 1000;
export const DURABLE_TELEGRAM_CALLBACK_RESULT_MAX_BYTES = 256 * 1024;
export const DURABLE_TELEGRAM_CALLBACK_RESULT_PURPOSE =
  "telegram-oidc-callback-result";

export const durableTelegramCallbackStatus = Object.freeze({
  READY: "READY",
  PROVIDER_READY: "PROVIDER_READY",
  PROVIDER_DISPATCHING: "PROVIDER_DISPATCHING",
  IDENTITY_VERIFIED: "IDENTITY_VERIFIED",
  REMNASHOP_DISPATCHING: "REMNASHOP_DISPATCHING",
  PROVIDER_AUTHENTICATED: "PROVIDER_AUTHENTICATED",
  IDENTITY_RESOLVED: "IDENTITY_RESOLVED",
  OUTCOME_READY: "OUTCOME_READY",
  SESSION_CREATED: "SESSION_CREATED",
  RECOVERY_DISPATCHING: "RECOVERY_DISPATCHING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const);

export type DurableTelegramCallbackStatus =
  (typeof durableTelegramCallbackStatus)[keyof typeof durableTelegramCallbackStatus];

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

export type StoredDurableTelegramCallbackCheckpoint = {
  version: 2;
  phase: DurableTelegramCallbackStatus;
  value: unknown;
};

export type LoadedDurableTelegramCallbackRecord = {
  id: string;
  callbackStatus: DurableTelegramCallbackStatus;
  callbackLeaseExpiresAt: Date | null;
  callbackResultEncrypted: string;
  callbackWebSessionId: string | null;
  expiresAt: Date;
};
