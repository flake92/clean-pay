import { remnashopAuth, remnashopLinkTelegram } from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { linkCurrentUserToRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import type { LoginRequest } from "@/shared/remnashop/types";
import { requestRemnashopEmailVerification } from "@/backend/auth/email-verification";
import { getCurrentSession } from "@/backend/sessions/web-session";

function isTelegramAlreadyLinkedConflict(error: unknown) {
  return error instanceof BffError && error.code === "CONFLICT";
}

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

  const session = await getCurrentSession();

  if (session?.user.telegramId) {
    try {
      await remnashopLinkTelegram({
        accessToken: auth.cookies.accessToken,
        telegramId: session.user.telegramId,
        telegramUsername: session.user.telegramUsername,
      });
      authDebugLog("remnashop_account_link_telegram_attached", {
        telegramId: session.user.telegramId,
        hasTelegramUsername: Boolean(session.user.telegramUsername),
      });
    } catch (error) {
      if (!isTelegramAlreadyLinkedConflict(error)) {
        throw error;
      }

      authDebugLog("remnashop_account_link_telegram_conflict_ignored", {
        telegramId: session.user.telegramId,
        hasTelegramUsername: Boolean(session.user.telegramUsername),
      });
    }
  }

  const { user, profile } = await linkCurrentUserToRemnashopAuth({
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    auth: auth.data,
  });
  const verification = profile.is_email_verified
    ? null
    : await requestRemnashopEmailVerification({
        accessToken: auth.cookies.accessToken,
        body: { email: body.email },
        source: "link_remnashop",
      });

  if (verification) {
    authDebugLog("remnashop_account_link_verification_requested", {
      userId: user.id,
      targetEmail: verification.target_email,
      expiresAt: verification.expires_at,
    });
  } else {
    authDebugLog("remnashop_account_link_verification_skipped", {
      userId: user.id,
      reason: "email_already_verified",
    });
  }

  await auditLog({
    action: "remnashop_account_linked",
    userId: user.id,
    metadata: { email: profile.email, telegramId: profile.telegram_id, verificationTargetEmail: verification?.target_email },
  });

  return {
    user: profile,
    ...(verification ? { emailVerification: verification } : {}),
    linked: true,
  };
}
