import { createTelegramAuthorizationResponse } from "@/lib/telegram-oidc";
import { assertRateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirect_to") ?? undefined;
  const currentUser = await getCurrentUser();

  await assertRateLimit({
    action: currentUser ? "telegram_link_start" : "telegram_login_start",
    email: currentUser?.email,
    tgId: currentUser?.telegramId,
    limit: 10,
    windowSeconds: 15 * 60,
  });

  return createTelegramAuthorizationResponse(redirectTo, currentUser?.id);
}
