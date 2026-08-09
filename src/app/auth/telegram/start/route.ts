import { NextResponse } from "next/server";

import {
  prepareTelegramAuthStart,
  TelegramAuthStartFailure,
} from "@/application/auth/prepare-telegram-auth-start";
import { getEnv } from "@/backend/config/env";
import { productionTelegramAuthStartSecurity } from "@/backend/integrations/auth/telegram-auth-start-security";
import {
  createTelegramAuthorizationResponse,
  createTelegramPopupStartResponse,
} from "@/backend/integrations/telegram/oidc";
import { logTechnicalError } from "@/backend/observability/audit";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

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
  let authenticated = false;

  try {
    const prepared = await prepareTelegramAuthStart(productionTelegramAuthStartSecurity, {
      turnstileToken: url.searchParams.get("turnstile_token") ?? url.searchParams.get("cf-turnstile-response"),
    });
    authenticated = prepared.authenticated;

    if (url.searchParams.get("mode") === "popup") {
      return await createTelegramPopupStartResponse(redirectTo, prepared.userId);
    }

    return await createTelegramAuthorizationResponse(redirectTo, prepared.userId);
  } catch (error) {
    const failure = error instanceof TelegramAuthStartFailure ? error : null;
    logTechnicalError("telegram_oidc_start_failed", failure?.cause ?? error, { redirectTo });

    return telegramFailedRedirect(redirectTo, failure?.authenticated ?? authenticated);
  }
}
