import { prisma } from "@/backend/database/prisma";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  protectRemnashopToken,
  remnashopAuth,
  remnashopAuthTelegramIdentity,
  remnashopLinkTelegram,
  remnashopMergeUsers,
} from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { linkCurrentUserToRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import type { LoginRequest } from "@/shared/remnashop/types";
import { requestRemnashopEmailVerification } from "@/backend/auth/email-verification";
import { getCurrentSession, refreshCurrentAccessCookie } from "@/backend/sessions/web-session";

function isEmailAlreadyExistsConflict(error: unknown) {
  return (
    error instanceof BffError &&
    error.code === "CONFLICT" &&
    String(error.debug?.message ?? error.message).toLowerCase().includes("email already exists")
  );
}

function isEmailAlreadyVerifiedConflict(error: unknown) {
  return (
    error instanceof BffError &&
    error.code === "CONFLICT" &&
    String(error.debug?.message ?? error.message).toLowerCase().includes("email is already verified")
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
      auth: telegramAuth,
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

  return {
    auth: await remnashopAuthTelegramIdentity({
      telegramId,
      telegramUsername,
    }),
    merged: true,
    sourceUserId,
    targetUserId,
  };
}

async function attachTelegramToVerifiedRemnashopAccount({
  auth,
  session,
}: {
  auth: Awaited<ReturnType<typeof remnashopAuth>>;
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
}) {
  let authForLink = auth;

  if (session.user.telegramId) {
    try {
      await remnashopLinkTelegram({
        accessToken: auth.cookies.accessToken,
        telegramId: session.user.telegramId,
        telegramUsername: session.user.telegramUsername,
      });
      authDebugLog("remnashop_account_link_telegram_attached", {
        sessionId: session.id,
        userId: session.userId,
        telegramId: session.user.telegramId,
      });
    } catch (error) {
      if (!isTelegramAlreadyLinkedConflict(error)) {
        throw error;
      }

      authDebugLog("remnashop_account_link_telegram_conflict_merge_started", {
        sessionId: session.id,
        userId: session.userId,
        telegramId: session.user.telegramId,
      });

      const merged = await mergeEmailAccountIntoTelegramAccount({
        emailAccessToken: auth.cookies.accessToken,
        telegramId: session.user.telegramId,
        telegramUsername: session.user.telegramUsername,
        reason: "Clean Pay account link: verified e-mail password and Telegram ownership",
      });
      authForLink = merged.auth;

      authDebugLog("remnashop_account_link_telegram_conflict_merge_completed", {
        sessionId: session.id,
        userId: session.userId,
        telegramId: session.user.telegramId,
        sourceRemnashopUserId: merged.sourceUserId,
        targetRemnashopUserId: merged.targetUserId,
      });
    }

    const linkedRemnashopUserId = getRemnashopUserIdFromAccessToken(authForLink.cookies.accessToken);
    const telegramAuth = await remnashopAuthTelegramIdentity({
      telegramId: session.user.telegramId,
      telegramUsername: session.user.telegramUsername,
    });
    const telegramRemnashopUserId = getRemnashopUserIdFromAccessToken(telegramAuth.cookies.accessToken);

    if (linkedRemnashopUserId !== telegramRemnashopUserId) {
      const merged = await mergeEmailAccountIntoTelegramAccount({
        emailAccessToken: auth.cookies.accessToken,
        telegramId: session.user.telegramId,
        telegramUsername: session.user.telegramUsername,
        reason: "Clean Pay account link: verified e-mail password and Telegram ownership",
      });
      authForLink = merged.auth;
    }
  }

  const linked = await linkCurrentUserToRemnashopAuth({
    accessToken: authForLink.cookies.accessToken,
    refreshToken: authForLink.cookies.refreshToken,
    auth: authForLink.data,
  });
  await refreshCurrentAccessCookie();

  return linked;
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
  let authSource: "login" | "register" = "login";

  let loginFailed: BffError | null = null;

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

    loginFailed = error;

    try {
      auth = await remnashopAuth("/auth/register", body);
      authSource = "register";
    } catch (registerError) {
      if (isEmailAlreadyExistsConflict(registerError)) {
        throw loginFailed;
      }

      throw registerError;
    }
    authDebugLog("remnashop_account_link_register_fallback_success", {
      accessExpiresAt: auth.data.expires_at,
      refreshExpiresAt: auth.data.refresh_expires_at,
    });
  }

  const session = await getCurrentSession();

  if (!session) {
    throw new BffError("UNAUTHORIZED", 401, "Login is required.");
  }

  const profile = await getRemnashopMe(auth.cookies.accessToken);

  if (authSource === "login" && profile.email && profile.is_email_verified) {
    const linked = await attachTelegramToVerifiedRemnashopAccount({ auth, session });
    authDebugLog("remnashop_account_link_verified_email_linked", {
      sessionId: session.id,
      userId: linked.user.id,
      targetEmail: profile.email,
    });

    await auditLog({
      action: "remnashop_account_linked_verified_email",
      userId: linked.user.id,
      metadata: {
        email: profile.email,
        telegramId: session.user.telegramId,
      },
    });

    return {
      user: {
        ...linked.profile,
        telegram_id: linked.user.telegramId ?? linked.profile.telegram_id,
        telegramId: linked.user.telegramId,
      },
      linked: true,
      pendingVerification: false,
      alreadyVerified: true,
    };
  }

  const existingEmailOwner = body.email
    ? await prisma.webUser.findUnique({ where: { email: body.email } })
    : null;
  const canStageEmailOnCurrentUser =
    Boolean(body.email) &&
    (!existingEmailOwner || existingEmailOwner.id === session.userId);

  await prisma.$transaction(async (tx) => {
    await tx.webSession.update({
      where: { id: session.id },
      data: {
        remnashopAccessTokenEncrypted: protectRemnashopToken(auth.cookies.accessToken),
        remnashopRefreshTokenEncrypted: protectRemnashopToken(auth.cookies.refreshToken),
        remnashopAccessExpiresAt: new Date(auth.data.expires_at),
        remnashopRefreshExpiresAt: new Date(auth.data.refresh_expires_at),
      },
    });

    if (canStageEmailOnCurrentUser) {
      await tx.webUser.update({
        where: { id: session.userId },
        data: {
          email: body.email,
          emailVerified: false,
          authPending: true,
        },
      });
    }
  });

  if (canStageEmailOnCurrentUser) {
    await refreshCurrentAccessCookie();
  }

  let verification: Awaited<ReturnType<typeof requestRemnashopEmailVerification>>;

  try {
    verification = await requestRemnashopEmailVerification({
      accessToken: auth.cookies.accessToken,
      body: { email: body.email },
      source: "link_remnashop",
    });
  } catch (error) {
    if (!isEmailAlreadyVerifiedConflict(error)) {
      throw error;
    }

    authDebugLog("remnashop_account_link_verified_email_requires_fresh_confirmation", {
      sessionId: session.id,
      userId: session.userId,
      targetEmail: profile.email ?? body.email,
    });

    await auditLog({
      action: "remnashop_account_link_verified_email_blocked",
      userId: session.userId,
      metadata: {
        email: profile.email ?? body.email,
        telegramId: session.user.telegramId,
        source: "request_verification_conflict",
      },
    });

    if (authSource === "login") {
      const linked = await attachTelegramToVerifiedRemnashopAccount({ auth, session });
      authDebugLog("remnashop_account_link_verified_email_linked_after_conflict", {
        sessionId: session.id,
        userId: linked.user.id,
        targetEmail: linked.profile.email,
      });

      await auditLog({
        action: "remnashop_account_linked_verified_email",
        userId: linked.user.id,
        metadata: {
          email: linked.profile.email,
          telegramId: session.user.telegramId,
          source: "request_verification_conflict",
        },
      });

      return {
        user: {
          ...linked.profile,
          telegram_id: linked.user.telegramId ?? linked.profile.telegram_id,
          telegramId: linked.user.telegramId,
        },
        linked: true,
        pendingVerification: false,
        alreadyVerified: true,
      };
    }

    throw new BffError("EMAIL_LINK_REQUIRES_VERIFICATION", 409, "New email account must be confirmed before linking.");
  }

  authDebugLog("remnashop_account_link_verification_requested", {
    userId: session.userId,
    targetEmail: verification.target_email,
    expiresAt: verification.expires_at,
    stagedLocalEmail: canStageEmailOnCurrentUser,
    existingEmailOwnerId: existingEmailOwner?.id,
  });

  await auditLog({
    action: "remnashop_account_link_requested",
    userId: session.userId,
    metadata: {
      email: profile.email,
      telegramId: session.user.telegramId,
      verificationTargetEmail: verification.target_email,
      stagedLocalEmail: canStageEmailOnCurrentUser,
    },
  });

  return {
    user: {
      ...profile,
      is_email_verified: false,
      emailVerified: false,
      telegram_id: session.user.telegramId ?? profile.telegram_id,
      telegramId: session.user.telegramId,
    },
    emailVerification: verification,
    linked: false,
    pendingVerification: true,
  };
}
