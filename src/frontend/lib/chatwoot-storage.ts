import type {
  ChatwootIdentityState,
  ChatwootOwnershipState,
  StoredChatwootOwnershipState,
} from "@/frontend/lib/chatwoot-contract";
import { chatwootFingerprint } from "@/frontend/lib/chatwoot-transitions";

const identityStorageKey = "clean-pay:chatwoot-identity:v1";
const ownershipStorageKey = "clean-pay:chatwoot-ownership:v1";

export function storedChatwootIdentity() {
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

export function rememberChatwootIdentity(identity: ChatwootIdentityState) {
  window.cleanPayChatwootIdentity = identity;

  try {
    // Persist only non-reversible fingerprints. They let a new page notice a
    // custom-attribute-only change without retaining the HMAC signature.
    window.localStorage.setItem(identityStorageKey, JSON.stringify(identity));
    // A correlated full-payload success supersedes the weaker ownership-only
    // proof, so the latter must not outlive it as a second source of truth.
    window.localStorage.removeItem(ownershipStorageKey);
  } catch {
    // Identification still works when persistent storage is unavailable.
  }
}

function storedChatwootOwnership() {
  try {
    const value = window.localStorage.getItem(ownershipStorageKey);
    const parsed = value
      ? JSON.parse(value) as Partial<StoredChatwootOwnershipState>
      : null;

    return (
      typeof parsed?.core === "string"
      && typeof parsed.customAttributes === "string"
      && typeof parsed.conversation === "string"
    )
      ? parsed as StoredChatwootOwnershipState
      : undefined;
  } catch {
    return undefined;
  }
}

export function rememberChatwootOwnership(
  identity: ChatwootIdentityState,
  conversation: string,
  persist: boolean,
) {
  window.cleanPayChatwootOwnership = {
    ...identity,
    conversation,
  };

  if (!persist) {
    return;
  }

  try {
    // Store only fingerprints: neither the signed hash nor the Chatwoot
    // conversation token is persisted. The proof is reusable solely with the
    // same server-provided identity core and the exact current conversation.
    window.localStorage.setItem(ownershipStorageKey, JSON.stringify({
      ...identity,
      conversation: chatwootFingerprint(conversation),
    } satisfies StoredChatwootOwnershipState));
  } catch {
    // The current page can still use the in-memory ownership proof.
  }
}

export function restoreChatwootOwnership(
  core: string,
  conversation: string,
) {
  const current = window.cleanPayChatwootOwnership;

  if (current?.core === core && current.conversation === conversation) {
    return current;
  }

  const stored = storedChatwootOwnership();
  if (
    stored?.core !== core
    || stored.conversation !== chatwootFingerprint(conversation)
  ) {
    return undefined;
  }

  const restored: ChatwootOwnershipState = {
    core: stored.core,
    customAttributes: stored.customAttributes,
    conversation,
  };
  window.cleanPayChatwootOwnership = restored;
  return restored;
}

export function hasChatwootCookie(name: string) {
  try {
    const encodedName = `${encodeURIComponent(name)}=`;

    return document.cookie.split(";").some((cookie) => (
      cookie.trim().startsWith(encodedName)
    ));
  } catch {
    return false;
  }
}

export function chatwootCookieValue(name: string) {
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

export function clearChatwootIdentityState(preserveFailedIdentity = false) {
  if (typeof window === "undefined") {
    return;
  }

  window.cleanPayChatwootIdentity = undefined;
  window.cleanPayChatwootOwnership = undefined;
  window.cleanPayChatwootPendingIdentity = undefined;
  if (!preserveFailedIdentity) {
    window.cleanPayChatwootFailedIdentity = undefined;
  }

  try {
    window.localStorage.removeItem(identityStorageKey);
    window.localStorage.removeItem(ownershipStorageKey);
  } catch {
    // Session cleanup must never block Clean Pay navigation.
  }
}

export function expireChatwootCookie(name: string) {
  try {
    document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // Session cleanup must never prevent Clean Pay logout.
  }
}

export function clearKnownChatwootCookies(websiteToken?: string) {
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
    expireChatwootCookie(name);
  }
}
