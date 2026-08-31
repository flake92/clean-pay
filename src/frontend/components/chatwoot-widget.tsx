"use client";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import {
  useChatwootGuestBoundaryController,
  useChatwootWidgetController,
} from "@/frontend/components/chatwoot-widget-controller";

export function ChatwootWidget({ config }: { config: ChatwootWidgetConfig }) {
  useChatwootWidgetController(config);

  return null;
}

export function ChatwootGuestBoundary() {
  useChatwootGuestBoundaryController();

  return null;
}
