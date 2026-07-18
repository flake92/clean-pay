import { NextResponse } from "next/server";

import { logTechnicalError, logTechnicalInfo, logTechnicalWarning } from "@/backend/observability/audit";
import { getEnv } from "@/backend/config/env";
import {
  linkCurrentUserToRemnashopAuth,
  reconcileUserFromRemnashopAuth,
} from "@/backend/integrations/remnashop/session";
import {
  getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken,
  getJwtExpiresAt,
  remnashopLinkTelegram,
  remnashopMergeUsers,
} from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import {
  createWebSessionOnResponse,
  getCurrentSession,
} from "@/backend/sessions/web-session";
import {
  consumeTelegramCallback,
  consumeTelegramLoginWidgetPayload,
  consumeTelegramPopupToken,
  TelegramAuthStateAlreadyConsumedError,
} from "@/backend/integrations/telegram/oidc";
import {
  telegramAccountMergeCookieMaxAgeSeconds,
  telegramAccountMergeCookieName,
} from "@/backend/auth/telegram-account-merge";

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

async function redirectAfterTelegramFailure(error?: unknown) {
  const session = await getCurrentSession().catch(() => null);

  if (!session) {
    return redirectTo("/login?auth=telegram_failed");
  }

  const reason =
    error instanceof BffError && error.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT"
      ? "telegram_merge_subscriptions"
      : error instanceof BffError && error.code === "ACCOUNT_MERGE_REQUIRED"
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

async function linkTelegramToCurrentRemnashopAccount({
  telegramId,
  telegramUsername,
}: {
  telegramId: string;
  telegramUsername: string | null;
}) {
  const tokens = await getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true });

  await remnashopLinkTelegram({
    accessToken: tokens.accessToken,
    telegramId,
    telegramUsername,
  });

  return linkCurrentUserToRemnashopAuth({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    auth: {
      expires_at:
        getJwtExpiresAt(tokens.accessToken)?.toISOString()
        ?? tokens.session.remnashopAccessExpiresAt?.toISOString()
        ?? new Date(Date.now() + 60_000).toISOString(),
      refresh_expires_at:
        getJwtExpiresAt(tokens.refreshToken)?.toISOString()
        ?? tokens.session.remnashopRefreshExpiresAt?.toISOString()
        ?? new Date(Date.now() + 60_000).toISOString(),
    },
  });
}

function isBothSubscriptionsMergeConflict(error: unknown) {
  return (
    error instanceof BffError &&
    error.code === "CONFLICT" &&
    String(error.debug?.message ?? error.message).toLowerCase().includes("both users have current subscriptions")
  );
}

async function mergeCurrentRemnashopAccountIntoTelegramAccount({
  remnashopAuth,
  currentRemnashopUserId,
}: {
  remnashopAuth: NonNullable<Awaited<ReturnType<typeof consumeTelegramCallback>>["remnashopAuth"]>;
  currentRemnashopUserId: string | null;
}) {
  if (!currentRemnashopUserId) {
    throw new BffError(
      "ACCOUNT_MERGE_REQUIRED",
      409,
      "Current Clean Pay account is not linked to Remnashop.",
    );
  }

  const sourceUserId = currentRemnashopUserId;
  const targetUserId = getRemnashopUserIdFromAccessToken(remnashopAuth.cookies.accessToken);

  if (sourceUserId === targetUserId) {
    return;
  }

  try {
    await remnashopMergeUsers({
      sourceUserId,
      targetUserId,
      reason: "Clean Pay Telegram link: merge current e-mail account into owned Telegram account",
    });
  } catch (error) {
    if (isBothSubscriptionsMergeConflict(error)) {
      throw new BffError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "У обеих учетных записей есть активные подписки. Объединение нужно выполнить через поддержку.",
        {
          message: "У обеих учетных записей есть активные подписки. Объединение нужно выполнить через поддержку.",
        },
      );
    }

    throw error;
  }
}

