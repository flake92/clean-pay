import { NextResponse } from "next/server";

import { getEnv } from "@/backend/config/env";
import {
  createTelegramAuthorizationResponse,
  createTelegramPopupStartResponse,
} from "@/backend/integrations/telegram/oidc";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { getCurrentUser } from "@/backend/sessions/web-session";
import { getRequestIp, verifyTurnstileToken } from "@/backend/security/turnstile";
import { safeRedirectPath } from "@/backend/auth/redirect-policy";
import { logTechnicalError } from "@/backend/observability/audit";

export const runtime = "nodejs";

function loginFailedRedirect() {
  return NextResponse.redirect(new URL("/login?auth=telegram_failed", getEnv().publicAppUrl));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectTo = safeRedirectPath(url.searchParams.get("redirect_to"));

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

    if (url.searchParams.get("mode") === "popup") {
      return createTelegramPopupStartResponse(redirectTo, currentUser?.id);
    }

    return createTelegramAuthorizationResponse(redirectTo, currentUser?.id);
  } catch (error) {
    logTechnicalError("telegram_oidc_start_failed", error, { redirectTo });

    return loginFailedRedirect();
  }
}
