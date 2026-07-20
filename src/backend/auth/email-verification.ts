import { prisma } from "@/backend/database/prisma";
import {
  getAuthorizedRemnashopTokens,
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  remnashopAuthTelegramIdentity,
  remnashopLinkTelegram,
  remnashopMergeUsers,
  remnashopRequest,
} from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { linkCurrentUserToRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { assertCooldown, assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { logger } from "@/backend/observability/logger";
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

function accountMergeRequiredError(message = "Telegram account is already attached to a different Remnashop account.") {
  return new BffError(
    "ACCOUNT_MERGE_REQUIRED",
    409,
    message,
    {
      message,
    },
  );
}

function mergeSubscriptionsConflictError() {
  return accountMergeRequiredError(
    "У обеих учетных записей есть активные подписки. Объединение нужно выполнить через поддержку.",
  );
}

function isBothSubscriptionsMergeConflict(error: unknown) {
  return (
    error instanceof BffError &&
    error.code === "CONFLICT" &&
    String(error.debug?.message ?? error.message).toLowerCase().includes("both users have current subscriptions")
  );
}

async function mergeEmailAccountIntoTelegramAccount({
  emailAccessToken,
  telegramId,
  telegramUsername,
  reason,
}: {
  emailAccessToken: string;
  telegramId: string | number;
  telegramUsername?: string | null;
  reason: string;
}) {
  const sourceUserId = getRemnashopUserIdFromAccessToken(emailAccessToken);
  const telegramAuth = await remnashopAuthTelegramIdentity({
    telegramId,
    telegramUsername,
  });
  const targetUserId = getRemnashopUserIdFromAccessToken(telegramAuth.cookies.accessToken);

  if (sourceUserId === targetUserId) {
    return {
      accessToken: telegramAuth.cookies.accessToken,
      refreshToken: telegramAuth.cookies.refreshToken,
      auth: telegramAuth.data,
      merged: false,
      sourceUserId,
      targetUserId,
    };
  }

  try {
    await remnashopMergeUsers({
      sourceUserId,
      targetUserId,
      reason,
    });
  } catch (error) {
    if (isBothSubscriptionsMergeConflict(error)) {
      throw mergeSubscriptionsConflictError();
    }

    throw error;
  }

  const mergedAuth = await remnashopAuthTelegramIdentity({
    telegramId,
    telegramUsername,
  });

  return {
    accessToken: mergedAuth.cookies.accessToken,
    refreshToken: mergedAuth.cookies.refreshToken,
    auth: mergedAuth.data,
    merged: true,
    sourceUserId,
    targetUserId,
  };
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
  await verifyTurnstileToken(turnstileToken ?? turnstile.token, turnstile.remoteIp);
  authDebugLog("email_verification_request_turnstile_passed", {});

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
  delete body.registrationFlow;

  authDebugLog("email_verification_confirm_started", {
    hasEmail: Boolean(body.email),
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
  });
  await verifyTurnstileToken(turnstileToken ?? turnstile.token, turnstile.remoteIp);
  authDebugLog("email_verification_confirm_turnstile_passed", {});

  const { accessToken, refreshToken, session } = await getAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
  });
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

  const alreadyVerified = Boolean(
    profile.email &&
    profile.is_email_verified &&
    (!targetEmail || profile.email.toLowerCase() === targetEmail.toLowerCase()),
  );
  const result = alreadyVerified
    ? {
        success: true,
        email: profile.email!,
        already_verified: true,
      }
    : await remnashopRequest<ConfirmEmailVerificationResponse>(
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
    alreadyVerified,
  });

  // Remnashop consumes the one-time code and commits verification before any
  // optional Telegram merge. Persist that irreversible success immediately so
  // a later synchronization error cannot leave Clean Pay reporting a false
  // failure or invite the user to submit an already-consumed code again.
  const confirmedRemnashopUserId =
    getRemnashopUserIdFromAccessToken(accessToken);
  const existingEmailOwner = await prisma.webUser.findUnique({
    where: { email: result.email },
  });
  const currentUserOwnsEmail =
    !existingEmailOwner || existingEmailOwner.id === session.userId;
  const localVerificationChanged =
    !currentUserOwnsEmail ||
    !session.user.emailVerified ||
    session.user.email !== result.email;

  await prisma.$transaction(async (tx) => {
    if (existingEmailOwner && existingEmailOwner.id !== session.userId) {
      await tx.webUser.update({
        where: { id: existingEmailOwner.id },
        data: { emailVerified: true },
      });
    }

    await tx.webUser.update({
      where: { id: session.userId },
      data: {
        ...(currentUserOwnsEmail
          ? { email: result.email, emailVerified: true }
          : {}),
        authPending: true,
        pendingRemnashopUserId: confirmedRemnashopUserId,
        pendingRemnashopEmail: result.email,
      },
    });
  });
  await refreshCurrentAccessCookie();
  authDebugLog("email_verification_confirm_local_user_updated", {
    sessionId: session.id,
    userId: session.userId,
    emailVerified: currentUserOwnsEmail,
    pendingRemnashopUserId: confirmedRemnashopUserId,
    existingEmailOwnerId: existingEmailOwner?.id,
    alreadyVerified,
  });

  if (localVerificationChanged) {
    await auditLog({
      action: "email_verified",
      userId: session.userId,
      metadata: { email: result.email },
    });
  }

  let authForLink = {
    accessToken,
    refreshToken,
    upstreamMerged: false,
    auth: {
      expires_at: session.remnashopAccessExpiresAt?.toISOString() ?? new Date(Date.now() + 60_000).toISOString(),
      refresh_expires_at: session.remnashopRefreshExpiresAt?.toISOString() ?? new Date(Date.now() + 86_400_000).toISOString(),
    },
  };

  let accountSyncPending = false;

  try {
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

        authDebugLog("email_verification_confirm_telegram_conflict_merge_started", {
          sessionId: session.id,
          userId: session.userId,
          telegramId: session.user.telegramId,
        });

        const mergedAuth = await mergeEmailAccountIntoTelegramAccount({
          emailAccessToken: accessToken,
          telegramId: session.user.telegramId,
          telegramUsername: session.user.telegramUsername,
          reason: "Clean Pay account link: verified e-mail code and Telegram ownership",
        });
        authForLink = {
          accessToken: mergedAuth.accessToken,
          refreshToken: mergedAuth.refreshToken,
          auth: mergedAuth.auth,
          upstreamMerged: mergedAuth.merged,
        };

        authDebugLog("email_verification_confirm_telegram_conflict_merge_completed", {
          sessionId: session.id,
          userId: session.userId,
          telegramId: session.user.telegramId,
          sourceRemnashopUserId: mergedAuth.sourceUserId,
          targetRemnashopUserId: mergedAuth.targetUserId,
        });
      }

      const sourceUserId = getRemnashopUserIdFromAccessToken(authForLink.accessToken);
      const telegramAuthUserId = getRemnashopUserIdFromAccessToken(
        (await remnashopAuthTelegramIdentity({
          telegramId: session.user.telegramId,
          telegramUsername: session.user.telegramUsername,
        })).cookies.accessToken,
      );

      if (sourceUserId !== telegramAuthUserId) {
        const mergedAuth = await mergeEmailAccountIntoTelegramAccount({
          emailAccessToken: accessToken,
          telegramId: session.user.telegramId,
          telegramUsername: session.user.telegramUsername,
          reason: "Clean Pay account link: verified e-mail code and Telegram ownership",
        });
        authForLink = {
          accessToken: mergedAuth.accessToken,
          refreshToken: mergedAuth.refreshToken,
          auth: mergedAuth.auth,
          upstreamMerged: mergedAuth.merged,
        };
      }
    }

    await linkCurrentUserToRemnashopAuth({
      accessToken: authForLink.accessToken,
      refreshToken: authForLink.refreshToken,
      auth: authForLink.auth,
      ...(authForLink.upstreamMerged
        ? { invalidateSiblingRemnashopTokens: true }
        : {}),
    });
    await refreshCurrentAccessCookie();
  } catch (error) {
    accountSyncPending = true;
    await prisma.webUser.update({
      where: { id: session.userId },
      data: { authPending: true },
    });
    logger.warn("email_verification_post_confirm_sync_failed", {
      sessionId: session.id,
      userId: session.userId,
      errorCode: error instanceof BffError ? error.code : "INTERNAL_ERROR",
    }, {
      category: "auth",
      source: "email.verification",
      message: "E-mail was verified but post-confirm account synchronization is pending",
    });
  }

  return {
    ...result,
    already_verified: alreadyVerified,
    account_sync_pending: accountSyncPending,
  };
}

export async function changeEmail(rawBody: AuthPayload<ChangeEmailRequest>, turnstile: TurnstileContext) {
  const { body, turnstileToken } = stripTurnstile(rawBody);
  authDebugLog("email_change_started", {
    hasEmail: Boolean(body.email),
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
  });
  await verifyTurnstileToken(turnstileToken ?? turnstile.token, turnstile.remoteIp);
  authDebugLog("email_change_turnstile_passed", {});
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
