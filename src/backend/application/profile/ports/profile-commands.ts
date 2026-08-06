export type ProfileCommandFailure = Error & { code: string };

export interface ProfileCommands {
  requestEmailVerification(input: { email?: string; turnstileToken?: string }): Promise<{ targetEmail: string }>;
  changeEmail(input: { email: string; turnstileToken?: string }): Promise<{ targetEmail: string }>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
}
