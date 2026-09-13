"use client";

import { useEffect, useState } from "react";

import { useSupportChatSessionAuthenticated } from "@/frontend/components/chatwoot-session-context";
import { CHATWOOT_STATE_CHANGED_EVENT } from "@/frontend/lib/chatwoot-state-events";

type ChatwootActionState = "signed-out" | "connecting" | "failed" | "ready";

function chatwootActionState(authenticated: boolean): ChatwootActionState {
  if (!authenticated || typeof window === "undefined") {
    return "signed-out";
  }

  if (window.cleanPayChatwootFailedIdentity) return "failed";

  if (!window.cleanPayChatwootAuthorized) return "connecting";

  const hasConfirmedIdentity = Boolean(
    window.cleanPayChatwootIdentity
    || window.cleanPayChatwootOwnership
    || window.cleanPayChatwootPendingIdentity?.phase === "ownership_confirmed",
  );

  return (
    window.$chatwoot?.hasLoaded
    && window.$chatwoot.toggle
    && hasConfirmedIdentity
  ) ? "ready" : "connecting";
}

export function SupportChatOpenButton() {
  const authenticated = useSupportChatSessionAuthenticated();
  const [state, setState] = useState<ChatwootActionState>(
    authenticated ? "connecting" : "signed-out",
  );

  useEffect(() => {
    const refresh = () => setState(chatwootActionState(authenticated));
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
  }, [authenticated]);

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
        if (chatwootActionState(authenticated) === "ready") {
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
