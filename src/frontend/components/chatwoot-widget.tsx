"use client";

import { useEffect } from "react";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import {
  clearChatwootIdentityState,
  enterChatwootAuthenticatedMode,
  enterChatwootGuestMode,
  identifyChatwootUser,
  loadChatwootSdk,
} from "@/frontend/lib/chatwoot";

export function ChatwootWidget({ config }: { config: ChatwootWidgetConfig }) {
  useEffect(() => {
    let active = true;

    enterChatwootAuthenticatedMode();
    window.chatwootSettings = {
      ...(window.chatwootSettings ?? {}),
      locale: "ru",
      position: "right",
      useBrowserLanguage: false,
      hideMessageBubble: true,
    };

    const identify = () => {
      if (active) {
        try {
          identifyChatwootUser(config);
        } catch {
          clearChatwootIdentityState();
          try {
            window.$chatwoot?.toggleBubbleVisibility("hide");
          } catch {
            // Keep support failures isolated from the application shell.
          }
        }
      }
    };
    const identificationFailed = () => {
      clearChatwootIdentityState();
      try {
        window.$chatwoot?.toggleBubbleVisibility("hide");
      } catch {
        // Keep support failures isolated from the application shell.
      }
    };

    window.addEventListener("chatwoot:ready", identify);
    window.addEventListener("chatwoot:error", identificationFailed);

    void loadChatwootSdk(config.baseUrl).then(() => {
      if (!active || !window.cleanPayChatwootAuthorized) {
        return;
      }

      if (!window.$chatwoot) {
        window.chatwootSDK?.run({
          baseUrl: config.baseUrl,
          websiteToken: config.websiteToken,
        });
        return;
      }

      if (
        window.$chatwoot.baseUrl !== config.baseUrl ||
        window.$chatwoot.websiteToken !== config.websiteToken
      ) {
        // A running SDK cannot switch inboxes safely without reloading the
        // document. Hide a stale deployment instead of mixing conversations.
        enterChatwootGuestMode();
        return;
      }

      if (window.$chatwoot.hasLoaded) {
        identify();
      }
    }).catch(() => {
      if (active) {
        clearChatwootIdentityState();
      }
    });

    return () => {
      active = false;
      window.removeEventListener("chatwoot:ready", identify);
      window.removeEventListener("chatwoot:error", identificationFailed);
      // AppShell is a page-level wrapper. Do not reset here: ordinary client
      // navigation between authenticated pages may unmount this component.
    };
  }, [config]);

  return null;
}

export function ChatwootGuestBoundary() {
  useEffect(() => {
    enterChatwootGuestMode();
  }, []);

  return null;
}
