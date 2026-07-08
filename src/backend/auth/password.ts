import { prisma } from "@/backend/database/prisma";
import { BffError } from "@/backend/integrations/remnashop/errors";
import {
  getAuthorizedRemnashopTokens,
  getJwtExpiresAt,
  protectRemnashopToken,
  remnashopChangePassword,
  remnashopRefreshTokens,
} from "@/backend/integrations/remnashop/client";
import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import type { ChangePasswordRequest } from "@/shared/remnashop/types";
import { addDays } from "@/backend/auth/payload";

type PasswordSession = Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>["session"];

async function rotateRemnashopSessionTokens(
  session: PasswordSession,
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt?: Date | null;
    refreshExpiresAt?: Date | null;
  },
) {
  await prisma.webSession.update({
    where: { id: session.id },
    data: {
      remnashopAccessTokenEncrypted: protectRemnashopToken(tokens.accessToken),
      remnashopRefreshTokenEncrypted: protectRemnashopToken(tokens.refreshToken),
      remnashopAccessExpiresAt:
        tokens.accessExpiresAt ?? getJwtExpiresAt(tokens.accessToken) ?? addDays(new Date(), 1),
      remnashopRefreshExpiresAt: tokens.refreshExpiresAt ?? addDays(new Date(), 30),
    },
  });
}

export async function changePassword(body: ChangePasswordRequest) {
  authDebugLog("password_change_started", {
    hasCurrentPassword: Boolean(body.current_password),
    hasNewPassword: Boolean(body.new_password),
  });
  const { accessToken, refreshToken, session } = await getAuthorizedRemnashopTokens();
  authDebugLog("password_change_session_authorized", {
    sessionId: session.id,
    userId: session.userId,
  });

  let result: Awaited<ReturnType<typeof remnashopChangePassword>>;
  try {
    result = await remnashopChangePassword(accessToken, body);
  } catch (error) {
    if (!(error instanceof BffError) || error.code !== "CURRENT_PASSWORD_INVALID") {
      throw error;
    }

    authDebugLog("password_change_retry_after_token_refresh", {
      sessionId: session.id,
      userId: session.userId,
    });
    const refreshed = await remnashopRefreshTokens(refreshToken);
    await rotateRemnashopSessionTokens(session, {
      accessToken: refreshed.cookies.accessToken,
      refreshToken: refreshed.cookies.refreshToken,
      accessExpiresAt: new Date(refreshed.data.expires_at),
      refreshExpiresAt: new Date(refreshed.data.refresh_expires_at),
    });
    result = await remnashopChangePassword(refreshed.cookies.accessToken, body);
  }

  authDebugLog("password_change_remnashop_success", {
    sessionId: session.id,
    userId: session.userId,
    success: result.data.success,
  });

  await rotateRemnashopSessionTokens(session, {
    accessToken: result.cookies.accessToken,
    refreshToken: result.cookies.refreshToken,
  });
  authDebugLog("password_change_session_tokens_rotated", {
    sessionId: session.id,
    userId: session.userId,
  });

  await auditLog({ action: "password_changed", userId: session.userId });

  return result.data;
}
