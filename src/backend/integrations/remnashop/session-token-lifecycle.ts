import { ServiceError } from "@/backend/errors/service-error";
import { encryptedRecovery } from "@/backend/integrations/remnashop/session-token-lifecycle-codec";
import {
  clearTerminalRefreshClaim,
  finalizeRefreshClaim,
  markRefreshDispatched,
  persistRefreshRecovery,
  prepareTokenAcquisition,
} from "@/backend/integrations/remnashop/session-token-lifecycle-repository";
import {
  assertRecoveryUsableForCaller,
  isTerminalProviderRefreshRejection,
  normalizeRefreshResult,
  type LockedSession,
  type RefreshResult,
} from "@/backend/integrations/remnashop/session-token-lifecycle-transitions";

export async function acquireRemnashopTokensForSession({
  session: requestedSession,
  refresh,
  forceRefresh = false,
}: {
  session: Pick<LockedSession, "id" | "userId">;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  forceRefresh?: boolean;
}) {
  const prepared = await prepareTokenAcquisition({
    sessionId: requestedSession.id,
    userId: requestedSession.userId,
    forceRefresh,
  });

  if (prepared.kind === "result") {
    return prepared.result;
  }

  if (prepared.kind === "wait") {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Another Remnashop token refresh is still in progress",
      { retryAfterSeconds: prepared.retryAfterSeconds },
    );
  }

  // The one-time provider call is deliberately outside every Prisma
  // transaction. Persist the dispatch phase first: once this marker commits,
  // an expired claim can never replay the possibly-consumed provider token.
  const dispatchedPlan = await markRefreshDispatched(prepared.plan);
  let refreshed: RefreshResult;
  try {
    refreshed = await refresh(dispatchedPlan.refreshToken);
  } catch (error) {
    // A provider-authenticated 401 proves that this one-time refresh token can
    // never yield a usable response. Clear only our exact dispatched claim so
    // verified e-mail/Telegram recovery can establish a fresh service session
    // in the same request. Transport failures and 5xx remain fenced because
    // their provider outcome is unknown and the token must never be replayed.
    if (!isTerminalProviderRefreshRejection(error)) {
      throw error;
    }

    await clearTerminalRefreshClaim(dispatchedPlan);
    return null;
  }
  const recovery = normalizeRefreshResult(refreshed);
  const recoveryEncrypted = encryptedRecovery(recovery);
  const alreadyFinalized = await persistRefreshRecovery({
    plan: dispatchedPlan,
    recovery,
    recoveryEncrypted,
  });

  const result = alreadyFinalized
    ? {
      accessToken: recovery.accessToken,
      refreshToken: recovery.refreshToken,
      session: alreadyFinalized,
      source: "refresh" as const,
    }
    : await finalizeRefreshClaim({
        plan: dispatchedPlan,
        recovery,
        recoveryEncrypted,
      });

  // Finalization can outlive a pathologically short provider access token.
  // Keep the newly-issued refresh token durable, but never hand an already
  // expired access token to the caller as an authorized result.
  assertRecoveryUsableForCaller(recovery);
  return result;
}
