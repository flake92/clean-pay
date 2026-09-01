import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import type { ChatwootIdentificationStatus } from "@/frontend/lib/chatwoot-contract";
import {
  clearChatwootSupportContextCache,
  loadChatwootSupportContextCached,
} from "@/frontend/lib/chatwoot-context-cache";
import {
  chatwootCookieValue,
  clearChatwootIdentityState,
  clearKnownChatwootCookies,
  expireChatwootCookie,
  hasChatwootCookie,
  rememberChatwootIdentity,
  rememberChatwootOwnership,
  restoreChatwootOwnership,
  storedChatwootIdentity,
} from "@/frontend/lib/chatwoot-storage";
import {
  failedChatwootIdentityAttempt,
  ownershipConfirmedChatwootIdentityAttempt,
  projectChatwootIdentity,
  sentChatwootIdentityAttempt,
  waitingChatwootIdentityAttempt,
} from "@/frontend/lib/chatwoot-transitions";

export type { ChatwootIdentificationStatus };
export {
  clearChatwootSupportContextCache,
  loadChatwootSupportContextCached,
};
export { clearChatwootIdentityState };
export {
  applyChatwootManagedLabels,
  isChatwootFrameReady,
  isChatwootIdentityConfirmation,
  isUnexpectedChatwootFrameMessage,
  loadChatwootSdk,
} from "@/frontend/lib/chatwoot-transport";

export const CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS = 12_000;
export const CHATWOOT_IDENTITY_MAX_RETRIES = 1;
let identityAttemptSequence = 0;

function nextIdentityAttemptId() {
  identityAttemptSequence += 1;
  return `${Date.now().toString(36)}-${identityAttemptSequence.toString(36)}`;
}

function sendChatwootIdentity(
  config: ChatwootWidgetConfig,
  supportAttributes: Record<string, string>,
  retryCount: number,
) {
  const chatwoot = window.$chatwoot;

  if (!chatwoot || !window.cleanPayChatwootAuthorized) {
    return false;
  }

  const { customAttributes, identity } = projectChatwootIdentity(
    config,
    supportAttributes,
  );
  const pending = sentChatwootIdentityAttempt(
    identity,
    nextIdentityAttemptId(),
    Date.now(),
    retryCount,
  );

  expireChatwootCookie(`cw_user_${config.websiteToken}`);
  window.cleanPayChatwootPendingIdentity = pending;

  try {
    chatwoot.setUser(config.user.identifier, {
      name: config.user.name,
      ...(config.user.email ? { email: config.user.email } : {}),
      identifier_hash: config.user.identifierHash,
      custom_attributes: customAttributes,
    });
    return true;
  } catch (error) {
    failChatwootPendingIdentityAttempt(
      pending.attemptId,
      config.websiteToken,
    );
    throw error;
  }
}

function queueChatwootIdentityAfterOwnership(
  config: ChatwootWidgetConfig,
  supportAttributes: Record<string, string>,
) {
  const pending = window.cleanPayChatwootPendingIdentity;
  const chatwoot = window.$chatwoot;
  const frame = document.getElementById(
    "chatwoot_live_chat_widget",
  ) as HTMLIFrameElement | null;

  if (
    !pending
    || pending.phase !== "ownership_confirmed"
    || !chatwoot
    || !frame?.parentNode
    || !window.cleanPayChatwootAuthorized
  ) {
    return false;
  }

  const { identity } = projectChatwootIdentity(config, supportAttributes);
  const replacement = frame.cloneNode(false) as HTMLIFrameElement;
  const widgetUrl = new URL(`${config.baseUrl.replace(/\/$/, "")}/widget`);
  const conversation = chatwootCookieValue("cw_conversation");
  widgetUrl.searchParams.set("website_token", config.websiteToken);
  if (conversation) {
    widgetUrl.searchParams.set("cw_conversation", conversation);
  }
  replacement.src = widgetUrl.toString();
  replacement.style.visibility = "hidden";

  // Chatwoot 4.16 does not correlate its error event with setUser(). Retire
  // the generation that was ownership-confirmed before sending a newer
  // payload. Our capture listener can then reject every late message from the
  // detached frame before the SDK turns it into an unscoped chatwoot:error.
  chatwoot.identifier = undefined;
  chatwoot.user = undefined;
  chatwoot.hasLoaded = false;
  chatwoot.resetTriggered = false;
  chatwoot.toggleBubbleVisibility(
    pending.core === identity.core ? "show" : "hide",
  );
  expireChatwootCookie(`cw_user_${config.websiteToken}`);
  window.cleanPayChatwootPendingIdentity = waitingChatwootIdentityAttempt(
    identity,
    nextIdentityAttemptId(),
    Date.now(),
    0,
  );
  frame.replaceWith(replacement);
  return true;
}

