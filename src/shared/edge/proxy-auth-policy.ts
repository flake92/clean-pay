import { registrationEmailVerificationPath } from "@/shared/auth/account-setup-flow";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

export const accessCookieName = "clean_pay_access";
export const refreshCookieName = "clean_pay_refresh";

export type AccessState = {
  authenticated: boolean;
  emailVerificationRequired: boolean;
  hasRefreshToken: boolean;
};

function unauthenticatedAccessState(hasRefreshToken: boolean): AccessState {
  return {
    authenticated: false,
    emailVerificationRequired: false,
    hasRefreshToken,
  };
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  return atob(padded);
}

function encodeBase64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));

  return encodeBase64Url(signature);
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

export async function getAccessState({
  token,
  hasRefreshToken,
  jwtSecret,
  nowEpochSeconds = () => Math.floor(Date.now() / 1_000),
}: {
  token: string | undefined;
  hasRefreshToken: boolean;
  jwtSecret: () => string | undefined;
  nowEpochSeconds?: () => number;
}): Promise<AccessState> {
  if (!token) {
    return unauthenticatedAccessState(hasRefreshToken);
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return unauthenticatedAccessState(hasRefreshToken);
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as {
      exp?: unknown;
      ev?: unknown;
      tg?: unknown;
      al?: unknown;
    };

    // FULL is the only assurance level the application issues; any other
    // (retired) level is not a usable session.
    if (
      typeof parsed.exp !== "number"
      || parsed.exp <= nowEpochSeconds()
      || parsed.al !== "FULL"
    ) {
      return unauthenticatedAccessState(hasRefreshToken);
    }

    const secret = jwtSecret();

    if (!secret) {
      return unauthenticatedAccessState(hasRefreshToken);
    }

    const authenticated = safeEqual(signature, await hmacSha256(payload, secret));

    return {
      authenticated,
      emailVerificationRequired: authenticated && parsed.ev === false && parsed.tg !== true,
      hasRefreshToken,
    };
  } catch {
    return unauthenticatedAccessState(hasRefreshToken);
  }
}

export function safeRedirectTarget(pathname: string, search: string) {
  if (pathname === "/login" || pathname === "/register") {
    return "/cabinet";
  }

  return pathname + search;
}

export function refreshSessionRedirectPolicy({
  pathname,
  search,
  origin,
  requestedRedirect,
}: {
  pathname: string;
  search: string;
  origin: string;
  requestedRedirect: string | null;
}) {
  const isAuthEntry = pathname === "/login" || pathname === "/register";
  const returnTo = isAuthEntry
    ? safeRedirectPath(requestedRedirect) ?? "/cabinet"
    : safeRedirectTarget(pathname, search);

  if (!isAuthEntry) {
    return { returnTo, fallbackTo: undefined };
  }

  const fallback = new URL(pathname, origin);
  fallback.searchParams.set("redirect_to", returnTo);

  return {
    returnTo,
    fallbackTo: `${fallback.pathname}${fallback.search}`,
  };
}

export function authenticatedEntryRedirectPolicy({
  requestedRedirect,
  emailVerificationRequired,
}: {
  requestedRedirect: string | null;
  emailVerificationRequired: boolean;
}) {
  const redirectTo = safeRedirectPath(requestedRedirect) ?? "/cabinet";

  return emailVerificationRequired
    ? registrationEmailVerificationPath(redirectTo)
    : redirectTo;
}

export function authenticatedInviteRedirectPolicy({
  emailVerificationRequired,
}: {
  emailVerificationRequired: boolean;
}) {
  return emailVerificationRequired
    ? registrationEmailVerificationPath("/tariffs")
    : "/tariffs";
}

export function emailVerificationRedirectPolicy(pathname: string, search: string) {
  return registrationEmailVerificationPath(safeRedirectTarget(pathname, search));
}
