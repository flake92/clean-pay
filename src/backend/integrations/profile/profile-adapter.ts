import { ProfileGatewayError, type ProfileCommands } from "@/application/profile/ports/profile-commands";
import { ServiceError } from "@/backend/errors/service-error";
import {
  getAuthorizedRemnashopTokens,
  getJwtExpiresAt,
  protectRemnashopToken,
  remnashopChangePassword,
  remnashopRefreshTokens,
} from "@/backend/integrations/remnashop/client";
import { acquireRemnashopTokensForSession } from "@/backend/integrations/remnashop/session-token-lifecycle";
import { replaceWebSessionAfterPasswordChange } from "@/backend/integrations/sessions/web-session-service";
import { auditLog } from "@/backend/observability/audit";
import { assertRateLimit } from "@/backend/limits/rate-limit";

type PasswordSessionContext = Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>;
type PasswordProviderContext = Awaited<ReturnType<typeof remnashopChangePassword>>;
function passwordSession(value: { context: unknown }) { return value.context as PasswordSessionContext; }
function passwordProvider(value: { context: unknown }) { return value.context as PasswordProviderContext; }
function addDays(date: Date, days: number) { return new Date(date.getTime() + days * 86_400_000); }

type ProfileAuthorizer = typeof getAuthorizedRemnashopTokens;

export function createProductionProfileCommands(
  authorize: ProfileAuthorizer = getAuthorizedRemnashopTokens,
): ProfileCommands {
  return {
  async loadPasswordSession() {
    const authorized = await authorize();
    return { context: authorized, userId: authorized.session.userId };
  },
  async assertPasswordChangeRateLimit(session) {
    await assertRateLimit({
      action: "password_change",
      sessionId: passwordSession(session).session.id,
      limit: 5,
      windowSeconds: 15 * 60,
    });
  },
  async changeProviderPassword(session, input) {
    try {
      const result = await remnashopChangePassword(passwordSession(session).accessToken, {
        current_password: input.currentPassword,
        new_password: input.newPassword,
      });
      return { context: result };
    } catch (error) {
      throw new ProfileGatewayError(error instanceof ServiceError ? error.code : "INTERNAL_ERROR");
    }
  },
  async refreshProviderSession(session) {
    const authorized = passwordSession(session);
    const refreshed = await acquireRemnashopTokensForSession({
      session: authorized.session,
      refresh: remnashopRefreshTokens,
      forceRefresh: true,
    });
    if (!refreshed) {
      throw new ProfileGatewayError("UNAUTHORIZED");
    }
    return { context: refreshed };
  },
  async persistRefreshedProviderSession() {
    // The shared refresh lifecycle durably stores and fences the one-time
    // token response before returning it to this workflow.
  },
  async replaceLocalPasswordSession(session, changed) {
    const authorized = passwordSession(session);
    const result = passwordProvider(changed);
    const now = new Date();
    await replaceWebSessionAfterPasswordChange({
      sessionId: authorized.session.id,
      userId: authorized.session.userId,
      remnashopAccessTokenEncrypted: protectRemnashopToken(result.cookies.accessToken),
      remnashopRefreshTokenEncrypted: protectRemnashopToken(result.cookies.refreshToken),
      remnashopAccessExpiresAt: getJwtExpiresAt(result.cookies.accessToken) ?? addDays(now, 1),
      remnashopRefreshExpiresAt: addDays(now, 30),
    });
  },
  async auditPasswordChanged(userId) {
    await auditLog({ action: "password_changed", userId });
  },
  };
}
