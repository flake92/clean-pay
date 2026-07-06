import { prisma } from "@/backend/database/prisma";
import {
  createRemnashopTelegramAuthForSession,
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  protectRemnashopToken,
  remnashopAuth,
  remnashopLinkTelegram,
} from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { mergeVerifiedEmailRemnashopUserIntoTelegramUser } from "@/backend/integrations/remnashop/admin-merge";
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

async function attachTelegramToVerifiedRemnashopAccount({
  auth,
  session,
}: {
  auth: Awaited<ReturnType<typeof remnashopAuth>>;
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
}) {
  let activeAuth = auth;

  if (session.user.telegramId) {
    try {
      await remnashopLinkTelegram({
        accessToken: activeAuth.cookies.accessToken,
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

      await mergeVerifiedEmailRemnashopUserIntoTelegramUser({
        emailRemnashopUserId: getRemnashopUserIdFromAccessToken(activeAuth.cookies.accessToken),
        telegramId: session.user.telegramId,
      });

      const telegramAuth = await createRemnashopTelegramAuthForSession(session);

      if (!telegramAuth) {
        throw new BffError("INTERNAL_ERROR", 500, "Unable to restore Remnashop Telegram session after merge.");
      }

      activeAuth = telegramAuth;
      authDebugLog("remnashop_account_link_telegram_conflict_merge_completed", {
        sessionId: session.id,
        userId: session.userId,
        telegramId: session.user.telegramId,
      });
    }
  }

  const linked = await linkCurrentUserToRemnashopAuth({
    accessToken: activeAuth.cookies.accessToken,
    refreshToken: activeAuth.cookies.refreshToken,
    auth: activeAuth.data,
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

  if (profile.email && profile.is_email_verified) {
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
