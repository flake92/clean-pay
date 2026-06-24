import { NextResponse } from "next/server";

import { logTechnicalError, logTechnicalInfo, logTechnicalWarning } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import { createWebSessionOnResponse } from "@/lib/session";
import { consumeTelegramCallback } from "@/lib/telegram-oidc";

export const runtime = "nodejs";

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getEnv().publicAppUrl));
}

function callbackRequestMetadata(request: Request, url: URL) {
  return {
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    forwardedPort: request.headers.get("x-forwarded-port"),
    realIpPresent: Boolean(request.headers.get("x-real-ip")),
    forwardedForPresent: Boolean(request.headers.get("x-forwarded-for")),
    referer: request.headers.get("referer"),
    authParamPresent: url.searchParams.has("code"),
    stateParamPresent: url.searchParams.has("state"),
    error: url.searchParams.get("error"),
    errorDescription: url.searchParams.get("error_description"),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const metadata = callbackRequestMetadata(request, url);

  logTechnicalInfo("telegram_callback_received", metadata);

  if (!code || !state) {
    logTechnicalWarning("telegram_callback_missing_params", metadata);
    return redirectTo("/login?auth=telegram_failed");
  }

  try {
    const { user, redirectTo: nextPath } = await consumeTelegramCallback(code, state);
    const response = redirectTo(nextPath ?? "/cabinet");

    await createWebSessionOnResponse(response, user.id);

    logTechnicalInfo("telegram_callback_success", {
      ...metadata,
      userId: user.id,
      redirectTo: nextPath ?? "/cabinet",
    });

    return response;
  } catch (error) {
    logTechnicalError("telegram_callback_failed", error, metadata);
    return redirectTo("/login?auth=telegram_failed");
  }
}
