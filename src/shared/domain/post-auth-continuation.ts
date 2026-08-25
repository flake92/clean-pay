import { normalizeReferralCode } from "@/shared/domain/referrals";

const fallbackOrigin = "https://clean-pay.local";

// Post-auth continuations must resolve to a real, user-facing application
// route. Keeping this list explicit prevents a stale, mistyped or crafted
// continuation from turning a successful login into a framework 404.
const postAuthPagePaths = new Set([
  "/",
  "/cabinet",
  "/extend",
  "/install",
  "/link-account",
  "/offline",
  "/passkey/setup",
  "/payment",
  "/payment/fail",
  "/payment/pending",
  "/payment/success",
  "/profile",
  "/referral",
  "/register/verify-email",
  "/support",
  "/tariffs",
  "/verify-email",
]);

function isPostAuthPagePath(pathname: string) {
  if (postAuthPagePaths.has(pathname)) {
    return true;
  }

  const invitePrefix = "/invite/";
  if (!pathname.startsWith(invitePrefix)) {
    return false;
  }

  const referralCode = pathname.slice(invitePrefix.length);
  return normalizeReferralCode(referralCode) === referralCode;
}

function decodedSafeAsciiPathname(pathname: string) {
  try {
    const decoded = decodeURIComponent(pathname);

    if (
      !/^\/[\x21-\x7e]*$/.test(decoded)
      || decoded.startsWith("//")
      || decoded.includes("\\")
      || decoded.includes("?")
      || decoded.includes("#")
    ) {
      return undefined;
    }

    return decoded;
  } catch {
    return undefined;
  }
}

export function safePostAuthContinuation(
  value: string | null | undefined,
) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  const pathnameEnd = value.search(/[?#]/);
  const rawPathname = pathnameEnd === -1
    ? value
    : value.slice(0, pathnameEnd);

  // URL normalisation removes encoded dot segments before url.pathname can be
  // inspected. Reject all pathname encoding up front so a malformed value
  // such as /invite/%2e%2e/cabinet cannot masquerade as an allowed route.
  if (
    rawPathname.includes("%")
    || rawPathname.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }

  try {
    const url = new URL(value, fallbackOrigin);
    const decodedPathname = decodedSafeAsciiPathname(url.pathname);

    if (
      url.origin !== fallbackOrigin
      || url.username
      || url.password
      || !decodedPathname
    ) {
      return undefined;
    }

    if (!isPostAuthPagePath(decodedPathname)) {
      return undefined;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

export function safeAuthenticationFallback(
  value: string | null | undefined,
  returnTo: string,
) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  try {
    const fallback = new URL(value, fallbackOrigin);
    if (
      fallback.origin !== fallbackOrigin
      || (fallback.pathname !== "/login" && fallback.pathname !== "/register")
    ) {
      return undefined;
    }

    const redirectTo = safePostAuthContinuation(
      fallback.searchParams.get("redirect_to"),
    ) ?? safePostAuthContinuation(returnTo) ?? "/cabinet";
    const canonical = new URL(fallback.pathname, fallbackOrigin);
    canonical.searchParams.set("redirect_to", redirectTo);
    return `${canonical.pathname}${canonical.search}`;
  } catch {
    return undefined;
  }
}