export function enterChatwootAuthenticatedMode() {
  if (typeof window !== "undefined") {
    window.cleanPayChatwootAuthorized = true;
  }
}

export function identifyChatwootUser(
  config: ChatwootWidgetConfig,
  supportAttributes: Record<string, string> = {},
): ChatwootIdentificationStatus {
  const chatwoot = window.$chatwoot;

  if (!chatwoot || !window.cleanPayChatwootAuthorized) {
    return "unavailable";
  }

  const { identity: desired } = projectChatwootIdentity(config, supportAttributes);
  const previous = window.cleanPayChatwootIdentity ?? storedChatwootIdentity();
  const identityCookieName = `cw_user_${config.websiteToken}`;
  const conversation = chatwootCookieValue("cw_conversation");
  const ownership = conversation
    ? restoreChatwootOwnership(desired.core, conversation)
    : undefined;
  const failed = window.cleanPayChatwootFailedIdentity;

  if (ownership && failed?.core === desired.core) {
    // A prior server-confirmed proof for this exact signed actor and
    // conversation wins over an uncorrelated, late metadata error.
    window.cleanPayChatwootFailedIdentity = undefined;
  }

  if (
    window.cleanPayChatwootFailedIdentity?.core === desired.core
    && window.cleanPayChatwootFailedIdentity.customAttributes
      === desired.customAttributes
  ) {
    return "failed";
  }

  if (failed) {
    // A changed signed identity or support context gets its own bounded cycle.
    window.cleanPayChatwootFailedIdentity = undefined;
  }

  const pending = window.cleanPayChatwootPendingIdentity;

  if (pending) {
    if (pending.phase === "ownership_confirmed") {
      const ownershipMatches = (
        conversation !== null
        && restoreChatwootOwnership(pending.core, conversation)?.customAttributes
          === pending.customAttributes
      );

      if (
        !ownershipMatches
        && (!hasChatwootCookie(identityCookieName) || !hasChatwootCookie("cw_conversation"))
      ) {
        // Without a matching server-confirmed ownership proof, a missing SDK
        // identity/conversation cookie must remain fail-closed.
        failChatwootPendingIdentityAttempt(
          pending.attemptId,
          config.websiteToken,
        );
        chatwoot.toggleBubbleVisibility("hide");
        return "failed";
      }

      if (
        pending.core === desired.core
        && pending.customAttributes === desired.customAttributes
      ) {
        chatwoot.toggleBubbleVisibility("show");
        return "ready";
      }

      // No success event exists for a same-contact setUser in Chatwoot 4.16.
      // Serialize a newer desired payload through a fresh iframe generation,
      // so an eventual error from the ownership-confirmed request cannot be
      // misattributed to the new request.
      queueChatwootIdentityAfterOwnership(config, supportAttributes);
    }

    // A waiting retry/update is activated only by a validated `loaded`
    // message from the replacement iframe. Generic ready/open events must not
    // race it.
    if (ownership?.core === pending.core) {
      chatwoot.toggleBubbleVisibility("show");
    }
    return "pending";
  }

  if (
    previous?.core === desired.core
    && previous.customAttributes === desired.customAttributes
    && hasChatwootCookie(identityCookieName)
    && hasChatwootCookie("cw_conversation")
  ) {
    if (conversation) {
      rememberChatwootOwnership(desired, conversation, false);
    }
    chatwoot.toggleBubbleVisibility("show");
    return "ready";
  }

  if (ownership?.customAttributes === desired.customAttributes) {
    chatwoot.toggleBubbleVisibility("show");
    return "ready";
  }

  if (!ownership || (previous?.core && previous.core !== desired.core)) {
    // Never expose a bubble still associated with another Clean Pay user,
    // conversation, inbox origin, or signed identity while verification is
    // in flight.
    chatwoot.toggleBubbleVisibility("hide");
  } else {
    // Metadata may be stale, but the conversation itself was already proved
    // to belong to the current actor and can remain usable during its update.
    chatwoot.toggleBubbleVisibility("show");
  }

  // The SDK's identity cookie ignores custom_attributes. Force the signed
  // request whenever our confirmed fingerprint or its cookies are missing.
  sendChatwootIdentity(config, supportAttributes, 0);

  return "pending";
}

