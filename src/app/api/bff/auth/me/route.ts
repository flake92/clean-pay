import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockUser } from "@/lib/mock-bff";
import { getAuthorizedRemnashopTokens, getRemnashopMe } from "@/lib/remnashop/client";
import { BffError } from "@/lib/remnashop/errors";
import { getCurrentSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (isMockMode()) {
      return bffJson({ user: mockUser });
    }

    const session = await getCurrentSession();

    if (!session) {
      throw new BffError("UNAUTHORIZED", 401, "Session is required");
    }

    if (
      !session.remnashopAccessTokenEncrypted ||
      !session.remnashopRefreshTokenEncrypted
    ) {
      return bffJson({
        user: {
          telegram_id: session.user.telegramId?.toString() ?? null,
          auth_type: session.authMethod === "TELEGRAM" ? "telegram" : "email",
          email: session.user.email,
          is_email_verified: session.user.emailVerified,
          pending_email: null,
          name: session.user.fullName ?? session.user.displayName ?? "",
          username: session.user.telegramUsername,
          language: "ru",
          telegramId: session.user.telegramId?.toString() ?? null,
          telegramUsername: session.user.telegramUsername ?? null,
          fullName: session.user.fullName,
          displayName: session.user.displayName,
          emailVerified: session.user.emailVerified,
        },
      });
    }

    const { accessToken } = await getAuthorizedRemnashopTokens({
      allowUnverifiedEmail: true,
    });
    const profile = await getRemnashopMe(accessToken);
    const localUser = session?.user;

    return bffJson({
      user: {
        ...profile,
        auth_type: session?.authMethod === "TELEGRAM" ? "telegram" : "email",
        telegram_id: localUser?.telegramId?.toString() ?? profile.telegram_id?.toString() ?? null,
        telegramId: localUser?.telegramId?.toString() ?? null,
        telegramUsername: localUser?.telegramUsername ?? null,
        fullName: localUser?.fullName ?? profile.name,
        displayName: localUser?.displayName ?? profile.name,
        emailVerified: localUser?.emailVerified ?? profile.is_email_verified,
      },
    });
  } catch (error) {
    return bffError(error);
  }
}
