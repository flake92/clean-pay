import { safeRedirectPath } from "@/shared/auth/redirect-policy";

/**
 * Sends a render-time authentication miss through the cookie-capable Route
 * Handler. This avoids redirect loops when a signed access JWT is no longer
 * backed by an active database session.
 */
export function sessionRefreshPath(returnTo: string) {
  const destination = safeRedirectPath(returnTo) ?? "/cabinet";
  const params = new URLSearchParams({ return_to: destination });
  return `/auth/session/refresh?${params}`;
}
