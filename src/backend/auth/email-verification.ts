import { prisma } from "@/backend/database/prisma";
import {
  createRemnashopTelegramAuthForSession,
  getAuthorizedRemnashopTokens,
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  remnashopLinkTelegram,
  remnashopRequest,
} from "@/backend/integrations/remnashop/client";
import { mergeVerifiedEmailRemnashopUserIntoTelegramUser } from "@/backend/integrations/remnashop/admin-merge";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { linkCurrentUserToRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { assertCooldown, assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { verifyTurnstileToken } from "@/backend/security/turnstile";
import { refreshCurrentAccessCookie } from "@/backend/sessions/web-session";
import type {
  ChangeEmailRequest,
  ChangeEmailResponse,
  ConfirmEmailVerificationRequest,
  ConfirmEmailVerificationResponse,
  RequestEmailVerificationRequest,
  RequestEmailVerificationResponse,
} from "@/shared/remnashop/types";
import type { AuthPayload, TurnstileContext } from "@/backend/auth/payload";
import { stripTurnstile } from "@/backend/auth/payload";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientEmailSendError(error: unknown) {
  return (
    error instanceof BffError &&
    error.code === "UPSTREAM_UNAVAILABLE" &&
    String(error.debug?.message ?? error.message).toLowerCase().includes("failed to send verification email")
  );
}

function isTelegramAlreadyLinkedConflict(error: unknown) {
  return error instanceof BffError && error.code === "CONFLICT";
}

export async function requestRemnashopEmailVerification({
  accessToken,
  body,
  source,
}: {
  accessToken: string;
  body: RequestEmailVerificationRequest;
  source: string;
}) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await remnashopRequest<RequestEmailVerificationResponse>(
        "/auth/email/request-verification",
        {
          method: "POST",
          accessToken,
          body,
        },
      );
    } catch (error) {
      if (!isTransientEmailSendError(error) || attempt === maxAttempts) {
        throw error;
      }

      authDebugLog("email_verification_request_retry_scheduled", {
        source,
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
      });
      await sleep(300 * attempt);
    }
  }

  throw new BffError("UPSTREAM_UNAVAILABLE", 502, "Failed to send verification email");
}

