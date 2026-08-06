import { loginWithEmail } from "@/backend/auth/email-login";
import { registerWithEmail } from "@/backend/auth/email-register";
import { confirmPasswordReset, requestPasswordReset } from "@/backend/auth/password-reset";
import type { AuthCommands } from "@/backend/application/auth/ports/auth-commands";
import { prisma } from "@/backend/database/prisma";
import { remnashopIdentifyEmail } from "@/backend/integrations/remnashop/client";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { verifyTurnstileToken } from "@/backend/security/turnstile";

export const productionAuthCommands: AuthCommands = {
  async identify(input) {
    await verifyTurnstileToken(input.turnstileToken ?? null, "auth_login");
    await assertRateLimit({ action: "auth_identify", email: input.email, limit: 20, windowSeconds: 15 * 60 });
    const [upstream, user] = await Promise.all([
      remnashopIdentifyEmail({ email: input.email }),
      prisma.webUser.findUnique({
        where: { email: input.email },
        select: { webAuthnCredentials: { select: { id: true }, take: 1 } },
      }),
    ]);
    return { exists: upstream.exists, hasPasskey: Boolean(user?.webAuthnCredentials.length) };
  },
  async login(input) {
    await loginWithEmail(input, { token: input.turnstileToken ?? null });
  },
  async register(input) {
    const result = await registerWithEmail(input, { token: input.turnstileToken ?? null });
    return {
      emailVerified: result.user.is_email_verified === true,
      verificationRequired: result.user.is_email_verified !== true && Boolean(result.emailVerification),
    };
  },
  async requestPasswordReset(input) {
    await requestPasswordReset({ email: input.email }, input.turnstileToken ?? null);
  },
  async confirmPasswordReset(input) {
    await confirmPasswordReset(
      { email: input.email, code: input.code, new_password: input.newPassword },
      input.turnstileToken ?? null,
    );
  },
};
