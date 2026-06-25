import { remnashopAuth } from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { linkCurrentUserToRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import type { LoginRequest } from "@/shared/remnashop/types";
import { requestRemnashopEmailVerification } from "@/backend/auth/email-verification";

export async function linkRemnashopAccount(body: LoginRequest) {
  authDebugLog("remnashop_account_link_started", { hasEmail: Boolean(body.email) });
  await assertRateLimit({
    action: "remnashop_link",
    email: body.email,
    limit: 10,
    windowSeconds: 15 * 60,
  });
  authDebugLog("remnashop_account_link_rate_limit_passed", {});

  let auth: Awaited<ReturnType<typeof remnashopAuth>>;

  try {
    auth = await remnashopAuth("/auth/login", body);
    authDebugLog("remnashop_account_link_login_success", {
      accessExpiresAt: auth.data.expires_at,
      refreshExpiresAt: auth.data.refresh_expires_at,
    });
  } catch (error) {
    if (!(error instanceof BffError) || error.code !== "AUTH_FAILED") {
      throw error;
    }

    auth = await remnashopAuth("/auth/register", body);
    authDebugLog("remnashop_account_link_register_fallback_success", {
      accessExpiresAt: auth.data.expires_at,
      refreshExpiresAt: auth.data.refresh_expires_at,
    });
  }

  const verification = await requestRemnashopEmailVerification({
    accessToken: auth.cookies.accessToken,
    body: { email: body.email },
    source: "link_remnashop",
  });
  const { user, profile } = await linkCurrentUserToRemnashopAuth({
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    auth: auth.data,
  });
  authDebugLog("remnashop_account_link_verification_requested", {
    userId: user.id,
    targetEmail: verification.target_email,
    expiresAt: verification.expires_at,
  });

  await auditLog({
    action: "remnashop_account_linked",
    userId: user.id,
    metadata: { email: profile.email, telegramId: profile.telegram_id, verificationTargetEmail: verification.target_email },
  });

  return {
    user: profile,
    emailVerification: verification,
    linked: true,
  };
}
