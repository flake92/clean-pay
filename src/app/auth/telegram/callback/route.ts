import { NextResponse } from "next/server";

import { completeTelegramCallback } from "@/backend/application/auth/complete-telegram-callback";
import type { TelegramCallbackOutcome } from "@/backend/application/auth/ports/telegram-callback";
import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import {
  productionTelegramCallbackProcessor,
} from "@/backend/integrations/auth/telegram-callback-processor";
import {
  telegramAccountMergeCookieMaxAgeSeconds,
  telegramAccountMergeCookieName,
} from "@/backend/integrations/auth/telegram-account-merge-service";
import { recoverRemnashopTelegramSession } from "@/backend/integrations/remnashop/client";
import {
  createWebSessionOnResponse,
  getCurrentSession,
} from "@/backend/integrations/sessions/web-session-service";
import { readTelegramPopupRequest } from "@/backend/integrations/telegram/popup-request";
import { TelegramAuthStateAlreadyConsumedError } from "@/backend/integrations/telegram/oidc";
import {
  logTechnicalError,
  logTechnicalInfo,
  logTechnicalWarning,
} from "@/backend/observability/audit";

export const runtime = "nodejs";

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getEnv().publicAppUrl));
}

function setMergeConfirmationCookie(response: NextResponse, token: string) {
  const env = getEnv();
  response.cookies.set(telegramAccountMergeCookieName, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    maxAge: telegramAccountMergeCookieMaxAgeSeconds,
  });
}

async function applyCallbackOutcome(
  response: NextResponse,
  outcome: TelegramCallbackOutcome,
) {
  if (outcome.mergeConfirmation) {
    setMergeConfirmationCookie(response, outcome.mergeConfirmation.token);
    return;
  }

  if (!outcome.session) {
    throw new Error("Telegram callback completed without a session result");
  }

  const session = await createWebSessionOnResponse(
    response,
    outcome.session.userId,
    outcome.session.remnashopSession
      ? { remnashopSession: outcome.session.remnashopSession }
      : undefined,
  );

  if (outcome.session.requiresTelegramRecovery) {
    await recoverRemnashopTelegramSession(session.id, outcome.session.userId);
  }
}

async function redirectAfterTelegramFailure(error?: unknown) {
  const session = await getCurrentSession().catch(() => null);

  if (!session) return redirectTo("/login?auth=telegram_failed");

  const reason =
    error instanceof ServiceError && error.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT"
      ? "telegram_merge_subscriptions"
      : error instanceof ServiceError && error.code === "ACCOUNT_MERGE_REQUIRED"
        ? "telegram_merge_required"
        : "telegram_failed";

  return redirectTo(`/link-account?auth=${reason}`);
}

async function redirectAfterConsumedTelegramState() {
  const session = await getCurrentSession().catch(() => null);
  return session
    ? redirectTo("/link-account?auth=telegram_processing")
    : redirectTo("/login?auth=telegram_failed");
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
    return redirectAfterTelegramFailure();
  }

  try {
    const outcome = await completeTelegramCallback(
      productionTelegramCallbackProcessor,
      { kind: "oidc", code, state },
    );
    const response = redirectTo(outcome.redirectTo);
    await applyCallbackOutcome(response, outcome);
    if (outcome.mergeConfirmation) return response;

    logTechnicalInfo("telegram_callback_success", {
      ...metadata,
      ...outcome.audit,
      redirectTo: outcome.redirectTo,
    });

    return response;
  } catch (error) {
    logTechnicalError("telegram_callback_failed", error, metadata);
    if (error instanceof TelegramAuthStateAlreadyConsumedError) {
      return redirectAfterConsumedTelegramState();
    }
    return redirectAfterTelegramFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const popupRequest = await readTelegramPopupRequest(request);
    const outcome = await completeTelegramCallback(
      productionTelegramCallbackProcessor,
      popupRequest.method === "oidc"
        ? { kind: "popup-oidc", idToken: popupRequest.idToken }
        : { kind: "login-widget", authData: popupRequest.authData },
    );
    const response = NextResponse.json({ redirectTo: outcome.redirectTo });
    await applyCallbackOutcome(response, outcome);
    if (outcome.mergeConfirmation) return response;

    logTechnicalInfo("telegram_popup_callback_success", {
      ...outcome.audit,
      redirectTo: outcome.redirectTo,
    });

    return response;
  } catch (error) {
    logTechnicalError("telegram_popup_callback_failed", error, {});
    if (error instanceof ServiceError && error.status === 413) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }
    if (error instanceof TelegramAuthStateAlreadyConsumedError) {
      const session = await getCurrentSession().catch(() => null);
      if (session) {
        return NextResponse.json({
          redirectTo: "/link-account?auth=telegram_processing",
        });
      }
    }
    return NextResponse.json({ error: "telegram_failed" }, { status: 400 });
  }
}
