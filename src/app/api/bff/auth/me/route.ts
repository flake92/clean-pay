import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockUser } from "@/lib/mock-bff";
import { getAuthorizedRemnashopTokens, getRemnashopMe } from "@/lib/remnashop/client";
import { getCurrentSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (isMockMode()) {
      return bffJson({ user: mockUser });
    }

    const session = await getCurrentSession();
    const { accessToken } = await getAuthorizedRemnashopTokens();
    const profile = await getRemnashopMe(accessToken);
    const localUser = session?.user;

    return bffJson({
      user: {
        ...profile,
        auth_type: session?.authMethod === "TELEGRAM" ? "telegram" : "email",
        telegram_id: localUser?.telegramId ?? profile.telegram_id,
        telegramId: localUser?.telegramId ?? null,
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
