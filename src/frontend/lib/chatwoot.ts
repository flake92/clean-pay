import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";

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
  setUser(identifier: string, user: ChatwootUserInput): void;
  setCustomAttributes(attributes: Record<string, string>): void;
  toggleBubbleVisibility(visibility: "hide" | "show"): void;
  reset(): void;
};

type ChatwootIdentityState = {
  core: string;
  customAttributes: string;
};

declare global {
  interface Window {
    $chatwoot?: ChatwootApi;
    chatwootSDK?: {
      run(config: { baseUrl: string; websiteToken: string }): void;
    };
    chatwootSettings?: Record<string, unknown>;
    cleanPayChatwootAuthorized?: boolean;
    cleanPayChatwootIdentity?: ChatwootIdentityState;
  }
}

const scriptId = "clean-pay-chatwoot-sdk";
const identityStorageKey = "clean-pay:chatwoot-identity:v1";
let sdkPromise: Promise<void> | null = null;

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

export function clearChatwootIdentityState() {
  if (typeof window === "undefined") {
    return;
  }

  window.cleanPayChatwootIdentity = undefined;

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

export function identifyChatwootUser(config: ChatwootWidgetConfig) {
  const chatwoot = window.$chatwoot;

  if (!chatwoot || !window.cleanPayChatwootAuthorized) {
    return;
  }

  const core = fingerprint(JSON.stringify([
    config.websiteToken,
    config.user.identifier,
    config.user.identifierHash,
    config.user.name,
    config.user.email,
  ]));
  const customAttributes = fingerprint(JSON.stringify(config.user.customAttributes));
  const previous = window.cleanPayChatwootIdentity ?? storedIdentity();

  // Calling setUser repeatedly is intentional: the official SDK performs its
  // own cookie-based deduplication and will resend identity if that cookie was
  // removed independently of Clean Pay state.
  chatwoot.setUser(config.user.identifier, {
    name: config.user.name,
    ...(config.user.email ? { email: config.user.email } : {}),
    identifier_hash: config.user.identifierHash,
    custom_attributes: config.user.customAttributes,
  });

  // setUser is asynchronous inside the SDK. A separate attribute update is
  // safe only when the already-bound core identity did not change.
  if (previous?.core === core && previous.customAttributes !== customAttributes) {
    chatwoot.setCustomAttributes(config.user.customAttributes);
  }

  rememberIdentity({ core, customAttributes });
  // Reveal the launcher only after the signed identity command was accepted
  // by the SDK. This also avoids a guest-widget flash during initial loading.
  chatwoot.toggleBubbleVisibility("show");
}

export function resetChatwootSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.cleanPayChatwootAuthorized = false;
  clearChatwootIdentityState();
  const chatwoot = window.$chatwoot;

  if (chatwoot) {
    try {
      chatwoot.reset();
    } catch {
      // Fall through to direct cookie cleanup.
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
