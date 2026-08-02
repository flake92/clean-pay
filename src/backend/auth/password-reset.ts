import { createSessionFromRemnashopAuth } from "@/backend/integrations/remnashop/session";
import {
  remnashopAuth,
  remnashopRequestPasswordReset,
} from "@/backend/integrations/remnashop/client";
import { assertRateLimit, withAuthConcurrency } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { verifyTurnstileToken } from "@/backend/security/turnstile";
import type {
  ConfirmPasswordResetRequest,
  RequestPasswordResetRequest,
} from "@/shared/remnashop/types";

export async function requestPasswordReset(
  body: RequestPasswordResetRequest,
  turnstileToken: string | null,
) {
  await verifyTurnstileToken(turnstileToken, "password_reset_start");
  await assertRateLimit({
    action: "password_reset_start",
    email: body.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  await withAuthConcurrency("password_reset_start", () =>
    remnashopRequestPasswordReset(body),
  );

  // Keep the response indistinguishable for existing and unknown accounts.
  return { success: true };
}

export async function confirmPasswordReset(
  body: ConfirmPasswordResetRequest,
  turnstileToken: string | null,
) {
  await verifyTurnstileToken(turnstileToken, "password_reset_confirm");
  await assertRateLimit({
    action: "password_reset_confirm",
    email: body.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  const auth = await withAuthConcurrency("password_reset_confirm", () =>
    remnashopAuth("/auth/password/confirm-reset", body),
  );
  const { user, profile } = await createSessionFromRemnashopAuth({
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    auth: auth.data,
  });
  await auditLog({ action: "password_reset_success", userId: user.id });

  return {
    user: profile,
    expiresAt: auth.data.expires_at,
    refreshExpiresAt: auth.data.refresh_expires_at,
  };
}
