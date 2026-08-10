import { ProfileGatewayError, type ProfileCommands } from "@/application/profile/ports/profile-commands";
import { ServiceError } from "@/backend/errors/service-error";
import {
  getAuthorizedRemnashopTokens,
  getJwtExpiresAt,
  protectRemnashopToken,
  remnashopChangePassword,
  remnashopRefreshTokens,
} from "@/backend/integrations/remnashop/client";
import { prismaAuthSessionRepository } from "@/backend/integrations/auth/prisma-auth-session-repository";
import { replaceWebSessionAfterPasswordChange } from "@/backend/integrations/sessions/web-session-service";
import { auditLog } from "@/backend/observability/audit";
import { assertRateLimit } from "@/backend/limits/rate-limit";

type PasswordSessionContext = Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>;
type PasswordProviderContext = Awaited<ReturnType<typeof remnashopChangePassword>>;
type RefreshedProviderContext = Awaited<ReturnType<typeof remnashopRefreshTokens>>;
function passwordSession(value: { context: unknown }) { return value.context as PasswordSessionContext; }
function passwordProvider(value: { context: unknown }) { return value.context as PasswordProviderContext; }
function refreshedProvider(value: { context: unknown }) { return value.context as RefreshedProviderContext; }
function addDays(date: Date, days: number) { return new Date(date.getTime() + days * 86_400_000); }

export const productionProfileCommands: ProfileCommands = {
  async loadPasswordSession() {
    const authorized = await getAuthorizedRemnashopTokens();
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
    const refreshed = await remnashopRefreshTokens(passwordSession(session).refreshToken);
    return { context: refreshed };
  },
  async persistRefreshedProviderSession(session, refreshed) {
    const authorized = passwordSession(session);
    const result = refreshedProvider(refreshed);
    await prismaAuthSessionRepository.replaceUpstreamTokens(authorized.session.id, {
      accessTokenEncrypted: protectRemnashopToken(result.cookies.accessToken),
      refreshTokenEncrypted: protectRemnashopToken(result.cookies.refreshToken),
      accessExpiresAt: new Date(result.data.expires_at),
      refreshExpiresAt: new Date(result.data.refresh_expires_at),
    });
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
