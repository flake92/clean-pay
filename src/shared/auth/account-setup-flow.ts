import { safeRedirectPath } from "@/shared/auth/redirect-policy";

const ACCOUNT_SETUP_FLOW = "telegram-email";
export const ACCOUNT_SETUP_REASON = "email-required";
const ACCOUNT_SETUP_NOTICE = "account-ready";
export const ACCOUNT_SETUP_PASSWORD_STEP = "password";

const fallbackOrigin = "https://clean-pay.local";
const fallbackDestination = "/cabinet";
const flowPagePaths = new Set([
  "/api",
  "/auth",
  "/link-account",
  "/login",
  "/passkey/setup",
  "/register",
  "/register/verify-email",
  "/verify-email",
]);

export function safeAccountSetupDestination(
  value: string | null | undefined,
) {
  const destination = safeRedirectPath(value);

  if (!destination) {
    return fallbackDestination;
  }

  const url = new URL(destination, fallbackOrigin);
  const normalizedPath =
    url.pathname.replace(/\/+$/, "") || "/";

  if (
    normalizedPath.startsWith("/api/") ||
    normalizedPath.startsWith("/auth/") ||
    flowPagePaths.has(normalizedPath)
  ) {
    return fallbackDestination;
  }

  return destination;
}

function flowPath(
  pathname: string,
  redirectTo: string,
  values: Record<string, string>,
) {
  const search = new URLSearchParams({
    ...values,
    redirect_to: safeAccountSetupDestination(redirectTo),
  });

  return `${pathname}?${search.toString()}`;
}

export function accountLinkPath(
  redirectTo: string,
  options: { passwordRequired?: boolean } = {},
) {
  const values: Record<string, string> = {
    reason: ACCOUNT_SETUP_REASON,
  };

  if (options.passwordRequired) {
    values.step = ACCOUNT_SETUP_PASSWORD_STEP;
  }

  return flowPath("/link-account", redirectTo, values);
}

export function emailVerificationPath(redirectTo: string) {
  return flowPath("/verify-email", redirectTo, {
    flow: ACCOUNT_SETUP_FLOW,
  });
}

export function registrationEmailVerificationPath(redirectTo: string) {
  return flowPath("/register/verify-email", redirectTo, {});
}

export function resolveEmailVerificationSetup(
  flow: string | null | undefined,
  redirectTo: string | null | undefined,
) {
  const guided = flow === ACCOUNT_SETUP_FLOW;

  return {
    guided,
    redirectTo: guided
      ? safeAccountSetupDestination(redirectTo)
      : "/profile",
  };
}

export function passkeySetupPath(redirectTo: string) {
  return flowPath("/passkey/setup", redirectTo, {});
}

export function accountSetupCompletePath(redirectTo: string) {
  const destination = safeAccountSetupDestination(redirectTo);
  const url = new URL(destination, fallbackOrigin);

  if (url.pathname === "/payment") {
    url.searchParams.set("account_setup", ACCOUNT_SETUP_NOTICE);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function hasAccountSetupNotice(
  searchParams: Pick<URLSearchParams, "get">,
) {
  return searchParams.get("account_setup") === ACCOUNT_SETUP_NOTICE;
}

export function isPaymentDestination(redirectTo: string) {
  return (
    new URL(safeAccountSetupDestination(redirectTo), fallbackOrigin).pathname ===
    "/payment"
  );
}
