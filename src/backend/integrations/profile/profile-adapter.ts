import { changeEmail, requestEmailVerification } from "@/backend/auth/email-verification";
import { changePassword } from "@/backend/auth/password";
import { getCurrentAuthProfile } from "@/backend/auth/profile";
import type { ProfileCommands } from "@/backend/application/profile/ports/profile-commands";
import type { ProfileReader } from "@/backend/application/profile/ports/profile-reader";

export const productionProfileReader: ProfileReader = {
  async loadCurrent() {
    const { user } = await getCurrentAuthProfile();
    return {
      authType: user.auth_type,
      email: user.email ?? null,
      emailVerified: Boolean(user.emailVerified ?? user.is_email_verified),
      pendingEmail: "pending_email" in user ? user.pending_email ?? null : null,
      telegramId: user.telegramId ?? user.telegram_id?.toString() ?? null,
    };
  },
};

export const productionProfileCommands: ProfileCommands = {
  async requestEmailVerification(input) {
    const result = await requestEmailVerification(
      { ...(input.email ? { email: input.email } : {}), ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {}) },
      { token: input.turnstileToken ?? null },
    );
    return { targetEmail: result.target_email };
  },
  async changeEmail(input) {
    const result = await changeEmail(
      { email: input.email, ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {}) },
      { token: input.turnstileToken ?? null },
    );
    return { targetEmail: result.emailVerification.target_email };
  },
  async changePassword(input) {
    await changePassword({ current_password: input.currentPassword, new_password: input.newPassword });
  },
};
