import { NextResponse } from "next/server";

import { completeTelegramCallback } from "@/application/auth/complete-telegram-callback";
import {
  TelegramCallbackError,
  type TelegramCallbackOutcome,
} from "@/application/auth/ports/telegram-callback";
import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import {
  productionTelegramCallbackGateway,
} from "@/backend/integrations/auth/telegram-callback-gateway";
import { recoverRemnashopTelegramSession } from "@/backend/integrations/remnashop/client";
import {
  telegramAccountMergeCookieMaxAgeSeconds,
  telegramAccountMergeCookieName,
} from "@/backend/integrations/auth/telegram-account-merge-store";
import {
  createWebSessionOnResponse,
  getCurrentSession,
} from "@/backend/integrations/sessions/web-session-service";
import { revokeWebSessionById } from "@/backend/integrations/sessions/web-session-revocation";
import { readTelegramPopupRequest } from "@/backend/integrations/telegram/popup-request";
import { TelegramAuthStateAlreadyConsumedError } from "@/backend/integrations/telegram/oidc";
import { validateRequestSource } from "@/backend/security/csrf";
import {
  logTechnicalError,
  logTechnicalInfo,
  logTechnicalWarning,
} from "@/backend/observability/audit";
import { clearReferralAttributionCookieOnResponse } from "@/backend/integrations/referral/referral-attribution";

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
    try {
      await recoverRemnashopTelegramSession(session.id, outcome.session.userId);
    } catch (error) {
      try {
        await revokeWebSessionById(session.id, outcome.session.userId);
      } catch (revocationError) {
        logTechnicalError("telegram_callback_session_revocation_failed", revocationError, {
          sessionId: session.id,
          userId: outcome.session.userId,
        });
      }
      throw error;
    }
  }
}

async function redirectAfterTelegramFailure(error?: unknown) {
  const session = await getCurrentSession().catch(() => null);

  if (!session) return redirectTo("/login?auth=telegram_failed");

  const reason =
    error instanceof TelegramCallbackError && error.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT"
      ? "telegram_merge_subscriptions"
      : error instanceof TelegramCallbackError && error.code === "ACCOUNT_MERGE_REQUIRED"
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
      productionTelegramCallbackGateway,
      { kind: "oidc", code, state },
    );
    const response = redirectTo(outcome.redirectTo);
    await applyCallbackOutcome(response, outcome);
    if (outcome.mergeConfirmation) return response;
    clearReferralAttributionCookieOnResponse(response);

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
  const source = validateRequestSource({
    headers: request.headers,
    trustedAppUrl: getEnv().publicAppUrl,
  });
  if (!source.ok) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: source.status, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const popupRequest = await readTelegramPopupRequest(request);
    const outcome = await completeTelegramCallback(
      productionTelegramCallbackGateway,
      popupRequest.method === "oidc"
        ? { kind: "popup-oidc", idToken: popupRequest.idToken }
        : { kind: "login-widget", authData: popupRequest.authData },
    );
    const response = NextResponse.json({ redirectTo: outcome.redirectTo });
    await applyCallbackOutcome(response, outcome);
    if (outcome.mergeConfirmation) return response;
    clearReferralAttributionCookieOnResponse(response);

    logTechnicalInfo("telegram_popup_callback_success", {
      ...outcome.audit,
      redirectTo: outcome.redirectTo,
    });

    return response;
  } catch (error) {
    logTechnicalError("telegram_popup_callback_failed", error, {});
    if (error instanceof ServiceError && error.status === 413) {
      return NextResponse.json({ error: "payload_too_large" }, { status: error.status });
    }
    if (error instanceof ServiceError && error.status === 415) {
      return NextResponse.json({ error: "unsupported_media_type" }, { status: error.status });
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
