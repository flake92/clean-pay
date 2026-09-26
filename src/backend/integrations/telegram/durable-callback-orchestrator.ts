import {
  type DurableTelegramCallbackCheckpoint,
  DurableTelegramCallbackClaimConflictError,
  type DurableTelegramCallbackOwnership,
  type DurableTelegramCallbackReplay,
  type LoadedDurableTelegramCallbackRecord,
  type TelegramCallbackCookieProof,
  durableTelegramCallbackStatus,
} from "@/backend/integrations/telegram/durable-callback-contract";
import {
  parseDurableTelegramFailureRedirect,
  parseDurableTelegramReplay,
} from "@/backend/integrations/telegram/durable-callback-decoder";
import {
  claimResumableDurableTelegramCallback,
  findCommittedDurableTelegramRecoverySession,
  loadDurableTelegramCallbackRecord,
  renewDurableTelegramCallbackLease,
  resumeCommittedDurableTelegramRecovery,
  rewrapDurableTelegramCallbackResult,
  scrubExpiredDurableTelegramCallbackResult,
  terminalizeDurableTelegramCallback,
} from "@/backend/integrations/telegram/durable-callback-repository";
import {
  parseDurableTelegramCheckpoint,
  revealDurableTelegramStored,
} from "@/backend/integrations/telegram/durable-callback-transport";
import {
  committedDurableTelegramRecoveryReplay,
  durableTelegramCallbackProofMatches,
  durableTelegramCallbackWorkDeadline,
  isDurableTelegramCallbackResumable,
} from "@/backend/integrations/telegram/durable-callback-transitions";
import { recordOperationalEvent } from "@/backend/observability/metrics";
import { randomToken, safeEqual, sha256 } from "@/backend/security/crypto";

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
    const renewed = await renewDurableTelegramCallbackLease(
      ownership,
      status,
      clock(),
    );
    if (renewed !== 1) ownershipLost = true;
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
  const record = await loadDurableTelegramCallbackRecord(stateHash);
  const codeHash = sha256(code);
  if (
    !record
    || !durableTelegramCallbackProofMatches(record, proof)
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
    const scrubbed = await scrubExpiredDurableTelegramCallbackResult(record, now);
    if (scrubbed === 1) {
      recordOperationalEvent("telegram_callback_expired_result_scrubbed");
    }
    return {
      status: "failed",
      redirectTo: "/login?auth=telegram_recovery_required",
    };
  }
  const loadedRecord: LoadedDurableTelegramCallbackRecord = {
    id: record.id,
    callbackStatus: record.callbackStatus,
    callbackLeaseExpiresAt: record.callbackLeaseExpiresAt,
    callbackResultEncrypted: record.callbackResultEncrypted,
    callbackWebSessionId: record.callbackWebSessionId,
    expiresAt: record.expiresAt,
  };
  if (record.callbackStatus === durableTelegramCallbackStatus.COMPLETED) {
    const { stored, revealed } = revealDurableTelegramStored(
      record.callbackResultEncrypted,
    );
    if (stored.phase !== durableTelegramCallbackStatus.COMPLETED) {
      throw new Error("Durable Telegram completion phase mismatch");
    }
    if (revealed.needsRewrap) {
      await rewrapDurableTelegramCallbackResult({
        id: record.id,
        callbackStatus: record.callbackStatus,
        callbackResultEncrypted: record.callbackResultEncrypted,
      }, revealed.value);
      recordOperationalEvent("encrypted_telegram_callback_result_rewrapped");
    }
    return {
      status: "completed",
      outcome: parseDurableTelegramReplay(stored.value),
    };
  }
  if (record.callbackStatus === durableTelegramCallbackStatus.FAILED) {
    const { stored } = revealDurableTelegramStored(record.callbackResultEncrypted);
    return {
      status: "failed",
      redirectTo: parseDurableTelegramFailureRedirect(stored),
    };
  }
  if (durableTelegramCallbackWorkDeadline(record.expiresAt) <= now) {
    const terminal = await terminalizeDurableTelegramCallback(
      loadedRecord,
      "CALLBACK_DEADLINE_EXCEEDED",
      now,
      true,
    );
    if (!terminal.failed) return { status: "processing" };
    recordOperationalEvent("telegram_callback_work_deadline_exceeded");
    return { status: "failed", redirectTo: terminal.redirectTo };
  }
  if (record.callbackStatus === durableTelegramCallbackStatus.RECOVERY_DISPATCHING) {
    if (record.callbackLeaseExpiresAt && record.callbackLeaseExpiresAt > now) {
      return { status: "processing" };
    }
    const { stored } = revealDurableTelegramStored(record.callbackResultEncrypted);
    const replay = stored.phase === durableTelegramCallbackStatus.RECOVERY_DISPATCHING
      ? parseDurableTelegramReplay(stored.value)
      : null;
    const replaySession = replay?.session;
    const recoveryCommitted = replaySession
      && record.callbackWebSessionId === replaySession.webSessionId
      ? await findCommittedDurableTelegramRecoverySession(replaySession, now)
      : null;
    if (replay && replaySession && recoveryCommitted) {
      const committedReplay = committedDurableTelegramRecoveryReplay(replay);
      const claimToken = randomToken(32);
      const resumed = await resumeCommittedDurableTelegramRecovery({
        record: loadedRecord,
        claimToken,
        replaySession,
        committedReplay,
        now,
      });
      if (resumed !== 1) return { status: "processing" };
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
    const terminal = await terminalizeDurableTelegramCallback(
      loadedRecord,
      replay ? "REMNASHOP_RECOVERY_AMBIGUOUS" : "RECOVERY_CHECKPOINT_INVALID",
      now,
    );
    if (!terminal.failed) return { status: "processing" };
    recordOperationalEvent("telegram_callback_recovery_dispatch_ambiguous");
    return { status: "failed", redirectTo: terminal.redirectTo };
  }
  if (
    record.callbackStatus === durableTelegramCallbackStatus.PROVIDER_DISPATCHING
    || record.callbackStatus === durableTelegramCallbackStatus.REMNASHOP_DISPATCHING
  ) {
    if (record.callbackLeaseExpiresAt && record.callbackLeaseExpiresAt > now) {
      return { status: "processing" };
    }
    const terminal = await terminalizeDurableTelegramCallback(
      loadedRecord,
      record.callbackStatus === durableTelegramCallbackStatus.PROVIDER_DISPATCHING
        ? "OIDC_CODE_EXCHANGE_AMBIGUOUS"
        : "REMNASHOP_AUTH_AMBIGUOUS",
      now,
    );
    if (!terminal.failed) return { status: "processing" };
    recordOperationalEvent(
      record.callbackStatus === durableTelegramCallbackStatus.PROVIDER_DISPATCHING
        ? "telegram_callback_oidc_dispatch_ambiguous"
        : "telegram_callback_remnashop_dispatch_ambiguous",
    );
    return { status: "failed", redirectTo: terminal.redirectTo };
  }
  if (!isDurableTelegramCallbackResumable(record.callbackStatus)) {
    return { status: "none" };
  }
  if (record.callbackLeaseExpiresAt && record.callbackLeaseExpiresAt > now) {
    return { status: "processing" };
  }
  const parsed = parseDurableTelegramCheckpoint(
    record.callbackStatus,
    record.callbackResultEncrypted,
  );
  const claimToken = randomToken(32);
  const claimed = await claimResumableDurableTelegramCallback({
    record: loadedRecord,
    stateHash,
    proof,
    codeHash,
    claimToken,
    now,
    ...(parsed.needsRewrap ? { rewrappedPlaintext: parsed.plaintext } : {}),
  });
  if (claimed !== 1) return { status: "processing" };
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
