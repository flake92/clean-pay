export type ChatwootUserInput = {
  name: string;
  email?: string;
  identifier_hash: string;
  custom_attributes: Record<string, string>;
};

export type ChatwootApi = {
  baseUrl: string;
  websiteToken: string;
  hasLoaded: boolean;
  identifier?: string | number;
  user?: ChatwootUserInput;
  resetTriggered?: boolean;
  setUser(identifier: string, user: ChatwootUserInput): void;
  setLabel?(label: string): void;
  removeLabel?(label: string): void;
  toggleBubbleVisibility(visibility: "hide" | "show"): void;
  reset(): void;
};

export type ChatwootIdentityState = {
  core: string;
  customAttributes: string;
};

export type ChatwootOwnershipState = ChatwootIdentityState & {
  conversation: string;
};

export type StoredChatwootOwnershipState = ChatwootIdentityState & {
  conversation: string;
};

export type ChatwootPendingIdentityState = ChatwootIdentityState & {
  attemptId: string;
  startedAt: number;
  retryCount: number;
  phase: "sent" | "waiting_for_frame" | "ownership_confirmed";
};

export type ChatwootIdentificationStatus =
  | "unavailable"
  | "pending"
  | "failed"
  | "ready";

declare global {
  interface Window {
    $chatwoot?: ChatwootApi;
    chatwootSDK?: {
      run(config: { baseUrl: string; websiteToken: string }): void;
    };
    chatwootSettings?: Record<string, unknown>;
    cleanPayChatwootAuthorized?: boolean;
    cleanPayChatwootIdentity?: ChatwootIdentityState;
    cleanPayChatwootOwnership?: ChatwootOwnershipState;
    cleanPayChatwootPendingIdentity?: ChatwootPendingIdentityState;
    cleanPayChatwootFailedIdentity?: ChatwootIdentityState;
  }
}
