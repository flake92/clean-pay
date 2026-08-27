"use client";

import { useEffect } from "react";

import { loadChatwootSupportContextAction } from "@/app/actions/chatwoot";
import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import { useChatwootWidgetController } from "@/frontend/components/chatwoot-widget-controller";
import {
  enterChatwootGuestMode,
  loadChatwootSupportContextCached,
} from "@/frontend/lib/chatwoot";

function loadSupportContext(config: ChatwootWidgetConfig) {
  return loadChatwootSupportContextCached(
    config.user.identifier,
    () => loadChatwootSupportContextAction(config.user.identifier),
  );
}

export function ChatwootWidget({ config }: { config: ChatwootWidgetConfig }) {
  useChatwootWidgetController(config, loadSupportContext);

  return null;
}

export function ChatwootGuestBoundary() {
  useEffect(() => {
    enterChatwootGuestMode();
  }, []);

  return null;
}
