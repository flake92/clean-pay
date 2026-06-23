import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { createTelegramAuthorizationResponse } from "@/lib/telegram-oidc";
import { assertRateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { getRequestIp, verifyTurnstileToken } from "@/lib/turnstile";

export const runtime = "nodejs";

function loginFailedRedirect() {
  return NextResponse.redirect(new URL("/login?auth=telegram_failed", getEnv().publicAppUrl));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirect_to") ?? undefined;

  try {
    const currentUser = await getCurrentUser();

    await verifyTurnstileToken(
      url.searchParams.get("turnstile_token") ?? url.searchParams.get("cf-turnstile-response"),
      getRequestIp(request),
    );

    await assertRateLimit({
      action: currentUser ? "telegram_link_start" : "telegram_login_start",
      email: currentUser?.email,
      tgId: currentUser?.telegramId,
      limit: 10,
      windowSeconds: 15 * 60,
    });

    return createTelegramAuthorizationResponse(redirectTo, currentUser?.id);
  } catch {
    return loginFailedRedirect();
  }
}
