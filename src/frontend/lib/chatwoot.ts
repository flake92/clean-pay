import type {
  ChatwootSupportContext,
  ChatwootWidgetConfig,
} from "@/application/models/chatwoot";

type ChatwootUserInput = {
  name: string;
  email?: string;
  identifier_hash: string;
  custom_attributes: Record<string, string>;
};

type ChatwootApi = {
  baseUrl: string;
  websiteToken: string;
  hasLoaded: boolean;
  identifier?: string | number;
  user?: ChatwootUserInput;
  resetTriggered?: boolean;
  setUser(identifier: string, user: ChatwootUserInput): void;
  setLabel?(label: string): void;
  removeLabel?(label: string): void;
  toggleBubbleVisibility(visibility: "hide" | "show"): void;
  reset(): void;
};

type ChatwootIdentityState = {
  core: string;
  customAttributes: string;
};

type ChatwootPendingIdentityState = ChatwootIdentityState & {
  attemptId: string;
  startedAt: number;
  retryCount: number;
  phase: "sent" | "waiting_for_frame";
};

export type ChatwootIdentificationStatus =
  | "unavailable"
  | "pending"
  | "failed"
  | "ready";

declare global {
  interface Window {
    $chatwoot?: ChatwootApi;
    chatwootSDK?: {
      run(config: { baseUrl: string; websiteToken: string }): void;
    };
    chatwootSettings?: Record<string, unknown>;
    cleanPayChatwootAuthorized?: boolean;
    cleanPayChatwootIdentity?: ChatwootIdentityState;
    cleanPayChatwootPendingIdentity?: ChatwootPendingIdentityState;
    cleanPayChatwootFailedIdentity?: ChatwootIdentityState;
  }
}

const scriptId = "clean-pay-chatwoot-sdk";
const identityStorageKey = "clean-pay:chatwoot-identity:v1";
const supportContextCacheTtlMs = 60_000;
export const CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS = 12_000;
export const CHATWOOT_IDENTITY_MAX_RETRIES = 1;
let sdkPromise: Promise<void> | null = null;
let identityAttemptSequence = 0;
const supportContextCache = new Map<string, {
  expiresAt: number;
  value: Promise<ChatwootSupportContext | null>;
}>();

export function loadChatwootSupportContextCached(
  identifier: string,
  loader: () => Promise<ChatwootSupportContext | null>,
  now = Date.now(),
) {
  const cached = supportContextCache.get(identifier);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = loader().catch((error) => {
    supportContextCache.delete(identifier);
    throw error;
  });
  supportContextCache.set(identifier, {
    expiresAt: now + supportContextCacheTtlMs,
    value,
  });

  return value;
}

export function clearChatwootSupportContextCache() {
  supportContextCache.clear();
}

function fingerprint(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

function storedIdentity() {
  try {
    const value = window.localStorage.getItem(identityStorageKey);
    const parsed = value ? JSON.parse(value) as Partial<ChatwootIdentityState> : null;

    return typeof parsed?.core === "string" && typeof parsed.customAttributes === "string"
      ? parsed as ChatwootIdentityState
      : undefined;
  } catch {
    return undefined;
  }
}

function rememberIdentity(identity: ChatwootIdentityState) {
  window.cleanPayChatwootIdentity = identity;

  try {
    // Persist only non-reversible fingerprints. They let a new page notice a
    // custom-attribute-only change without retaining the HMAC signature.
    window.localStorage.setItem(identityStorageKey, JSON.stringify(identity));
  } catch {
    // Identification still works when persistent storage is unavailable.
  }
}

function hasCookie(name: string) {
  try {
    const encodedName = `${encodeURIComponent(name)}=`;

    return document.cookie.split(";").some((cookie) => (
      cookie.trim().startsWith(encodedName)
    ));
  } catch {
    return false;
  }
}

function cookieValue(name: string) {
  try {
    const encodedName = `${encodeURIComponent(name)}=`;
    const value = document.cookie.split(";").find((cookie) => (
      cookie.trim().startsWith(encodedName)
    ));

    if (!value) {
      return null;
    }

    const encodedValue = value.trim().slice(encodedName.length);

    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return encodedValue;
    }
  } catch {
    return null;
  }
}

