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

/**
 * Moves provider-token repair into a Route Handler that is allowed to rotate
 * the stored Remnashop token bundle and browser cookies. Server Components
 * must remain read-only and use this hand-off instead of rendering a false
 * login prompt or attempting recovery during render.
 */
export function providerSessionRecoveryPath(returnTo: string) {
  const destination = safeRedirectPath(returnTo) ?? "/cabinet";
  const params = new URLSearchParams({ return_to: destination });
  return `/auth/session/recover?${params}`;
}
