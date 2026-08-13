import { NextResponse } from "next/server";

import { getEnv } from "@/backend/config/env";
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirect(path: string) {
  return NextResponse.redirect(new URL(path, getEnv().publicAppUrl), 303);
}

function safeAuthFallback(value: string | null, returnTo: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const appUrl = new URL(getEnv().publicAppUrl);
    const fallback = new URL(value, appUrl);
    if (
      fallback.origin !== appUrl.origin
      || (fallback.pathname !== "/login" && fallback.pathname !== "/register")
    ) {
      return null;
    }
    const redirectTo = safeRedirectPath(fallback.searchParams.get("redirect_to"))
      ?? returnTo;
    const canonical = new URL(fallback.pathname, appUrl);
    canonical.searchParams.set("redirect_to", redirectTo);
    return `${canonical.pathname}${canonical.search}`;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeRedirectPath(url.searchParams.get("return_to")) ?? "/cabinet";
  const authFallback = safeAuthFallback(
    url.searchParams.get("fallback_to"),
    returnTo,
  );

  let session;
  try {
    session = await getCurrentSession();
  } catch {
    // An infrastructure failure is not evidence that the refresh candidate is
    // invalid. Preserve both browser credentials so the same token family can
    // be retried after the dependency recovers.
    return NextResponse.json(
      {
        error: {
          code: "SESSION_REFRESH_UNAVAILABLE",
          message: "Session refresh is temporarily unavailable.",
        },
      },
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "retry-after": "1",
        },
      },
    );
  }

  if (session) {
    return redirect(returnTo);
  }

  // A null result is a definitive missing, expired, revoked or reused refresh
  // family. Clear both candidates before returning to authentication.
  const fallback = authFallback
    ? new URL(authFallback, getEnv().publicAppUrl)
    : new URL("/login", getEnv().publicAppUrl);
  if (!authFallback) fallback.searchParams.set("redirect_to", returnTo);
  const response = NextResponse.redirect(fallback, 303);
  response.cookies.delete("clean_pay_access");
  response.cookies.delete("clean_pay_refresh");
  return response;
}
