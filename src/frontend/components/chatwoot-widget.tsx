"use client";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import {
  useChatwootGuestBoundaryController,
  useChatwootWidgetController,
} from "@/frontend/components/chatwoot-widget-controller";

export function SupportChatRuntime({ config }: { config: ChatwootWidgetConfig }) {
  useChatwootWidgetController(config);

  return null;
}

export function SupportChatGuestBoundary() {
  useChatwootGuestBoundaryController();

  return null;
}
