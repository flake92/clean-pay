import { createSessionFromRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { remnashopAuth } from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { verifyTurnstileToken } from "@/backend/security/turnstile";
import type { RegisterRequest } from "@/shared/remnashop/types";
import type { AuthPayload, TurnstileContext } from "@/backend/auth/payload";
import { stripTurnstile } from "@/backend/auth/payload";
import { requestRemnashopEmailVerification } from "@/backend/auth/email-verification";

function isEmailAlreadyExistsConflict(error: unknown) {
  return (
    error instanceof BffError &&
    error.code === "CONFLICT" &&
    String(error.debug?.message ?? error.message).toLowerCase().includes("email already exists")
  );
}

async function createOrResumeEmailRegistration(body: RegisterRequest) {
  try {
    const auth = await remnashopAuth("/auth/register", body);
    authDebugLog("auth_register_remnashop_success", {
      flow: "created",
      accessExpiresAt: auth.data.expires_at,
      refreshExpiresAt: auth.data.refresh_expires_at,
    });

    return { auth, flow: "created" as const };
  } catch (error) {
    if (!isEmailAlreadyExistsConflict(error)) {
      throw error;
    }

    authDebugLog("auth_register_existing_email_detected", {
      hasEmail: Boolean(body.email),
      action: "login_existing_email",
    });
    const auth = await remnashopAuth("/auth/login", {
      email: body.email,
      password: body.password,
    });
    authDebugLog("auth_register_remnashop_success", {
      flow: "existing_email_login",
      accessExpiresAt: auth.data.expires_at,
      refreshExpiresAt: auth.data.refresh_expires_at,
    });

    return { auth, flow: "existing_email_login" as const };
  }
}

export async function registerWithEmail(rawBody: AuthPayload<RegisterRequest>, turnstile: TurnstileContext) {
  const { body, turnstileToken } = stripTurnstile(rawBody);

  authDebugLog("auth_register_started", {
    hasEmail: Boolean(body.email),
    hasName: Boolean(body.name),
    hasReferralCode: Boolean(body.referral_code),
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
    hasRemoteIp: Boolean(turnstile.remoteIp),
  });
  await verifyTurnstileToken(turnstileToken ?? turnstile.token, turnstile.remoteIp);
  authDebugLog("auth_register_turnstile_passed", { hasRemoteIp: Boolean(turnstile.remoteIp) });
  await assertRateLimit({
    action: "auth_register",
    email: body.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  authDebugLog("auth_register_rate_limit_passed", { action: "auth_register" });

  const { auth, flow } = await createOrResumeEmailRegistration(body);
  const verification = await requestRemnashopEmailVerification({
    accessToken: auth.cookies.accessToken,
    body: { email: body.email },
    source: "register",
  });
  const { user, profile } = await createSessionFromRemnashopAuth({
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    auth: auth.data,
  });
  authDebugLog("auth_register_verification_requested", {
    flow,
    userId: user.id,
    targetEmail: verification.target_email,
    expiresAt: verification.expires_at,
  });

  await auditLog({
    action: "auth_register_success",
    userId: user.id,
    metadata: { email: user.email, telegramId: user.telegramId, verificationTargetEmail: verification.target_email, flow },
  });

  authDebugLog("auth_register_success", {
    flow,
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
    emailVerification: verification,
  };
}
