export type AuthProfileSession = {
  context: unknown;
  id: string;
  userId: string;
  authMethod: "EMAIL" | "TELEGRAM" | "PASSKEY";
  hasUpstreamTokens: boolean;
  user: {
    email: string | null;
    emailVerified: boolean;
    telegramId: string | null;
    telegramUsername: string | null;
    fullName: string | null;
    displayName: string | null;
    upstreamUserId: string | null;
    pendingUpstreamUserId: string | null;
    pendingEmail: string | null;
    accountSyncPending: boolean;
  };
};

export type AuthorizedAuthProfile = {
  context: unknown;
  session: AuthProfileSession;
  upstreamUserId: string;
};

export type ProviderAuthProfile = {
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  name: string;
  telegramId: string | null;
};

export interface AuthProfileGateway {
  loadCurrentSession(): Promise<AuthProfileSession | null>;
  authorizeCurrentSession(): Promise<AuthorizedAuthProfile>;
  loadProviderProfile(authorized: AuthorizedAuthProfile): Promise<ProviderAuthProfile>;
  confirmVerifiedEmail(userId: string): Promise<void>;
  refreshCurrentAccess(): Promise<void>;
  debug(event: string, data: Record<string, unknown>): void;
}

export class AuthProfileError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
