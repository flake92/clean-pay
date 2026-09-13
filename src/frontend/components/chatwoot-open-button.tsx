"use client";

import { useEffect, useState } from "react";

type ChatwootActionState = "signed-out" | "connecting" | "failed" | "ready";

function chatwootActionState(): ChatwootActionState {
  if (typeof window === "undefined" || !window.cleanPayChatwootAuthorized) {
    return "signed-out";
  }

  if (window.cleanPayChatwootFailedIdentity) return "failed";

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

export function ChatwootOpenButton() {
  const [state, setState] = useState<ChatwootActionState>("signed-out");

  useEffect(() => {
    const refresh = () => setState(chatwootActionState());
    refresh();

    const timer = window.setInterval(refresh, 500);
    window.addEventListener("chatwoot:ready", refresh);
    window.addEventListener("chatwoot:error", refresh);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("chatwoot:ready", refresh);
      window.removeEventListener("chatwoot:error", refresh);
    };
  }, []);

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
        if (chatwootActionState() === "ready") window.$chatwoot?.toggle?.("open");
      }}
      type="button"
    >
      <span className="p-button-icon p-c pi pi-comments" />
      <span className="p-button-label">Открыть чат поддержки</span>
    </button>
  );
}