export function getChatwootPendingIdentityAttempt() {
  return typeof window === "undefined"
    ? undefined
    : window.cleanPayChatwootPendingIdentity;
}

export function failChatwootPendingIdentityAttempt(
  attemptId: string,
  websiteToken?: string,
) {
  const pending = window.cleanPayChatwootPendingIdentity;

  if (!pending || pending.attemptId !== attemptId) {
    return false;
  }

  window.cleanPayChatwootFailedIdentity = failedChatwootIdentityAttempt(pending);
  window.cleanPayChatwootPendingIdentity = undefined;
  if (websiteToken) {
    expireChatwootCookie(`cw_user_${websiteToken}`);
  }
  return true;
}

export function failChatwootIdentity(
  config: ChatwootWidgetConfig,
  supportAttributes: Record<string, string> = {},
) {
  if (typeof window === "undefined") {
    return;
  }

  const { identity } = projectChatwootIdentity(config, supportAttributes);

  window.cleanPayChatwootFailedIdentity = identity;
  window.cleanPayChatwootPendingIdentity = undefined;
  clearChatwootIdentityState(true);
  expireChatwootCookie(`cw_user_${config.websiteToken}`);
}

export function retryChatwootIdentityAttempt(
  attemptId: string,
  config: ChatwootWidgetConfig,
) {
  const pending = window.cleanPayChatwootPendingIdentity;
  const chatwoot = window.$chatwoot;
  const frame = document.getElementById(
    "chatwoot_live_chat_widget",
  ) as HTMLIFrameElement | null;

  if (
    !pending
    || pending.attemptId !== attemptId
    || pending.retryCount >= CHATWOOT_IDENTITY_MAX_RETRIES
    || !chatwoot
    || !frame?.parentNode
    || !window.cleanPayChatwootAuthorized
  ) {
    return false;
  }

  try {
    chatwoot.toggleBubbleVisibility("hide");
  } catch {
    // A partially loaded launcher must not prevent the bounded retry.
  }

  const replacement = frame.cloneNode(false) as HTMLIFrameElement;
  const widgetUrl = new URL(`${config.baseUrl.replace(/\/$/, "")}/widget`);
  const conversation = chatwootCookieValue("cw_conversation");
  widgetUrl.searchParams.set("website_token", config.websiteToken);
  if (conversation) {
    widgetUrl.searchParams.set("cw_conversation", conversation);
  }
  replacement.src = widgetUrl.toString();
  replacement.style.visibility = "hidden";

  // Reset only the SDK's in-memory delivery state. Calling its public reset()
  // would erase the active conversation; replacing the frame creates a new
  // WindowProxy while preserving that conversation for the retry.
  chatwoot.identifier = undefined;
  chatwoot.user = undefined;
  chatwoot.hasLoaded = false;
  chatwoot.resetTriggered = false;
  expireChatwootCookie(`cw_user_${config.websiteToken}`);

  window.cleanPayChatwootPendingIdentity = waitingChatwootIdentityAttempt(
    pending,
    nextIdentityAttemptId(),
    Date.now(),
    pending.retryCount + 1,
  );
  frame.replaceWith(replacement);
  return true;
}

export function activateChatwootIdentityRetry(
  config: ChatwootWidgetConfig,
  supportAttributes: Record<string, string> = {},
) {
  const pending = window.cleanPayChatwootPendingIdentity;

  if (!pending || pending.phase !== "waiting_for_frame") {
    return false;
  }

  return sendChatwootIdentity(config, supportAttributes, pending.retryCount);
}

export function confirmChatwootIdentity(expectedAttemptId?: string) {
  const pending = window.cleanPayChatwootPendingIdentity;

  if (
    !pending
    || (pending.phase !== "sent" && pending.phase !== "ownership_confirmed")
    || (expectedAttemptId && pending.attemptId !== expectedAttemptId)
    || !window.cleanPayChatwootAuthorized
  ) {
    return false;
  }

  const preserveConfirmedOwnership = pending.phase === "ownership_confirmed";
  window.cleanPayChatwootPendingIdentity = undefined;
  window.cleanPayChatwootFailedIdentity = undefined;
  rememberChatwootIdentity({
    core: pending.core,
    customAttributes: pending.customAttributes,
  });
  const conversation = chatwootCookieValue("cw_conversation");
  if (conversation) {
    rememberChatwootOwnership({
      core: pending.core,
      customAttributes: pending.customAttributes,
    }, conversation, preserveConfirmedOwnership);
  }
  return true;
}

