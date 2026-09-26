const paymentReconciliationInternalPath = "/api/internal/payments/reconcile";
export const readinessInternalPath = "/api/internal/health/readiness";
const metricsInternalPath = "/api/internal/metrics";
export const sessionRefreshPath = "/auth/session/refresh";
const providerSessionRecoveryPath = "/auth/session/recover";
const providerSessionRecoveryPagePath = "/auth/session/recovery";

const opaquePathSegmentPatterns = [
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
  /^c[a-z0-9]{20,}$/i,
  /^[A-Za-z0-9_-]{24,}$/,
];

const publicPagePaths = new Set([
  "/manifest.webmanifest",
  "/install",
  "/offline",
  "/login",
  "/register",
  "/support",
  "/tariffs",
  "/auth/telegram/start",
  "/auth/telegram/callback",
  "/auth/telegram/webapp",
  sessionRefreshPath,
  providerSessionRecoveryPath,
  providerSessionRecoveryPagePath,
]);

const publicApiPaths = new Set([
  "/api/health",
  "/api/health/liveness",
  "/api/health/readiness",
]);

// These legacy browser endpoints were removed. Let Next.js resolve them to a
// real 404 instead of turning a nonexistent transport into an authentication
// oracle at the proxy boundary.
export const removedBrowserTransportPaths = Object.freeze([
  "/api/me",
  "/api/logout",
  "/api/bff/auth/me",
  "/api/bff/subscription/current",
  "/api/bff/payments/status",
]);
const removedBrowserTransportPathSet = new Set(removedBrowserTransportPaths);

const emailVerificationPagePaths = new Set([
  "/verify-email",
  "/register/verify-email",
]);

export function isPublicPath(pathname: string) {
  return publicPagePaths.has(pathname)
    || publicApiPaths.has(pathname)
    || isInvitePath(pathname);
}

export function isInvitePath(pathname: string) {
  return pathname.startsWith("/invite/");
}

export function isEmailVerificationAllowedPath(pathname: string) {
  return emailVerificationPagePaths.has(pathname);
}

export function isBootstrapAllowedPath(pathname: string) {
  return pathname === "/passkey/setup";
}

export function isRemovedBrowserTransportPath(pathname: string) {
  return removedBrowserTransportPathSet.has(pathname);
}

export function isRoutineReadinessProbe(pathname: string, method: string) {
  return pathname === readinessInternalPath && method === "GET";
}

export function isInternalServiceRequest(pathname: string, method: string) {
  return (
    (pathname === paymentReconciliationInternalPath && method === "POST")
    || (pathname === readinessInternalPath && method === "GET")
    || (pathname === metricsInternalPath && method === "GET")
  );
}

export function isRefreshableNavigation(pathname: string, method: string) {
  return (
    (method === "GET" || method === "HEAD")
    && !pathname.startsWith("/api/")
    && !pathname.startsWith("/auth/")
    && (
      pathname === "/login"
      || pathname === "/register"
      || isInvitePath(pathname)
      || !isPublicPath(pathname)
    )
  );
}

export function canonicalConfusableProtectedPath(pathname: string) {
  try {
    const decoded = decodeURIComponent(pathname);

    // Cyrillic small es (U+0441) is visually indistinguishable from the
    // ASCII "c" in an address bar. Preserve the session and repair this
    // observed legacy/bookmark typo instead of letting Next.js render a 404.
    if (decoded === "/\u0441abinet") {
      return "/cabinet";
    }
  } catch {
    // Malformed paths remain Next.js 404s; never guess a destination.
  }

  return undefined;
}

export function accessLogRouteTemplate(value: string) {
  const routeEnd = value.search(/[?#]/);
  const pathname = (routeEnd === -1 ? value : value.slice(0, routeEnd)) || "/";

  if (isInvitePath(pathname)) {
    return "/invite/:code";
  }

  return pathname
    .split("/")
    .map((segment) => {
      let candidate = segment;
      try {
        candidate = decodeURIComponent(segment);
      } catch {
        // Keep malformed segments opaque and let the normal route boundary
        // decide whether they are valid.
      }

      return opaquePathSegmentPatterns.some((pattern) => pattern.test(candidate))
        ? ":id"
        : segment;
    })
    .join("/");
}