function nextIdentityAttemptId() {
  identityAttemptSequence += 1;
  return `${Date.now().toString(36)}-${identityAttemptSequence.toString(36)}`;
}

function desiredIdentity(
  config: ChatwootWidgetConfig,
  supportAttributes: Record<string, string>,
) {
  const customAttributes = {
    ...config.user.customAttributes,
    ...supportAttributes,
  };
  const core = fingerprint(JSON.stringify([
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
      customAttributes: fingerprint(JSON.stringify(customAttributes)),
    },
  };
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

  const { customAttributes, identity } = desiredIdentity(
    config,
    supportAttributes,
  );
  const pending: ChatwootPendingIdentityState = {
    ...identity,
    attemptId: nextIdentityAttemptId(),
    startedAt: Date.now(),
    retryCount,
    phase: "sent",
  };

  expireCookie(`cw_user_${config.websiteToken}`);
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

export function clearChatwootIdentityState(preserveFailedIdentity = false) {
  if (typeof window === "undefined") {
    return;
  }

  window.cleanPayChatwootIdentity = undefined;
  window.cleanPayChatwootPendingIdentity = undefined;
  if (!preserveFailedIdentity) {
    window.cleanPayChatwootFailedIdentity = undefined;
  }

  try {
    window.localStorage.removeItem(identityStorageKey);
  } catch {
    // Session cleanup must never block Clean Pay navigation.
  }
}

function expireCookie(name: string) {
  try {
    document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // Session cleanup must never prevent Clean Pay logout.
  }
}

function clearKnownCookies(websiteToken?: string) {
  const names = new Set(["cw_conversation"]);

  if (websiteToken) {
    names.add(`cw_user_${websiteToken}`);
  }

  try {
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.trim().split("=", 1)[0];

      if (name.startsWith("cw_user_")) {
        names.add(name);
      }
    }
  } catch {
    // Cookie enumeration may be disabled by browser privacy settings.
  }

  for (const name of names) {
    expireCookie(name);
  }
}

export function loadChatwootSdk(baseUrl: string) {
  if (typeof window === "undefined" || window.chatwootSDK) {
    return Promise.resolve();
  }

  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise<void>((resolve, reject) => {
    const loaded = () => {
      if (!window.chatwootSDK) {
        document.getElementById(scriptId)?.remove();
        reject(new Error("Chatwoot SDK did not initialize"));
        return;
      }

      resolve();
    };
    const failed = () => {
      document.getElementById(scriptId)?.remove();
      reject(new Error("Chatwoot SDK failed to load"));
    };
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener("load", loaded, { once: true });
      existing.addEventListener("error", failed, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.defer = true;
    script.src = `${baseUrl}/packs/js/sdk.js`;
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    sdkPromise = null;
    throw error;
  });

  return sdkPromise;
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

  const { identity: desired } = desiredIdentity(config, supportAttributes);
  const previous = window.cleanPayChatwootIdentity ?? storedIdentity();
  const identityCookieName = `cw_user_${config.websiteToken}`;
  const failed = window.cleanPayChatwootFailedIdentity;

  if (
    failed?.core === desired.core
    && failed.customAttributes === desired.customAttributes
  ) {
    return "failed";
  }

  if (failed) {
    // A changed signed identity or support context gets its own bounded cycle.
    window.cleanPayChatwootFailedIdentity = undefined;
  }

  // A waiting retry is activated only by a validated `loaded` message from
  // the replacement iframe. Generic ready/open events must not race it.
  if (window.cleanPayChatwootPendingIdentity) {
    return "pending";
  }

  if (
    previous?.core === desired.core
    && previous.customAttributes === desired.customAttributes
    && hasCookie(identityCookieName)
    && hasCookie("cw_conversation")
  ) {
    chatwoot.toggleBubbleVisibility("show");
    return "ready";
  }

  if (previous?.core && previous.core !== desired.core) {
    // Never expose a bubble still associated with another Clean Pay user,
    // inbox origin, or signed identity while the replacement is in flight.
    chatwoot.toggleBubbleVisibility("hide");
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

  window.cleanPayChatwootFailedIdentity = {
    core: pending.core,
    customAttributes: pending.customAttributes,
  };
  window.cleanPayChatwootPendingIdentity = undefined;
  if (websiteToken) {
    expireCookie(`cw_user_${websiteToken}`);
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

  const { identity } = desiredIdentity(config, supportAttributes);

  window.cleanPayChatwootFailedIdentity = identity;
  window.cleanPayChatwootPendingIdentity = undefined;
  clearChatwootIdentityState(true);
  expireCookie(`cw_user_${config.websiteToken}`);
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
  const conversation = cookieValue("cw_conversation");
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
  expireCookie(`cw_user_${config.websiteToken}`);

  const waitingAttempt: ChatwootPendingIdentityState = {
    ...pending,
    attemptId: nextIdentityAttemptId(),
    startedAt: Date.now(),
    retryCount: pending.retryCount + 1,
    phase: "waiting_for_frame",
  };
  window.cleanPayChatwootPendingIdentity = waitingAttempt;
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
    || pending.phase !== "sent"
    || (expectedAttemptId && pending.attemptId !== expectedAttemptId)
    || !window.cleanPayChatwootAuthorized
  ) {
    return false;
  }

  window.cleanPayChatwootPendingIdentity = undefined;
  window.cleanPayChatwootFailedIdentity = undefined;
  rememberIdentity({
    core: pending.core,
    customAttributes: pending.customAttributes,
  });
  return true;
}

function chatwootFrameMessage(event: MessageEvent, baseUrl: string) {
  let origin: string;

  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return null;
  }

  const frame = document.getElementById(
    "chatwoot_live_chat_widget",
  ) as HTMLIFrameElement | null;

  if (
    event.origin !== origin
    || !frame?.contentWindow
    || event.source !== frame.contentWindow
    || typeof event.data !== "string"
    || !event.data.startsWith("chatwoot-widget:")
  ) {
    return null;
  }

  try {
    return JSON.parse(event.data.slice("chatwoot-widget:".length)) as {
      event?: unknown;
      data?: { widgetAuthToken?: unknown };
    };
  } catch {
    return null;
  }
}

export function isUnexpectedChatwootFrameMessage(
  event: MessageEvent,
  baseUrl: string,
) {
  if (
    typeof event.data !== "string"
    || !event.data.startsWith("chatwoot-widget:")
  ) {
    return false;
  }

  return chatwootFrameMessage(event, baseUrl) === null;
}

export function isChatwootFrameReady(event: MessageEvent, baseUrl: string) {
  return chatwootFrameMessage(event, baseUrl)?.event === "loaded";
}

export function isChatwootIdentityConfirmation(
  event: MessageEvent,
  baseUrl: string,
) {
  const message = chatwootFrameMessage(event, baseUrl);

  return message?.event === "setAuthCookie"
    && typeof message.data?.widgetAuthToken === "string"
    && message.data.widgetAuthToken.length > 0;
}

export function applyChatwootManagedLabels(context: ChatwootSupportContext) {
  const chatwoot = window.$chatwoot;

  if (!chatwoot || !window.cleanPayChatwootAuthorized) {
    return;
  }

  for (const label of context.managedLabels) {
    try {
      if (label.enabled) {
        chatwoot.setLabel?.(label.name);
      } else {
        chatwoot.removeLabel?.(label.name);
      }
    } catch {
      // Older or partially loaded SDKs may not expose label operations.
    }
  }
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

  clearKnownCookies(chatwoot?.websiteToken);
}

export function enterChatwootGuestMode() {
  if (typeof window === "undefined") {
    return;
  }

  // Always clear first-party Chatwoot cookies. This also covers a fresh guest
  // document after the Clean Pay session expired before the SDK was loaded.
  resetChatwootSession();
}
