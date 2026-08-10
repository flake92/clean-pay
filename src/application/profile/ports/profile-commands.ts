export interface ProfileCommands {
  loadPasswordSession(): Promise<{ context: unknown; userId: string }>;
  assertPasswordChangeRateLimit(session: { context: unknown }): Promise<void>;
  changeProviderPassword(session: { context: unknown }, input: { currentPassword: string; newPassword: string }): Promise<{ context: unknown }>;
  refreshProviderSession(session: { context: unknown }): Promise<{ context: unknown }>;
  persistRefreshedProviderSession(session: { context: unknown }, refreshed: { context: unknown }): Promise<void>;
  replaceLocalPasswordSession(session: { context: unknown }, changed: { context: unknown }): Promise<void>;
  auditPasswordChanged(userId: string): Promise<void>;
}

export class ProfileGatewayError extends Error {
  constructor(public readonly code: string) { super(code); }
}
