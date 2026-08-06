import type { AccountReadiness } from "@/shared/presentation/email-verification";

export interface EmailVerificationCommands {
  requestCode(input: { email?: string; turnstileToken?: string }): Promise<{ targetEmail: string }>;
  confirmCode(input: { email?: string; code: string; turnstileToken?: string }): Promise<{ accountSyncPending: boolean }>;
  checkReadiness(): Promise<AccountReadiness>;
}
