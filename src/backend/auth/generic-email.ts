import { createSessionFromRemnashopAuth } from "@/backend/integrations/remnashop/session";
import {
  remnashopAuth,
  remnashopStartGenericEmailAuth,
} from "@/backend/integrations/remnashop/client";
import { assertRateLimit, withAuthConcurrency } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { verifyTurnstileToken } from "@/backend/security/turnstile";
import type {
  CompleteGenericEmailAuthRequest,
  StartGenericEmailAuthRequest,
} from "@/shared/remnashop/types";

export async function startGenericEmailAuth(
  body: StartGenericEmailAuthRequest,
  turnstileToken: string | null,
) {
  await verifyTurnstileToken(turnstileToken, "auth_login");
  await assertRateLimit({
    action: "email_auth_start",
    email: body.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  await withAuthConcurrency("email_auth_start", () => remnashopStartGenericEmailAuth(body));
  return { success: true };
}

export async function completeGenericEmailAuth(
  body: CompleteGenericEmailAuthRequest,
  turnstileToken: string | null,
) {
  await verifyTurnstileToken(turnstileToken, "auth_login");
  await assertRateLimit({
    action: "email_auth_complete",
    email: body.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  const auth = await withAuthConcurrency(
    "email_auth_complete",
    () => remnashopAuth("/auth/email/complete", body),
  );
  const { user, profile } = await createSessionFromRemnashopAuth({
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    auth: auth.data,
  });
  await auditLog({ action: "auth_email_complete_success", userId: user.id });
  return {
    user: profile,
    expiresAt: auth.data.expires_at,
    refreshExpiresAt: auth.data.refresh_expires_at,
  };
}
