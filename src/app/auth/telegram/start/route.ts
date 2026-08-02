import { NextResponse } from "next/server";

import { getEnv } from "@/backend/config/env";
import {
  createTelegramAuthorizationResponse,
  createTelegramPopupStartResponse,
} from "@/backend/integrations/telegram/oidc";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { getCurrentUser } from "@/backend/sessions/web-session";
import { verifyTurnstileToken } from "@/backend/security/turnstile";
import { safeRedirectPath } from "@/backend/auth/redirect-policy";
import { logTechnicalError } from "@/backend/observability/audit";

export const runtime = "nodejs";

function telegramFailedRedirect(
  redirectTo: string | undefined,
  authenticated: boolean,
) {
  const publicAppUrl = getEnv().publicAppUrl;

  if (authenticated) {
    const candidate = redirectTo
      ? new URL(redirectTo, publicAppUrl)
      : null;
    const failureUrl = candidate?.pathname === "/link-account"
      ? candidate
      : new URL("/link-account", publicAppUrl);

    failureUrl.searchParams.set("auth", "telegram_failed");
    return NextResponse.redirect(failureUrl);
  }

  const failureUrl = new URL("/login", publicAppUrl);
  failureUrl.searchParams.set("auth", "telegram_failed");
  if (redirectTo) {
    failureUrl.searchParams.set("redirect_to", redirectTo);
  }

  return NextResponse.redirect(failureUrl);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectTo = safeRedirectPath(url.searchParams.get("redirect_to"));
  let currentUser: Awaited<ReturnType<typeof getCurrentUser>> = null;

  try {
    currentUser = await getCurrentUser();

    await verifyTurnstileToken(
      url.searchParams.get("turnstile_token") ?? url.searchParams.get("cf-turnstile-response"),
      "auth_login",
    );

    if (currentUser) {
      await assertRateLimit({
        action: "telegram_link_start",
        email: currentUser.email,
        tgId: currentUser.telegramId,
        limit: 10,
        windowSeconds: 15 * 60,
      });
    }

    if (url.searchParams.get("mode") === "popup") {
      return await createTelegramPopupStartResponse(redirectTo, currentUser?.id);
    }

    return await createTelegramAuthorizationResponse(redirectTo, currentUser?.id);
  } catch (error) {
    logTechnicalError("telegram_oidc_start_failed", error, { redirectTo });

    return telegramFailedRedirect(redirectTo, Boolean(currentUser));
  }
}
