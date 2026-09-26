import { NextResponse } from "next/server";

import { getEnv } from "@/app/_composition/platform-runtime";
import { getCurrentSession } from "@/app/_composition/web-session-runtime";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";
import { safeAuthenticationFallback } from "@/shared/domain/post-auth-continuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirect(path: string) {
  const response = NextResponse.redirect(
    new URL(path, getEnv().publicAppUrl),
    303,
  );
  response.headers.set("cache-control", "no-store");
  return response;
}

function recoveryAttempt(value: string | null) {
  return value === "1" ? 1 : 0;
}

function unavailable(
  request: Request,
  returnTo: string,
  authFallback: string | undefined,
  attempt: number,
) {
  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  if (accept.includes("application/json") && !accept.includes("text/html")) {
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

  const url = new URL("/auth/session/recovery", getEnv().publicAppUrl);
  url.searchParams.set("return_to", returnTo);
  url.searchParams.set("retry_after", "1");
  url.searchParams.set("attempt", String(attempt));
  url.searchParams.set("kind", "session");
  if (authFallback) url.searchParams.set("fallback_to", authFallback);
  const response = redirect(`${url.pathname}${url.search}`);
  response.headers.set("retry-after", "1");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeRedirectPath(url.searchParams.get("return_to")) ?? "/cabinet";
  const attempt = recoveryAttempt(url.searchParams.get("attempt"));
  const authFallback = safeAuthenticationFallback(
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
    return unavailable(request, returnTo, authFallback, attempt);
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
  response.headers.set("cache-control", "no-store");
  response.cookies.delete("clean_pay_access");
  response.cookies.delete("clean_pay_refresh");
  return response;
}
