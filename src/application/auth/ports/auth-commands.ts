export type AuthProviderSession = { context: unknown };

export class AuthGatewayError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface AuthCommands {
  preflightCapacity(action: string): Promise<void>;
  withUpstreamConcurrency<T>(action: string, work: () => Promise<T>): Promise<T>;
  verifyHuman(token: string | null, action: "auth_login"): Promise<void>;
  rateLimit(input: {
    action: "auth_identify" | "auth_login" | "auth_register" | "password_reset_start" | "password_reset_confirm";
    email: string;
    limit: number;
    windowSeconds: number;
  }): Promise<void>;
  identifyEmail(email: string): Promise<{ exists: boolean }>;
  hasPasskey(email: string): Promise<boolean>;
  authenticate(input: {
    operation: "login" | "register" | "confirm-password-reset";
    email: string;
    password?: string;
    code?: string;
  }): Promise<AuthProviderSession>;
  establishSession(
    providerSession: AuthProviderSession,
    options?: { replaceExistingSessions?: boolean; replacementIdentityEmail?: string },
  ): Promise<{ userId: string; emailVerified: boolean }>;
  requestEmailVerification(providerSession: AuthProviderSession, email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  audit(input: { action: string; userId: string; metadata?: Record<string, unknown> }): Promise<void>;
}
