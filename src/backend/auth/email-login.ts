import { createSessionFromRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { remnashopAuth } from "@/backend/integrations/remnashop/client";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { verifyTurnstileToken } from "@/backend/security/turnstile";
import type { LoginRequest } from "@/shared/remnashop/types";
import type { AuthPayload, TurnstileContext } from "@/backend/auth/payload";
import { stripTurnstile } from "@/backend/auth/payload";

export async function loginWithEmail(rawBody: AuthPayload<LoginRequest>, turnstile: TurnstileContext) {
  const { body, turnstileToken } = stripTurnstile(rawBody);

  authDebugLog("auth_login_started", {
    hasEmail: Boolean(body.email),
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
    hasRemoteIp: Boolean(turnstile.remoteIp),
  });
  await verifyTurnstileToken(turnstileToken ?? turnstile.token, turnstile.remoteIp);
  authDebugLog("auth_login_turnstile_passed", { hasRemoteIp: Boolean(turnstile.remoteIp) });
  await assertRateLimit({
    action: "auth_login",
    email: body.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  authDebugLog("auth_login_rate_limit_passed", { action: "auth_login" });

  const auth = await remnashopAuth("/auth/login", body);
  authDebugLog("auth_login_remnashop_success", {
    accessExpiresAt: auth.data.expires_at,
    refreshExpiresAt: auth.data.refresh_expires_at,
  });
  const { user, profile } = await createSessionFromRemnashopAuth({
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    auth: auth.data,
  });

  await auditLog({
    action: "auth_login_success",
    userId: user.id,
  });

  authDebugLog("auth_login_success", {
    userId: user.id,
    hasEmail: Boolean(user.email),
    emailVerified: user.emailVerified,
    hasTelegramId: Boolean(user.telegramId),
    profileAuthType: profile.auth_type,
  });

  return {
    user: profile,
    expiresAt: auth.data.expires_at,
    refreshExpiresAt: auth.data.refresh_expires_at,
  };
}