async function reconcileTelegramCallbackResult({
  linked,
  userId,
  currentRemnashopUserId,
  telegramId,
  telegramUsername,
  remnashopAuth,
}: {
  linked: boolean;
  userId: string;
  currentRemnashopUserId: string | null;
  telegramId: string;
  telegramUsername: string | null;
  remnashopAuth: Awaited<ReturnType<typeof consumeTelegramCallback>>["remnashopAuth"];
}) {
  if (linked) {
    try {
      await linkTelegramToCurrentRemnashopAccount({ telegramId, telegramUsername });

      return { userId, remnashopSession: undefined };
    } catch (error) {
      logTechnicalWarning("telegram_link_remnashop_attach_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        telegramId,
      });

      if (!remnashopAuth) {
        return { userId, remnashopSession: undefined };
      }

      await mergeCurrentRemnashopAccountIntoTelegramAccount({
        remnashopAuth,
        currentRemnashopUserId,
      });

      const linkedUser = await linkCurrentUserToRemnashopAuth({
        accessToken: remnashopAuth.cookies.accessToken,
        refreshToken: remnashopAuth.cookies.refreshToken,
        auth: remnashopAuth.data,
      });

      return { userId: linkedUser.user.id, remnashopSession: undefined };
    }
  }

  if (!remnashopAuth) {
    return { userId, remnashopSession: undefined };
  }

  const reconciled = await reconcileUserFromRemnashopAuth({
    accessToken: remnashopAuth.cookies.accessToken,
    refreshToken: remnashopAuth.cookies.refreshToken,
    auth: remnashopAuth.data,
  });

  return {
    userId: reconciled.user.id,
    remnashopSession: reconciled.remnashopSession,
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
    const {
      user,
      redirectTo: nextPath,
      remnashopAuth,
      linked,
      telegramId,
      telegramUsername,
      mergeConfirmation,
    } = await consumeTelegramCallback(code, state);
    const response = redirectTo(
      mergeConfirmation?.required
        ? "/link-account?auth=telegram_email_replace"
        : nextPath ?? "/cabinet",
    );

    if (mergeConfirmation?.required) {
      setMergeConfirmationCookie(response, mergeConfirmation.token);
      return response;
    }

    const reconciled = await reconcileTelegramCallbackResult({
      linked,
      userId: user.id,
      currentRemnashopUserId: user.remnashopUserId,
      telegramId,
      telegramUsername,
      remnashopAuth,
    });

    if (reconciled.remnashopSession) {
      await createWebSessionOnResponse(response, reconciled.userId, {
        remnashopSession: reconciled.remnashopSession,
      });
    } else {
      await createWebSessionOnResponse(response, reconciled.userId);
    }

    logTechnicalInfo("telegram_callback_success", {
      ...metadata,
      userId: user.id,
      remnashopLinked: linked || Boolean(remnashopAuth),
      redirectTo: nextPath ?? "/cabinet",
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

    const {
      user,
      redirectTo: nextPath,
      remnashopAuth,
      linked,
      telegramId,
      telegramUsername,
      mergeConfirmation,
    } = idToken
      ? await consumeTelegramPopupToken(idToken)
      : await consumeTelegramLoginWidgetPayload(authData as Parameters<typeof consumeTelegramLoginWidgetPayload>[0]);
    const redirectPath = mergeConfirmation?.required
      ? "/link-account?auth=telegram_email_replace"
      : nextPath ?? "/cabinet";
    const response = NextResponse.json({ redirectTo: redirectPath });

    if (mergeConfirmation?.required) {
      setMergeConfirmationCookie(response, mergeConfirmation.token);
      return response;
    }
    const reconciled = await reconcileTelegramCallbackResult({
      linked,
      userId: user.id,
      currentRemnashopUserId: user.remnashopUserId,
      telegramId,
      telegramUsername,
      remnashopAuth,
    });

    if (reconciled.remnashopSession) {
      await createWebSessionOnResponse(response, reconciled.userId, {
        remnashopSession: reconciled.remnashopSession,
      });
    } else {
      await createWebSessionOnResponse(response, reconciled.userId);
    }

    logTechnicalInfo("telegram_popup_callback_success", {
      userId: user.id,
      remnashopLinked: linked || Boolean(remnashopAuth),
      redirectTo: nextPath ?? "/cabinet",
    });

    return response;
  } catch (error) {
    logTechnicalError("telegram_popup_callback_failed", error, {});
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
