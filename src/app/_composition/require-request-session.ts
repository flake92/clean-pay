import { redirect } from "next/navigation";

import { requestAuthProfileGateway } from "@/app/_composition/request-scoped-readers";
import { sessionRefreshPath } from "@/shared/auth/session-navigation";

/**
 * Protects setup pages that deliberately use AuthShell instead of AppShell.
 * The proxy validates the signed JWT at the edge; this database-backed check
 * also rejects a revoked or concurrently replaced session before rendering.
 */
export async function requireRequestSession(returnTo: string) {
  const session = await requestAuthProfileGateway.loadCurrentSession();
  if (!session) redirect(sessionRefreshPath(returnTo));
  return session;
}
