import { NextResponse } from "next/server";

import { logTechnicalError, logTechnicalInfo, logTechnicalWarning } from "@/backend/observability/audit";
import { getEnv } from "@/backend/config/env";
import { reconcileUserFromRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { createWebSessionOnResponse } from "@/backend/sessions/web-session";
import {
  consumeTelegramCallback,
  consumeTelegramLoginWidgetPayload,
  consumeTelegramPopupToken,
} from "@/backend/integrations/telegram/oidc";

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
    const { user, redirectTo: nextPath, remnashopAuth } = await consumeTelegramCallback(code, state);
    const response = redirectTo(nextPath ?? "/cabinet");

    if (remnashopAuth) {
      const reconciled = await reconcileUserFromRemnashopAuth({
        accessToken: remnashopAuth.cookies.accessToken,
        refreshToken: remnashopAuth.cookies.refreshToken,
        auth: remnashopAuth.data,
      });

      await createWebSessionOnResponse(response, reconciled.user.id, {
        remnashopSession: reconciled.remnashopSession,
      });
    } else {
      await createWebSessionOnResponse(response, user.id);
    }

    logTechnicalInfo("telegram_callback_success", {
      ...metadata,
      userId: user.id,
      remnashopLinked: Boolean(remnashopAuth),
      redirectTo: nextPath ?? "/cabinet",
    });

    return response;
  } catch (error) {
    logTechnicalError("telegram_callback_failed", error, metadata);
    return redirectTo("/login?auth=telegram_failed");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as {
      authData?: unknown;
      idToken?: unknown;
    } | null;
    const idToken = typeof body?.idToken === "string" ? body.idToken : null;
    const authData = body?.authData;

    if (!idToken && (!authData || typeof authData !== "object")) {
      logTechnicalWarning("telegram_popup_callback_missing_token", {});
      return NextResponse.json({ error: "telegram_failed" }, { status: 400 });
    }

    const { user, redirectTo: nextPath, remnashopAuth } = idToken
      ? await consumeTelegramPopupToken(idToken)
      : await consumeTelegramLoginWidgetPayload(authData as Parameters<typeof consumeTelegramLoginWidgetPayload>[0]);
    const response = NextResponse.json({ redirectTo: nextPath ?? "/cabinet" });

    if (remnashopAuth) {
      const reconciled = await reconcileUserFromRemnashopAuth({
        accessToken: remnashopAuth.cookies.accessToken,
        refreshToken: remnashopAuth.cookies.refreshToken,
        auth: remnashopAuth.data,
      });

      await createWebSessionOnResponse(response, reconciled.user.id, {
        remnashopSession: reconciled.remnashopSession,
      });
    } else {
      await createWebSessionOnResponse(response, user.id);
    }

    logTechnicalInfo("telegram_popup_callback_success", {
      userId: user.id,
      remnashopLinked: Boolean(remnashopAuth),
      redirectTo: nextPath ?? "/cabinet",
    });

    return response;
  } catch (error) {
    logTechnicalError("telegram_popup_callback_failed", error, {});
    return NextResponse.json({ error: "telegram_failed" }, { status: 400 });
  }
}
