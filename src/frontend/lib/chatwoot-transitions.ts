import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import type {
  ChatwootIdentityState,
  ChatwootPendingIdentityState,
} from "@/frontend/lib/chatwoot-contract";

export function serializeChatwootAttributes(
  attributes: Record<string, string>,
) {
  return JSON.stringify(Object.entries(attributes).sort(([left], [right]) => (
    left < right ? -1 : Number(left !== right)
  )));
}

export function projectChatwootIdentity(
  config: ChatwootWidgetConfig,
  supportAttributes: Record<string, string>,
) {
  const customAttributes = {
    ...config.user.customAttributes,
    ...supportAttributes,
  };

  return {
    customAttributes,
    identity: {
      core: config.identityFingerprint,
      // Keep the exact canonical value in memory. Persistence uses SHA-256,
      // so no finite-width non-cryptographic hash remains a trust boundary.
      customAttributes: serializeChatwootAttributes(customAttributes),
    },
  };
}

export function sentChatwootIdentityAttempt(
  identity: ChatwootIdentityState,
  attemptId: string,
  startedAt: number,
  retryCount: number,
): ChatwootPendingIdentityState {
  return {
    ...identity,
    attemptId,
    startedAt,
    retryCount,
    phase: "sent",
  };
}

export function waitingChatwootIdentityAttempt(
  identity: ChatwootIdentityState,
  attemptId: string,
  startedAt: number,
  retryCount: number,
): ChatwootPendingIdentityState {
  return {
    ...identity,
    attemptId,
    startedAt,
    retryCount,
    phase: "waiting_for_frame",
  };
}

export function ownershipConfirmedChatwootIdentityAttempt(
  pending: ChatwootPendingIdentityState,
): ChatwootPendingIdentityState {
  return {
    ...pending,
    phase: "ownership_confirmed",
  };
}

export function failedChatwootIdentityAttempt(
  pending: ChatwootPendingIdentityState,
): ChatwootIdentityState {
  return {
    core: pending.core,
    customAttributes: pending.customAttributes,
  };
}
