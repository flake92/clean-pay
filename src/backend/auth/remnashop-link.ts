import { prisma } from "@/backend/database/prisma";
import { getRemnashopMe, protectRemnashopToken, remnashopAuth } from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import type { LoginRequest } from "@/shared/remnashop/types";
import { requestRemnashopEmailVerification } from "@/backend/auth/email-verification";
import { getCurrentSession, refreshCurrentAccessCookie } from "@/backend/sessions/web-session";

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

  if (!session) {
    throw new BffError("UNAUTHORIZED", 401, "Login is required.");
  }

  const profile = await getRemnashopMe(auth.cookies.accessToken);
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

  const verification = await requestRemnashopEmailVerification({
    accessToken: auth.cookies.accessToken,
    body: { email: body.email },
    source: "link_remnashop",
  });

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
