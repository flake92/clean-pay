import type {
  ChatwootIdentityState,
  ChatwootOwnershipState,
  StoredChatwootOwnershipState,
} from "@/frontend/lib/chatwoot-contract";
import { notifyChatwootStateChanged } from "@/frontend/lib/chatwoot-state-events";
import { chatwootDigest } from "@/frontend/lib/chatwoot-digest";

const identityStorageKey = "clean-pay:chatwoot-identity:v1";
const ownershipStorageKey = "clean-pay:chatwoot-ownership:v1";

const sha256Pattern = /^[a-f0-9]{64}$/;

export function storedChatwootIdentity(identity: ChatwootIdentityState) {
  try {
    const value = window.localStorage.getItem(identityStorageKey);
    const parsed = value ? JSON.parse(value) as Partial<ChatwootIdentityState> : null;

    return parsed?.core === identity.core
      && typeof parsed.customAttributes === "string"
      && sha256Pattern.test(parsed.customAttributes)
      && parsed.customAttributes === chatwootDigest(identity.customAttributes)
      ? identity
      : undefined;
  } catch {
    return undefined;
  }
}

export function rememberChatwootIdentity(identity: ChatwootIdentityState) {
  window.cleanPayChatwootIdentity = identity;

  try {
    // The domain-separated server fingerprint is not a Chatwoot credential;
    // the exact context remains memory-only and is persisted only as SHA-256.
    window.localStorage.setItem(identityStorageKey, JSON.stringify({
      core: identity.core,
      customAttributes: chatwootDigest(identity.customAttributes),
    } satisfies ChatwootIdentityState));
    // A correlated full-payload success supersedes the weaker ownership-only
    // proof, so the latter must not outlive it as a second source of truth.
    window.localStorage.removeItem(ownershipStorageKey);
  } catch {
    // Identification still works when persistent storage is unavailable.
  }
  notifyChatwootStateChanged();
}

function storedChatwootOwnership() {
  try {
    const value = window.localStorage.getItem(ownershipStorageKey);
    const parsed = value
      ? JSON.parse(value) as Partial<StoredChatwootOwnershipState>
      : null;

    return (
      typeof parsed?.core === "string"
      && sha256Pattern.test(parsed.core)
      && typeof parsed.customAttributes === "string"
      && sha256Pattern.test(parsed.customAttributes)
      && typeof parsed.conversation === "string"
      && sha256Pattern.test(parsed.conversation)
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
  notifyChatwootStateChanged();

  if (!persist) {
    return;
  }

  try {
    // Store only fingerprints: neither the signed hash nor the Chatwoot
    // conversation token is persisted. The proof is reusable solely with the
    // same server-provided identity core and the exact current conversation.
    window.localStorage.setItem(ownershipStorageKey, JSON.stringify({
      ...identity,
      customAttributes: chatwootDigest(identity.customAttributes),
      conversation: chatwootDigest(conversation),
    } satisfies StoredChatwootOwnershipState));
  } catch {
    // The current page can still use the in-memory ownership proof.
  }
}

export function restoreChatwootOwnership(
  identity: ChatwootIdentityState,
  conversation: string,
) {
  const current = window.cleanPayChatwootOwnership;

  if (
    current?.core === identity.core
    && current.customAttributes === identity.customAttributes
    && current.conversation === conversation
  ) {
    return current;
  }

  const stored = storedChatwootOwnership();
  if (
    stored?.core !== identity.core
    || stored.customAttributes !== chatwootDigest(identity.customAttributes)
    || stored.conversation !== chatwootDigest(conversation)
  ) {
    return undefined;
  }

  const restored: ChatwootOwnershipState = {
    ...identity,
    conversation,
  };
  window.cleanPayChatwootOwnership = restored;
  notifyChatwootStateChanged();
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
  notifyChatwootStateChanged();
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
