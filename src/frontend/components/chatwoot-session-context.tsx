"use client";

import { createContext, useContext, type ReactNode } from "react";

const SupportChatSessionContext = createContext(false);

export function SupportChatSessionBoundary({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children?: ReactNode;
}) {
  return (
    <SupportChatSessionContext.Provider value={authenticated}>
      {children}
    </SupportChatSessionContext.Provider>
  );
}

export function useSupportChatSessionAuthenticated() {
  return useContext(SupportChatSessionContext);
}
