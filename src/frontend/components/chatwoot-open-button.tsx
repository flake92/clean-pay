"use client";

import { useEffect, useState } from "react";

import {
  useSupportChatExpectedIdentity,
  useSupportChatSessionAuthenticated,
} from "@/frontend/components/chatwoot-session-context";
import { CHATWOOT_STATE_CHANGED_EVENT } from "@/frontend/lib/chatwoot-state-events";
import {
  chatwootCookieValue,
  hasChatwootCookie,
} from "@/frontend/lib/chatwoot-storage";

type ChatwootActionState = "signed-out" | "connecting" | "failed" | "ready";

function chatwootActionState(
  authenticated: boolean,
  expectedIdentity: {
    baseUrl: string;
    core: string;
    websiteToken: string;
  } | null,
): ChatwootActionState {
  if (!authenticated || typeof window === "undefined") {
    return "signed-out";
  }

  if (
    expectedIdentity
    && window.cleanPayChatwootFailedIdentity?.core === expectedIdentity.core
  ) {
    return "failed";
  }

  if (!expectedIdentity || !window.cleanPayChatwootAuthorized) {
    return "connecting";
  }

  const chatwoot = window.$chatwoot;
  if (
    chatwoot?.baseUrl !== expectedIdentity.baseUrl
    || chatwoot.websiteToken !== expectedIdentity.websiteToken
  ) {
    return "connecting";
  }
  const pending = window.cleanPayChatwootPendingIdentity;
  if (pending && pending.core !== expectedIdentity.core) {
    return "connecting";
  }
  const conversation = chatwootCookieValue("cw_conversation");
  const identityConfirmed = Boolean(
    window.cleanPayChatwootIdentity?.core === expectedIdentity.core
    && hasChatwootCookie(`cw_user_${expectedIdentity.websiteToken}`)
    && conversation,
  );
  const ownershipConfirmed = Boolean(
    conversation
    && window.cleanPayChatwootOwnership?.core === expectedIdentity.core
    && window.cleanPayChatwootOwnership.conversation === conversation,
  );

  return (
    chatwoot?.hasLoaded
    && chatwoot.toggle
    && (identityConfirmed || ownershipConfirmed)
  ) ? "ready" : "connecting";
}

export function SupportChatOpenButton() {
  const authenticated = useSupportChatSessionAuthenticated();
  const expectedIdentity = useSupportChatExpectedIdentity();
  const [state, setState] = useState<ChatwootActionState>(
    authenticated ? "connecting" : "signed-out",
  );

  useEffect(() => {
    const refresh = () => setState(chatwootActionState(
      authenticated,
      expectedIdentity,
    ));
    const refreshAfterCurrentEvent = () => queueMicrotask(refresh);
    refresh();

    window.addEventListener(CHATWOOT_STATE_CHANGED_EVENT, refresh);
    window.addEventListener("chatwoot:ready", refreshAfterCurrentEvent);
    window.addEventListener("chatwoot:error", refreshAfterCurrentEvent);

    return () => {
      window.removeEventListener(CHATWOOT_STATE_CHANGED_EVENT, refresh);
      window.removeEventListener("chatwoot:ready", refreshAfterCurrentEvent);
      window.removeEventListener("chatwoot:error", refreshAfterCurrentEvent);
    };
  }, [authenticated, expectedIdentity]);

  if (state === "signed-out") {
    return <span className="line-height-3 text-600">Чат доступен после входа в аккаунт.</span>;
  }

  if (state === "failed") {
    return (
      <span className="line-height-3 text-600">
        Чат временно недоступен. Обновите страницу или попробуйте позже.
      </span>
    );
  }

  if (state === "connecting") {
    return <span className="line-height-3 text-600">Подключаем чат поддержки…</span>;
  }

  return (
    <button
      className="p-button p-component p-button-outlined"
      onClick={() => {
        if (
          chatwootActionState(authenticated, expectedIdentity) === "ready"
        ) {
          window.$chatwoot?.toggle?.("open");
        }
      }}
      type="button"
    >
      <span className="p-button-icon p-c pi pi-comments" />
      <span className="p-button-label">Открыть чат поддержки</span>
    </button>
  );
}
