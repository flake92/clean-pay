import { NextResponse } from "next/server";

import {
  accountLinkPath,
  emailVerificationPath,
  passkeySetupPath,
} from "@/shared/auth/account-setup-flow";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";
import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import { getAuthorizedRemnashopTokens } from "@/backend/integrations/remnashop/client";
import { clearWebSession } from "@/backend/integrations/sessions/web-session-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const transientCodes = new Set([
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
  "CONFLICT",
]);

function redirect(path: string) {
  const response = NextResponse.redirect(
    new URL(path, getEnv().publicAppUrl),
    303,
  );
  response.headers.set("cache-control", "no-store");
  return response;
}

function retryAfter(error: ServiceError | null) {
  const candidate = error?.debug?.retryAfterSeconds;
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
    ? String(Math.min(3_600, Math.ceil(candidate)))
    : "1";
}

function recoveryAttempt(value: string | null) {
  return value === "1" ? 1 : 0;
}

function unavailable(
  request: Request,
  error: ServiceError | null,
  returnTo: string,
  attempt: number,
  status = 503,
) {
  const seconds = retryAfter(error);

  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return NextResponse.json(
      {
        error: {
          code: error?.code ?? "INTERNAL_ERROR",
          message: "Provider session recovery is temporarily unavailable.",
        },
      },
      {
        status,
        headers: {
          "cache-control": "no-store",
          "retry-after": seconds,
        },
      },
    );
  }

  const url = new URL("/auth/session/recovery", getEnv().publicAppUrl);
  url.searchParams.set("return_to", returnTo);
  url.searchParams.set("retry_after", seconds);
  url.searchParams.set("attempt", String(attempt));
  url.searchParams.set("kind", "provider");
  const response = redirect(`${url.pathname}${url.search}`);
  response.headers.set("retry-after", seconds);
  return response;
}

function mergeRecoveryPath(
  returnTo: string,
  code: "ACCOUNT_MERGE_REQUIRED" | "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
) {
  const url = new URL(accountLinkPath(returnTo), getEnv().publicAppUrl);
  url.searchParams.set(
    "auth",
    code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT"
      ? "telegram_merge_subscriptions"
      : "telegram_merge_required",
  );
  return `${url.pathname}${url.search}`;
}

async function login(returnTo: string) {
  // A terminal provider credential failure must not leave a valid local
  // session that would make the proxy send /login straight back to the
  // protected page. clearWebSession revokes it when possible; explicit
  // response deletion also fails closed if revocation itself races or fails.
  try {
    await clearWebSession();
  } catch {
    // The browser credentials are still removed on the response below.
  }

  const url = new URL("/login", getEnv().publicAppUrl);
  url.searchParams.set("redirect_to", returnTo);
  const response = redirect(`${url.pathname}${url.search}`);
  response.cookies.delete("clean_pay_access");
  response.cookies.delete("clean_pay_refresh");
  return response;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = safeRedirectPath(requestUrl.searchParams.get("return_to"))
    ?? "/cabinet";
  const attempt = recoveryAttempt(requestUrl.searchParams.get("attempt"));

  try {
    await getAuthorizedRemnashopTokens({
      allowUnverifiedEmail: true,
      forceRefresh: true,
    });
    return redirect(returnTo);
  } catch (error) {
    const serviceError = error instanceof ServiceError ? error : null;
    const code = serviceError?.code ?? "INTERNAL_ERROR";

    if (code === "UNAUTHORIZED" || code === "AUTH_FAILED") {
      return login(returnTo);
    }
    if (code === "PASSKEY_REQUIRED") {
      return redirect(passkeySetupPath(returnTo));
    }
    if (code === "EMAIL_REQUIRED") {
      return redirect(accountLinkPath(returnTo));
    }
    if (code === "EMAIL_NOT_VERIFIED") {
      return redirect(emailVerificationPath(returnTo));
    }
    if (
      code === "ACCOUNT_MERGE_REQUIRED"
      || code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT"
    ) {
      return redirect(mergeRecoveryPath(returnTo, code));
    }
    if (code === "RATE_LIMITED") {
      return unavailable(request, serviceError, returnTo, attempt, 429);
    }
    if (transientCodes.has(code)) {
      return unavailable(request, serviceError, returnTo, attempt);
    }

    // An unclassified failure is not proof that either browser credential is
    // invalid. Preserve the session and let the caller retry safely.
    return unavailable(request, serviceError, returnTo, attempt);
  }
}
