"use client";

import { useEffect, useState } from "react";

function canOpenChatwoot() {
  if (typeof window === "undefined") return false;

  return Boolean(
    window.cleanPayChatwootAuthorized
    && window.$chatwoot?.hasLoaded
    && window.$chatwoot.toggle
    && !window.cleanPayChatwootPendingIdentity
    && !window.cleanPayChatwootFailedIdentity
    && (window.cleanPayChatwootIdentity || window.cleanPayChatwootOwnership),
  );
}

export function ChatwootOpenButton() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const refresh = () => setAvailable(canOpenChatwoot());
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

  if (!available) return null;

  return (
    <button
      className="p-button p-component p-button-outlined"
      onClick={() => {
        if (canOpenChatwoot()) window.$chatwoot?.toggle?.("open");
      }}
      type="button"
    >
      <span className="p-button-icon p-c pi pi-comments" />
      <span className="p-button-label">Открыть чат поддержки</span>
    </button>
  );
}
