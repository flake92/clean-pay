import type { EmailVerificationCommands } from "@/backend/application/auth/ports/email-verification";
import { confirmEmailVerification, requestEmailVerification } from "@/backend/auth/email-verification";
import { getCurrentAuthProfile } from "@/backend/auth/profile";
import { ServiceError } from "@/backend/errors/service-error";

export const productionEmailVerificationCommands: EmailVerificationCommands = {
  async requestCode(input) {
    const result = await requestEmailVerification(input, { token: input.turnstileToken ?? null });
    return { targetEmail: result.target_email };
  },
  async confirmCode(input) {
    const result = await confirmEmailVerification(
      { ...(input.email ? { email: input.email } : {}), code: input.code, ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {}) },
      { token: input.turnstileToken ?? null },
    );
    return { accountSyncPending: Boolean(result.account_sync_pending) };
  },
  async checkReadiness() {
    try {
      const { user } = await getCurrentAuthProfile();
      const emailVerified = Boolean(user.email && (user.emailVerified ?? user.is_email_verified));
      const pending = Boolean(user.accountSyncPending ?? user.account_sync_pending);
      return emailVerified && !pending ? { status: "ready" } : { status: "pending", emailVerified };
    } catch (error) {
      if (error instanceof ServiceError) {
        if (error.code === "ACCOUNT_MERGE_REQUIRED" || error.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT") return { status: "merge-conflict" };
        if (error.code === "UNAUTHORIZED") return { status: "unauthorized" };
      }
      return { status: "unavailable" };
    }
  },
};
