import { prisma } from "@/backend/database/prisma";
import { getJwtExpiresAt, getAuthorizedRemnashopTokens, protectRemnashopToken, remnashopChangePassword } from "@/backend/integrations/remnashop/client";
import { auditLog } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import type { ChangePasswordRequest } from "@/shared/remnashop/types";
import { addDays } from "@/backend/auth/payload";

export async function changePassword(body: ChangePasswordRequest) {
  authDebugLog("password_change_started", {
    hasCurrentPassword: Boolean(body.current_password),
    hasNewPassword: Boolean(body.new_password),
  });
  const { accessToken, session } = await getAuthorizedRemnashopTokens();
  authDebugLog("password_change_session_authorized", {
    sessionId: session.id,
    userId: session.userId,
  });
  const result = await remnashopChangePassword(accessToken, body);
  authDebugLog("password_change_remnashop_success", {
    sessionId: session.id,
    userId: session.userId,
    success: result.data.success,
  });

  await prisma.webSession.update({
    where: { id: session.id },
    data: {
      remnashopAccessTokenEncrypted: protectRemnashopToken(result.cookies.accessToken),
      remnashopRefreshTokenEncrypted: protectRemnashopToken(result.cookies.refreshToken),
      remnashopAccessExpiresAt: getJwtExpiresAt(result.cookies.accessToken) ?? addDays(new Date(), 1),
      remnashopRefreshExpiresAt: addDays(new Date(), 30),
    },
  });
  authDebugLog("password_change_session_tokens_rotated", {
    sessionId: session.id,
    userId: session.userId,
  });

  await auditLog({ action: "password_changed", userId: session.userId });

  return result.data;
}
