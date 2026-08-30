import { redirect } from "next/navigation";

import { requestAuthProfileGateway } from "@/app/_composition/request-scoped-readers";
import { registrationEmailVerificationPath } from "@/shared/auth/account-setup-flow";
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

export async function requireCabinetEntrySession(returnTo = "/cabinet") {
  const session = await requireRequestSession(returnTo);
  if (requestSessionRequiresEmailVerification(session)) {
    redirect(registrationEmailVerificationPath(returnTo));
  }
  return session;
}

export function requestSessionRequiresEmailVerification(session: {
  user: { email: string | null; emailVerified: boolean };
}) {
  return Boolean(session.user.email && !session.user.emailVerified);
}

export function requestSessionRequiresPasskey(session: { context: unknown }) {
  const context = session.context;
  return Boolean(
    context &&
      typeof context === "object" &&
      "assuranceLevel" in context &&
      context.assuranceLevel === "BOOTSTRAP",
  );
}
