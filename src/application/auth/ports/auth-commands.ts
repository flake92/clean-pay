export interface AuthCommands {
  identify(input: { email: string; turnstileToken?: string }): Promise<{ exists: boolean; hasPasskey: boolean }>;
  login(input: { email: string; password: string; turnstileToken?: string }): Promise<void>;
  register(input: { email: string; password: string; turnstileToken?: string }): Promise<{ emailVerified: boolean; verificationRequired: boolean }>;
  requestPasswordReset(input: { email: string; turnstileToken?: string }): Promise<void>;
  confirmPasswordReset(input: { email: string; code: string; newPassword: string; turnstileToken?: string }): Promise<void>;
}