export async function requestEmailVerification(rawBody: AuthPayload<RequestEmailVerificationRequest>, turnstile: TurnstileContext) {
  const { body, turnstileToken } = stripTurnstile(rawBody);

  authDebugLog("email_verification_request_started", {
    hasEmail: Boolean(body.email),
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
  });

  const { accessToken, session } = await getAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
  });
  authDebugLog("email_verification_request_session_authorized", {
    sessionId: session.id,
    userId: session.userId,
    allowUnverifiedEmail: true,
  });
  const key = `email-verification:${session.userId}`;

  await assertCooldown({
    key,
    action: "email_verification_request",
    windowSeconds: 60,
  });
  await assertRateLimit({
    action: "email_verification_request",
    email: body.email ?? session.user.email,
    tgId: session.user.telegramId,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  authDebugLog("email_verification_request_rate_limit_passed", {
    sessionId: session.id,
    userId: session.userId,
  });

  const result = await requestRemnashopEmailVerification({
    accessToken,
    body,
    source: "resend",
  });
  authDebugLog("email_verification_request_success", {
    sessionId: session.id,
    userId: session.userId,
    targetEmail: result.target_email,
    expiresAt: result.expires_at,
  });

  await auditLog({
    action: "email_verification_requested",
    userId: session.userId,
    metadata: { targetEmail: result.target_email },
  });

  return result;
}

export async function confirmEmailVerification(rawBody: AuthPayload<ConfirmEmailVerificationRequest>, turnstile: TurnstileContext) {
  const { body, turnstileToken } = stripTurnstile(rawBody);
  const skipTurnstile = body.registrationFlow === true;
  delete body.registrationFlow;

  authDebugLog("email_verification_confirm_started", {
    hasEmail: Boolean(body.email),
    skipTurnstile,
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
  });
  if (!skipTurnstile) {
    await verifyTurnstileToken(turnstileToken ?? turnstile.token, turnstile.remoteIp);
    authDebugLog("email_verification_confirm_turnstile_passed", {});
  }

  const tokens = await getAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
  });
  let { accessToken, refreshToken, session } = tokens;
  const profile = await getRemnashopMe(accessToken);
  const targetEmail = body.email ?? profile.pending_email ?? profile.email ?? session.user.email ?? undefined;
  const confirmBody = targetEmail ? { ...body, email: targetEmail } : body;
  authDebugLog("email_verification_confirm_target_resolved", {
    sessionId: session.id,
    userId: session.userId,
    hasTargetEmail: Boolean(targetEmail),
    sourceHasPendingEmail: Boolean(profile.pending_email),
  });

  await assertRateLimit({
    action: "email_verification_confirm",
    email: targetEmail,
    tgId: session.user.telegramId,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  authDebugLog("email_verification_confirm_rate_limit_passed", {
    sessionId: session.id,
    userId: session.userId,
  });

  const result = await remnashopRequest<ConfirmEmailVerificationResponse>(
    "/auth/email/confirm",
    {
      method: "POST",
      accessToken,
      body: confirmBody,
    },
  );
  authDebugLog("email_verification_confirm_remnashop_success", {
    sessionId: session.id,
    userId: session.userId,
    email: result.email,
  });

  if (session.user.telegramId) {
    try {
      await remnashopLinkTelegram({
        accessToken,
        telegramId: session.user.telegramId,
        telegramUsername: session.user.telegramUsername,
      });
      authDebugLog("email_verification_confirm_telegram_attached", {
        sessionId: session.id,
        userId: session.userId,
        telegramId: session.user.telegramId,
      });
    } catch (error) {
      if (!isTelegramAlreadyLinkedConflict(error)) {
        throw error;
      }

      authDebugLog("email_verification_confirm_telegram_conflict_ignored", {
        sessionId: session.id,
        userId: session.userId,
        telegramId: session.user.telegramId,
      });

      await mergeVerifiedEmailRemnashopUserIntoTelegramUser({
        emailRemnashopUserId: getRemnashopUserIdFromAccessToken(accessToken),
        telegramId: session.user.telegramId,
      });

      const telegramAuth = await createRemnashopTelegramAuthForSession(session);

      if (!telegramAuth) {
        throw new BffError("INTERNAL_ERROR", 500, "Unable to restore Remnashop Telegram session after merge.");
      }

      accessToken = telegramAuth.cookies.accessToken;
      refreshToken = telegramAuth.cookies.refreshToken;
      session = {
        ...session,
        remnashopAccessExpiresAt: new Date(telegramAuth.data.expires_at),
        remnashopRefreshExpiresAt: new Date(telegramAuth.data.refresh_expires_at),
      };
      authDebugLog("email_verification_confirm_telegram_conflict_merge_completed", {
        sessionId: session.id,
        userId: session.userId,
        telegramId: session.user.telegramId,
      });
    }
  }

  await linkCurrentUserToRemnashopAuth({
    accessToken,
    refreshToken,
    auth: {
      expires_at: session.remnashopAccessExpiresAt?.toISOString() ?? new Date(Date.now() + 60_000).toISOString(),
      refresh_expires_at: session.remnashopRefreshExpiresAt?.toISOString() ?? new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  await prisma.webUser.update({
    where: { id: session.userId },
    data: {
      email: result.email,
      emailVerified: true,
      authPending: false,
    },
  });
  await refreshCurrentAccessCookie();
  authDebugLog("email_verification_confirm_local_user_updated", {
    sessionId: session.id,
    userId: session.userId,
    emailVerified: true,
  });

  await auditLog({
    action: "email_verified",
    userId: session.userId,
    metadata: { email: result.email },
  });

  return result;
}

export async function changeEmail(rawBody: AuthPayload<ChangeEmailRequest>, turnstile: TurnstileContext) {
  const { body, turnstileToken } = stripTurnstile(rawBody);
  authDebugLog("email_change_started", {
    hasEmail: Boolean(body.email),
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
  });
  const { accessToken, session } = await getAuthorizedRemnashopTokens();
  authDebugLog("email_change_session_authorized", {
    sessionId: session.id,
    userId: session.userId,
  });

  await assertCooldown({
    key: `email-change:${session.userId}`,
    action: "email_change_request",
    windowSeconds: 60,
  });
  await assertRateLimit({
    action: "email_change_request",
    email: body.email,
    tgId: session.user.telegramId,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  authDebugLog("email_change_rate_limit_passed", {
    sessionId: session.id,
    userId: session.userId,
  });

  const result = await remnashopRequest<ChangeEmailResponse>(
    "/auth/email/change",
    {
      method: "POST",
      accessToken,
      body,
    },
  );
  authDebugLog("email_change_remnashop_success", {
    sessionId: session.id,
    userId: session.userId,
    pendingEmail: result.pending_email,
  });
  const verification = await requestRemnashopEmailVerification({
    accessToken,
    body: { email: result.pending_email },
    source: "change_email",
  });
  authDebugLog("email_change_verification_requested", {
    sessionId: session.id,
    userId: session.userId,
    targetEmail: verification.target_email,
    expiresAt: verification.expires_at,
  });

  await prisma.webUser.update({
    where: { id: session.userId },
    data: { emailVerified: false },
  });

  await auditLog({
    action: "email_change_requested",
    userId: session.userId,
    metadata: { pendingEmail: result.pending_email, verificationTargetEmail: verification.target_email },
  });

  return { ...result, emailVerification: verification };
}
