"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import { projectChatwootIdentity } from "@/frontend/lib/chatwoot-transitions";

type SupportChatSessionState = {
  authenticated: boolean;
  expectedIdentity: {
    baseUrl: string;
    core: string;
    websiteToken: string;
  } | null;
};

const SupportChatSessionContext = createContext<SupportChatSessionState>({
  authenticated: false,
  expectedIdentity: null,
});

export function SupportChatSessionBoundary({
  authenticated,
  chatwootConfig = null,
  children,
}: {
  authenticated: boolean;
  chatwootConfig?: ChatwootWidgetConfig | null;
  children?: ReactNode;
}) {
  const expectedIdentity = chatwootConfig
    ? {
        baseUrl: chatwootConfig.baseUrl,
        core: projectChatwootIdentity(chatwootConfig, {}).identity.core,
        websiteToken: chatwootConfig.websiteToken,
      }
    : null;

  return (
    <SupportChatSessionContext.Provider value={{
      authenticated,
      expectedIdentity,
    }}>
      {children}
    </SupportChatSessionContext.Provider>
  );
}

export function useSupportChatSessionAuthenticated() {
  return useContext(SupportChatSessionContext).authenticated;
}

export function useSupportChatExpectedIdentity() {
  return useContext(SupportChatSessionContext).expectedIdentity;
}