/**
 * Marks a transport generation as ownership-confirmed after the current
 * conversation was proved to belong to the desired user, without claiming
 * that Chatwoot applied the generation's name, email or custom attributes.
 * The bounded proof persists only non-reversible identity, attempted-payload,
 * and conversation fingerprints; confirmChatwootIdentity() remains the sole
 * path that records the complete payload as successfully applied.
 */
export function confirmChatwootIdentityOwnership(expectedAttemptId: string) {
  const pending = window.cleanPayChatwootPendingIdentity;
  const conversation = chatwootCookieValue("cw_conversation");

  if (
    !pending
    || pending.phase !== "sent"
    || pending.attemptId !== expectedAttemptId
    || !window.cleanPayChatwootAuthorized
    || !conversation
  ) {
    return false;
  }

  window.cleanPayChatwootPendingIdentity =
    ownershipConfirmedChatwootIdentityAttempt(pending);
  rememberChatwootOwnership({
    core: pending.core,
    customAttributes: pending.customAttributes,
  }, conversation, true);
  window.cleanPayChatwootFailedIdentity = undefined;
  return true;
}

/**
 * Keeps the official launcher usable when Chatwoot reports a late payload
 * update error after Clean Pay already proved that the active conversation
 * belongs to the authenticated user. The proof is scoped to fingerprints of
 * the signed core identity and exact conversation; logout or an account or
 * conversation change invalidates it.
 */
export function retainChatwootVerifiedOwnership(
  config: ChatwootWidgetConfig,
  supportAttributes: Record<string, string> = {},
) {
  if (typeof window === "undefined") {
    return false;
  }

  const chatwoot = window.$chatwoot;
  const conversation = chatwootCookieValue("cw_conversation");
  if (
    !window.cleanPayChatwootAuthorized
    || !chatwoot
    || !conversation
  ) {
    return false;
  }

  const { identity } = projectChatwootIdentity(config, supportAttributes);
  const ownership = restoreChatwootOwnership(identity.core, conversation);

  if (
    !ownership
    || ownership.core !== identity.core
    || ownership.conversation !== conversation
  ) {
    return false;
  }

  const pending = window.cleanPayChatwootPendingIdentity;
  if (pending?.core === ownership.core) {
    rememberChatwootOwnership({
      core: pending.core,
      customAttributes: pending.customAttributes,
    }, conversation, true);
    window.cleanPayChatwootPendingIdentity =
      ownershipConfirmedChatwootIdentityAttempt(pending);
  }
  window.cleanPayChatwootFailedIdentity = undefined;

  try {
    chatwoot.toggleBubbleVisibility("show");
  } catch {
    return false;
  }
  return true;
}

export function resetChatwootSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.cleanPayChatwootAuthorized = false;
  clearChatwootIdentityState();
  clearChatwootSupportContextCache();
  const chatwoot = window.$chatwoot;

  if (chatwoot) {
    // The standard SDK keeps these fields across reset() and otherwise sends
    // the previous signed user to the freshly loaded guest iframe again.
    chatwoot.identifier = undefined;
    chatwoot.user = undefined;
    chatwoot.hasLoaded = false;

    try {
      chatwoot.reset();
    } catch {
      // Fall through to direct cookie cleanup.
    } finally {
      // reset() suppresses the next ready event. Re-enable it so a later
      // client-side login can identify safely after the guest iframe reloads.
      chatwoot.resetTriggered = false;
    }

    try {
      chatwoot.toggleBubbleVisibility("hide");
    } catch {
      // A partially removed third-party widget must not block logout.
    }
  }

  clearKnownChatwootCookies(chatwoot?.websiteToken);
}

export function enterChatwootGuestMode() {
  if (typeof window === "undefined") {
    return;
  }

  // Always clear first-party Chatwoot cookies. This also covers a fresh guest
  // document after the Clean Pay session expired before the SDK was loaded.
  resetChatwootSession();
}
