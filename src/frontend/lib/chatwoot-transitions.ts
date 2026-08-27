import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import type {
  ChatwootIdentityState,
  ChatwootPendingIdentityState,
} from "@/frontend/lib/chatwoot-contract";

export function chatwootFingerprint(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

export function projectChatwootIdentity(
  config: ChatwootWidgetConfig,
  supportAttributes: Record<string, string>,
) {
  const customAttributes = {
    ...config.user.customAttributes,
    ...supportAttributes,
  };
  const core = chatwootFingerprint(JSON.stringify([
    config.baseUrl,
    config.websiteToken,
    config.user.identifier,
    config.user.identifierHash,
    config.user.name,
    config.user.email,
  ]));

  return {
    customAttributes,
    identity: {
      core,
      customAttributes: chatwootFingerprint(JSON.stringify(customAttributes)),
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
