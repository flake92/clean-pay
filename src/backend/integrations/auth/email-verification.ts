import {
  EmailVerificationError,
  type EmailVerificationCommands,
} from "@/application/auth/ports/email-verification";
import { confirmEmailVerification, requestEmailVerification } from "@/backend/integrations/auth/email-verification-service";
import { getCurrentAuthProfile } from "@/backend/auth/profile";
import { ServiceError } from "@/backend/errors/service-error";

async function adapt<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new EmailVerificationError(error instanceof ServiceError ? error.code : "INTERNAL_ERROR");
  }
}

export const productionEmailVerificationCommands: EmailVerificationCommands = {
  async requestCode(input) {
    const result = await adapt(() => requestEmailVerification(input, { token: input.turnstileToken ?? null }));
    return { targetEmail: result.target_email };
  },
  async confirmCode(input) {
    const result = await adapt(() => confirmEmailVerification(
      { ...(input.email ? { email: input.email } : {}), code: input.code, ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {}) },
      { token: input.turnstileToken ?? null },
    ));
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
